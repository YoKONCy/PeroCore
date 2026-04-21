/**
 * NIT 模块导出
 *
 * Agent DSL 编排引擎 (D57)
 * - Lexer: 脚本 → Token 流
 * - Parser: Token 流 → AST
 * - Runtime: AST → 执行结果
 *
 * NIT 解释器作为 FC 工具 (run_script) 暴露给 LLM，
 * 不再作为独立的文本内调用通道。
 *
 * @module packages/backend/src/nit
 */

export { NitLexer } from './lexer'
export { NitParser } from './parser'
export { NitRuntime } from './runtime'
export { ThinkingStreamFilter } from './streamFilter'
export type { NitToolExecutor, NitResult, AstNode, Token } from './types'
export { TokenType } from './types'

import { NitLexer } from './lexer'
import { NitParser } from './parser'
import { NitRuntime } from './runtime'
import type { NitToolExecutor, NitResult } from './types'

/**
 * 一站式执行 NIT 脚本
 *
 * @param script NIT 脚本文本
 * @param toolExecutor 工具执行器 (走 ToolRegistry)
 * @returns 执行结果
 *
 * @example
 * ```ts
 * const result = await executeNit(
 *   'result = web_search(query="hello")\nreturn result',
 *   async (name, args) => toolRegistry.execute(name, args),
 * )
 * ```
 */
export async function executeNit(
  script: string,
  toolExecutor: NitToolExecutor,
): Promise<NitResult> {
  // 1. 词法分析
  const lexer = new NitLexer(script)
  const tokens = lexer.tokenize()

  // 2. 语法分析
  const parser = new NitParser(tokens)
  const ast = parser.parse()

  // 3. 执行
  const runtime = new NitRuntime(toolExecutor)
  return runtime.execute(ast)
}
