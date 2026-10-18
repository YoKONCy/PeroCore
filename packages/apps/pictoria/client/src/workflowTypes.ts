import type { FieldSchema } from './types'
export type Binding =
  | { input: string; path?: Array<string | number> }
  | { node: string; output: string; path?: Array<string | number> }
  | { literal: unknown }
  | { array: Binding[]; flatten?: boolean }
  | { select: Binding; path: Array<string | number> }
export interface WorkflowExampleStep {
  name: string
  kind: 'llm' | 'service'
  usageDescription: string
  inputSchema: FieldSchema
  outputSchema: FieldSchema
}
export interface WorkflowNote {
  id: string
  title: string
  text: string
  x: number
  y: number
  anchor?: string
}
export interface WorkflowNode {
  id: string
  stepId?: string
  stepRevision?: number
  inputs: Record<string, Binding>
  x: number
  y: number
  comment: string
  label?: string
  example?: WorkflowExampleStep
}
export interface WorkflowDraft {
  id: string
  name: string
  revision: number
  usageDescription: string
  inputSchema: FieldSchema
  outputSchema: FieldSchema
  nodes: WorkflowNode[]
  notes: WorkflowNote[]
  outputs: Record<string, Binding>
  viewport?: { x: number; y: number; scale: number }
  publishedRevision?: number
  publishedStepRevision?: number
  updatedAt?: string
  io: { input: { x: number; y: number }; output: { x: number; y: number } }
  routes: Record<string, { sourcePort: 'right' | 'bottom'; targetPort: 'left' | 'top' }>
  testInputs?: Record<string, unknown>
}
export interface WorkflowIssue {
  code: string
  message: string
  nodeId?: string
  field?: string
  severity: 'error' | 'warning'
}
export function leaves(
  binding?: Binding,
): Array<Exclude<Binding, { array: Binding[] } | { select: Binding }>> {
  return !binding
    ? []
    : 'array' in binding
      ? binding.array.flatMap(leaves)
      : 'select' in binding
        ? leaves(binding.select)
        : [binding]
}
export function withoutSource(binding: Binding, id: string): Binding | undefined {
  if ('node' in binding && binding.node === id) return undefined
  if ('array' in binding)
    return {
      ...binding,
      array: binding.array.flatMap((item) => {
        const next = withoutSource(item, id)
        return next ? [next] : []
      }),
    }
  if ('select' in binding) {
    const next = withoutSource(binding.select, id)
    return next ? { ...binding, select: next } : undefined
  }
  return binding
}
