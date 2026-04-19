/**
 * NIT v3 AST 节点类型
 *
 * 极简 Agent DSL 的抽象语法树定义。
 * 见 18_NIT_V3.md §4
 *
 * @module packages/backend/src/nit/types
 */

// ── 节点类型枚举 ──

export type AstNode =
  | ProgramNode
  | AssignmentNode
  | FunctionCallNode
  | IfNode
  | ForNode
  | ParallelNode
  | TryCatchNode
  | ReturnNode
  | BinaryOpNode
  | UnaryOpNode
  | MemberAccessNode
  | IndexAccessNode
  | ArrayLiteralNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | IdentifierNode

// ── 程序 ──

export interface ProgramNode {
  type: 'Program'
  body: AstNode[]
}

// ── 语句 ──

export interface AssignmentNode {
  type: 'Assignment'
  name: string
  value: AstNode
}

export interface IfNode {
  type: 'If'
  condition: AstNode
  then: AstNode[]
  else?: AstNode[]
}

export interface ForNode {
  type: 'For'
  variable: string
  iterable: AstNode
  body: AstNode[]
}

export interface ParallelNode {
  type: 'Parallel'
  expressions: AstNode[]
}

export interface TryCatchNode {
  type: 'TryCatch'
  tryBlock: AstNode[]
  catchBlock: AstNode[]
}

export interface ReturnNode {
  type: 'Return'
  value: AstNode
}

// ── 表达式 ──

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: FunctionArg[]
}

export interface FunctionArg {
  /** 命名参数的 key (位置参数为 null) */
  key: string | null
  value: AstNode
}

export interface BinaryOpNode {
  type: 'BinaryOp'
  op: string
  left: AstNode
  right: AstNode
}

export interface UnaryOpNode {
  type: 'UnaryOp'
  op: string
  operand: AstNode
}

export interface MemberAccessNode {
  type: 'MemberAccess'
  object: AstNode
  field: string
}

export interface IndexAccessNode {
  type: 'IndexAccess'
  object: AstNode
  index: AstNode
}

// ── 字面量 ──

export interface ArrayLiteralNode {
  type: 'ArrayLiteral'
  elements: AstNode[]
}

export interface StringLiteralNode {
  type: 'StringLiteral'
  value: string
}

export interface NumberLiteralNode {
  type: 'NumberLiteral'
  value: number
}

export interface BooleanLiteralNode {
  type: 'BooleanLiteral'
  value: boolean
}

export interface IdentifierNode {
  type: 'Identifier'
  name: string
}

// ── Token ──

export enum TokenType {
  // 字面量
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  IDENTIFIER = 'IDENTIFIER',

  // 标点
  EQUALS = 'EQUALS', // =
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )
  LBRACE = 'LBRACE', // {
  RBRACE = 'RBRACE', // }
  LBRACKET = 'LBRACKET', // [
  RBRACKET = 'RBRACKET', // ]
  COMMA = 'COMMA', // ,
  DOT = 'DOT', // .
  PLUS = 'PLUS', // +
  MINUS = 'MINUS', // -
  NEWLINE = 'NEWLINE',

  // 比较
  EQ = 'EQ', // ==
  NEQ = 'NEQ', // !=
  LT = 'LT', // <
  GT = 'GT', // >
  LTE = 'LTE', // <=
  GTE = 'GTE', // >=

  // 关键字
  IF = 'IF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  IN = 'IN',
  PARALLEL = 'PARALLEL',
  TRY = 'TRY',
  CATCH = 'CATCH',
  RETURN = 'RETURN',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  EOF = 'EOF',
}

export interface Token {
  type: TokenType
  value: string
  line: number
  col: number
}

// ── Runtime ──

/** NIT 工具执行器 (复用 ToolExecutor 接口) */
export type NitToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** NIT 执行结果 */
export interface NitResult {
  /** 返回值 */
  value: unknown
  /** 执行的工具调用记录 */
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
}
