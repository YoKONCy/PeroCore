/**
 * NIT v3 Runtime — 执行引擎
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

import type { AstNode, NitToolExecutor, NitResult, FunctionArg } from './types'
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

  constructor(private toolExecutor: NitToolExecutor) {}

  /** 执行 AST */
  async execute(program: AstNode): Promise<NitResult> {
    this.vars.clear()
    this.toolCalls = []
    this.iterationCount = 0

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

    return { value, toolCalls: this.toolCalls }
  }

  // ── 块执行 ──

  private async execBlock(nodes: AstNode[]): Promise<unknown> {
    let lastValue: unknown = null
    for (const node of nodes) {
      lastValue = await this.evalNode(node)
    }
    return lastValue
  }

  // ── 节点求值 ──

  private async evalNode(node: AstNode): Promise<unknown> {
    this.checkIteration()

    switch (node.type) {
      case 'Program':
        return this.execBlock(node.body)

      case 'Assignment': {
        const value = await this.evalNode(node.value)
        this.vars.set(node.name, value)
        return value
      }

      case 'If': {
        const cond = await this.evalNode(node.condition)
        if (this.isTruthy(cond)) {
          return this.execBlock(node.then)
        } else if (node.else) {
          return this.execBlock(node.else)
        }
        return null
      }

      case 'For': {
        const iterable = await this.evalNode(node.iterable)
        if (!Array.isArray(iterable)) {
          throw new Error(`NIT Runtime: for 循环需要数组，得到 ${typeof iterable}`)
        }
        let lastVal: unknown = null
        for (const item of iterable) {
          this.vars.set(node.variable, item)
          try {
            lastVal = await this.execBlock(node.body)
          } catch (err) {
            if (err instanceof ReturnSignal) throw err
            throw err
          }
        }
        return lastVal
      }

      case 'Parallel': {
        const promises = node.expressions.map((expr) => this.evalNode(expr))
        const results = await Promise.all(promises)
        return results
      }

      case 'TryCatch': {
        try {
          return await this.execBlock(node.tryBlock)
        } catch (err) {
          if (err instanceof ReturnSignal) throw err
          logger.debug(`NIT try/catch 捕获: ${err}`)
          return this.execBlock(node.catchBlock)
        }
      }

      case 'Return':
        throw new ReturnSignal(await this.evalNode(node.value))

      case 'FunctionCall':
        return this.evalFunctionCall(node.name, node.args)

      case 'BinaryOp':
        return this.evalBinaryOp(node.op, node.left, node.right)

      case 'UnaryOp':
        return this.evalUnaryOp(node.op, node.operand)

      case 'MemberAccess': {
        const obj = await this.evalNode(node.object)
        if (obj == null) return null
        // 特殊: .length (数组和字符串)
        if (node.field === 'length' && (Array.isArray(obj) || typeof obj === 'string')) {
          return (obj as string | unknown[]).length
        }
        return (obj as Record<string, unknown>)[node.field] ?? null
      }

      case 'IndexAccess': {
        const arr = (await this.evalNode(node.object)) as unknown[]
        const idx = (await this.evalNode(node.index)) as number
        return arr?.[idx] ?? null
      }

      case 'ArrayLiteral': {
        const elements = []
        for (const el of node.elements) {
          elements.push(await this.evalNode(el))
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

  private async evalFunctionCall(name: string, argNodes: FunctionArg[]): Promise<unknown> {
    // 解析参数
    const positional: unknown[] = []
    const named: Record<string, unknown> = {}

    for (const arg of argNodes) {
      const value = await this.evalNode(arg.value)
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

    // 工具调用
    if (this.toolCalls.length >= MAX_TOOL_CALLS) {
      throw new Error(`NIT Runtime: 工具调用次数超过上限 (${MAX_TOOL_CALLS})`)
    }

    const args: Record<string, unknown> = { ...named }
    if (positional.length === 1 && Object.keys(named).length === 0) {
      // 单个位置参数 → 作为 input
      args.input = positional[0]
    } else if (positional.length > 0) {
      args._positional = positional
    }

    logger.debug(`NIT 工具调用: ${name}(${JSON.stringify(args).slice(0, 100)})`)
    const result = await this.toolExecutor(name, args)
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

  private async evalBinaryOp(op: string, leftNode: AstNode, rightNode: AstNode): Promise<unknown> {
    const left = await this.evalNode(leftNode)
    const right = await this.evalNode(rightNode)

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

  private async evalUnaryOp(op: string, operandNode: AstNode): Promise<unknown> {
    const operand = await this.evalNode(operandNode)
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
