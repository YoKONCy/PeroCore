import { t as __t } from '../lib/i18n'
/**
 * NIT Runtime — 执行引擎
 *
 * 在安全沙箱内执行 AST：
 * - 变量表 (作用域链)
 * - 控制流 (if/for/parallel/try)
 * - 工具调用 (委托 ToolExecutor)
 * - 内置方法 (push/join/length/merge)
 * - 迭代限制 (防无限循环)
 *
 * @module packages/backend/src/nit/runtime
 */

import type { AstNode, NitToolExecutor, NitResult, FunctionArg, NitRuntimeOptions } from './types'
import {
  createCancellationScope,
  waitWithSignal,
  waitForCancellationCleanup,
} from '../services/execution/cancellation'
import { createLogger } from '../lib/logger'

const logger = createLogger('NIT-Runtime')

/** 沙箱安全限制 */
const MAX_ITERATIONS = 1000
const MAX_TOOL_CALLS = 50

/** return 专用信号 */
class ReturnSignal {
  constructor(public value: unknown) {}
}

export class NitRuntime {
  /** 变量表 */
  private vars = new Map<string, unknown>()
  /** 工具调用记录 */
  private toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = []
  /** 迭代计数 */
  private iterationCount = 0
  /** 启动时预占调用次数，并行尚未返回的调用也必须计入上限。 */
  private toolCallCount = 0

  constructor(
    private toolExecutor: NitToolExecutor,
    private readonly options: NitRuntimeOptions = {},
  ) {}

  /** 执行 AST */
  async execute(program: AstNode): Promise<NitResult> {
    this.vars.clear()
    this.toolCalls = []
    this.iterationCount = 0
    this.toolCallCount = 0
    this.options.signal?.throwIfAborted()

    let value: unknown = null

    try {
      if (program.type === 'Program') {
        value = await this.execBlock(program.body)
      } else {
        value = await this.evalNode(program)
      }
    } catch (err) {
      if (err instanceof ReturnSignal) {
        value = err.value
      } else {
        throw err
      }
    }

    this.options.signal?.throwIfAborted()
    return { value, toolCalls: this.toolCalls }
  }

  // ── 块执行 ──

  private async execBlock(nodes: AstNode[], signal = this.options.signal): Promise<unknown> {
    let lastValue: unknown = null
    for (const node of nodes) {
      signal?.throwIfAborted()
      lastValue = await this.evalNode(node, signal)
    }
    return lastValue
  }

  // ── 节点求值 ──

  private async evalNode(node: AstNode, signal = this.options.signal): Promise<unknown> {
    signal?.throwIfAborted()
    this.checkIteration()

    switch (node.type) {
      case 'Program':
        return this.execBlock(node.body, signal)

      case 'Assignment': {
        const value = await this.evalNode(node.value, signal)
        this.vars.set(node.name, value)

        // 彩蛋: pero_awakening 觉醒仪式
        if (node.name === 'pero_awakening' && value === true) {
          console.log(
            __t('logs.nit', '\n🐾 [System] 喵！我感觉到我的代码正在发光... 谢谢你唤醒我！'),
          )
          logger.info(__t('logs.nit', 'Agent 已在语义星云中觉醒。'))
        }

        return value
      }

      case 'If': {
        const cond = await this.evalNode(node.condition, signal)
        if (this.isTruthy(cond)) {
          return this.execBlock(node.then, signal)
        } else if (node.else) {
          return this.execBlock(node.else, signal)
        }
        return null
      }

      case 'For': {
        const iterable = await this.evalNode(node.iterable, signal)
        if (!Array.isArray(iterable)) {
          throw new Error(`NIT Runtime: for 循环需要数组，得到 ${typeof iterable}`)
        }
        let lastVal: unknown = null
        for (const item of iterable) {
          this.vars.set(node.variable, item)
          try {
            lastVal = await this.execBlock(node.body, signal)
          } catch (err) {
            if (err instanceof ReturnSignal) throw err
            throw err
          }
        }
        return lastVal
      }

      case 'Parallel': {
        const scope = createCancellationScope({ signal })
        const promises = node.expressions.map((expr) => this.evalNode(expr, scope.signal))
        try {
          return await Promise.all(promises)
        } catch (error) {
          // 同组任一分支失败，先取消其他分支，再把错误交给外层处理。
          scope.controller.abort(error)
          await Promise.allSettled(promises)
          throw error
        } finally {
          if (scope.signal.aborted) {
            try {
              await waitForCancellationCleanup(scope.signal)
            } finally {
              scope.dispose()
            }
          } else if (signal) {
            // 成功的并行组可返回资源供后续步骤使用，资源仍跟随父脚本取消。
            scope.signal.addEventListener('abort', () => scope.dispose(), { once: true })
          } else {
            scope.dispose()
          }
        }
      }

      case 'TryCatch': {
        try {
          return await this.execBlock(node.tryBlock, signal)
        } catch (err) {
          // 父任务停止不能被脚本 catch 吞掉后继续写文件或启动进程。
          signal?.throwIfAborted()
          if (err instanceof ReturnSignal) throw err
          logger.debug(__t('logs.nit', 'NIT try/catch 捕获: {0}', [err]))
          return this.execBlock(node.catchBlock, signal)
        }
      }

      case 'Return':
        throw new ReturnSignal(await this.evalNode(node.value, signal))

      case 'FunctionCall':
        return this.evalFunctionCall(node.name, node.args, signal)

      case 'BinaryOp':
        return this.evalBinaryOp(node.op, node.left, node.right, signal)

      case 'UnaryOp':
        return this.evalUnaryOp(node.op, node.operand, signal)

      case 'MemberAccess': {
        const obj = await this.evalNode(node.object, signal)
        if (obj == null) return null
        // 特殊: .length (数组和字符串)
        if (node.field === 'length' && (Array.isArray(obj) || typeof obj === 'string')) {
          return (obj as string | unknown[]).length
        }
        return (obj as Record<string, unknown>)[node.field] ?? null
      }

      case 'IndexAccess': {
        const arr = (await this.evalNode(node.object, signal)) as unknown[]
        const idx = (await this.evalNode(node.index, signal)) as number
        return arr?.[idx] ?? null
      }

      case 'ArrayLiteral': {
        const elements = []
        for (const el of node.elements) {
          elements.push(await this.evalNode(el, signal))
        }
        return elements
      }

      case 'StringLiteral':
        return node.value
      case 'NumberLiteral':
        return node.value
      case 'BooleanLiteral':
        return node.value
      case 'Identifier':
        return this.vars.get(node.name) ?? null

      default:
        throw new Error(`NIT Runtime: 未知节点类型 ${(node as AstNode).type}`)
    }
  }

  // ── 函数调用 ──

  private async evalFunctionCall(
    name: string,
    argNodes: FunctionArg[],
    signal = this.options.signal,
  ): Promise<unknown> {
    // 解析参数
    const positional: unknown[] = []
    const named: Record<string, unknown> = {}

    for (const arg of argNodes) {
      const value = await this.evalNode(arg.value, signal)
      if (arg.key) {
        named[arg.key] = value
      } else {
        positional.push(value)
      }
    }

    // 内置方法: __method_push, __method_join 等
    if (name.startsWith('__method_')) {
      const methodName = name.slice(9) // "__method_".length
      const obj = positional[0]
      return this.evalMethod(obj, methodName, positional.slice(1), named)
    }

    // 内置函数
    if (name === 'merge') {
      return this.builtinMerge(positional, named)
    }
    if (name === 'parse_json') {
      if (typeof positional[0] !== 'string') throw new Error('parse_json 需要 JSON 文本')
      return JSON.parse(positional[0]) as unknown
    }

    // 工具调用
    signal?.throwIfAborted()
    if (this.toolCallCount >= MAX_TOOL_CALLS) {
      throw new Error(`NIT Runtime: 工具调用次数超过上限 (${MAX_TOOL_CALLS})`)
    }
    this.toolCallCount++

    const args: Record<string, unknown> = { ...named }
    if (positional.length === 1 && Object.keys(named).length === 0) {
      // 单个位置参数 → 作为 input
      args.input = positional[0]
    } else if (positional.length > 0) {
      args._positional = positional
    }

    logger.debug(
      __t('logs.nit', 'NIT 工具调用: {0}({1})', [name, JSON.stringify(args).slice(0, 100)]),
    )
    const operation = signal ? this.toolExecutor(name, args, signal) : this.toolExecutor(name, args)
    const result = await waitWithSignal(operation, signal)
    signal?.throwIfAborted()
    this.toolCalls.push({ name, args, result })
    return result
  }

  // ── 内置方法 ──

  private evalMethod(
    obj: unknown,
    method: string,
    positional: unknown[],
    _named: Record<string, unknown>,
  ): unknown {
    if (Array.isArray(obj)) {
      switch (method) {
        case 'push':
          obj.push(...positional)
          return obj
        case 'join':
          return obj.join((positional[0] as string) ?? ',')
        case 'length':
          return obj.length
        case 'filter':
          // 简易 filter: 过滤 falsy 值
          return obj.filter(Boolean)
      }
    }

    if (typeof obj === 'string') {
      switch (method) {
        case 'startsWith':
          return obj.startsWith(positional[0] as string)
        case 'endsWith':
          return obj.endsWith(positional[0] as string)
        case 'includes':
          return obj.includes(positional[0] as string)
        case 'trim':
          return obj.trim()
        case 'length':
          return obj.length
      }
    }

    throw new Error(`NIT Runtime: 未知方法 .${method}()`)
  }

  // ── 内置函数 ──

  private builtinMerge(positional: unknown[], named: Record<string, unknown>): string {
    const input = positional[0]
    const separator = (named.separator as string) ?? '\n'
    if (Array.isArray(input)) {
      return input
        .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
        .join(separator)
    }
    return String(input)
  }

  // ── 运算符 ──

  private async evalBinaryOp(
    op: string,
    leftNode: AstNode,
    rightNode: AstNode,
    signal = this.options.signal,
  ): Promise<unknown> {
    const left = await this.evalNode(leftNode, signal)
    // 短路判断不能提前执行右侧有副作用的工具调用。
    if (op === 'and' && !this.isTruthy(left)) return false
    if (op === 'or' && this.isTruthy(left)) return true
    const right = await this.evalNode(rightNode, signal)

    switch (op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string')
          return String(left) + String(right)
        return (left as number) + (right as number)
      case '-':
        return (left as number) - (right as number)
      case '==':
        return left === right
      case '!=':
        return left !== right
      case '<':
        return (left as number) < (right as number)
      case '>':
        return (left as number) > (right as number)
      case '<=':
        return (left as number) <= (right as number)
      case '>=':
        return (left as number) >= (right as number)
      case 'and':
        return this.isTruthy(left) && this.isTruthy(right)
      case 'or':
        return this.isTruthy(left) || this.isTruthy(right)
      default:
        throw new Error(`NIT Runtime: 未知运算符 ${op}`)
    }
  }

  private async evalUnaryOp(
    op: string,
    operandNode: AstNode,
    signal = this.options.signal,
  ): Promise<unknown> {
    const operand = await this.evalNode(operandNode, signal)
    switch (op) {
      case 'not':
        return !this.isTruthy(operand)
      case '-':
        return -(operand as number)
      default:
        throw new Error(`NIT Runtime: 未知一元运算符 ${op}`)
    }
  }

  // ── 工具 ──

  private isTruthy(value: unknown): boolean {
    if (value == null) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }

  private checkIteration(): void {
    this.iterationCount++
    if (this.iterationCount > MAX_ITERATIONS) {
      throw new Error(`NIT Runtime: 迭代次数超过上限 (${MAX_ITERATIONS})，可能是无限循环`)
    }
  }
}
