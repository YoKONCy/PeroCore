import type { Binding, NodeRun, Step, Workflow } from './domain'
import type { Store } from './store'
import { bindingLeaves, selectPath, withPath } from './bindings'
import { workflowIssues } from './workflowValidation'

export function stepVersion(
  store: Store,
  owner: string,
  id: string,
  revision: number,
): Step | undefined {
  return store.get<{ snapshot: Step }>(owner, 'step-version', `${id}:${revision}`)?.snapshot
}
export function publishedWorkflow(
  store: Store,
  owner: string,
  id: string,
  revision: number,
): Workflow | undefined {
  return store.get<{ snapshot: Workflow }>(owner, 'published', `${id}:${revision}`)?.snapshot
}

export function referenced(binding: Binding): string | undefined {
  return bindingLeaves(binding).flatMap((entry) => ('node' in entry ? [entry.node] : []))[0]
}
export function resolve(
  binding: Binding,
  inputs: Record<string, unknown>,
  nodes: NodeRun[],
): unknown {
  if ('array' in binding) {
    const values = binding.array.map((entry) => resolve(entry, inputs, nodes))
    return binding.flatten ? values.flat(1) : values
  }
  if ('select' in binding) return selectPath(resolve(binding.select, inputs, nodes), binding.path)
  if ('literal' in binding) return binding.literal
  if ('input' in binding) {
    if (!Object.hasOwn(inputs, binding.input)) throw new Error(`缺少输入：${binding.input}`)
    return selectPath(inputs[binding.input], binding.path)
  }
  const node = nodes.find((n) => n.id === binding.node)
  if (!node?.outputs || !Object.hasOwn(node.outputs, binding.output))
    throw new Error(`输出尚不可用：${binding.node}.${binding.output}`)
  return selectPath(node.outputs[binding.output], binding.path)
}

export function verifyWorkflow(
  workflow: Workflow,
  store: Store,
  owner: string,
  stack: string[] = [],
): void {
  const issue = workflowIssues(workflow, store, owner, stack).find(
    (issue) => issue.severity === 'error',
  )
  if (issue) throw new Error([issue.nodeId, issue.field, issue.message].filter(Boolean).join(' · '))
}
/** 子工作流展开为同一次执行的节点，不创建另一套嵌套任务权威。 */
export function expandWorkflow(
  workflow: Workflow,
  store: Store,
  owner: string,
): { nodes: NodeRun[]; outputs: Record<string, Binding> } {
  verifyWorkflow(workflow, store, owner)
  const nodes: NodeRun[] = []
  const expand = (
    flow: Workflow,
    prefix: string,
    inputMap?: Record<string, Binding>,
  ): Record<string, Binding> => {
    const outputs = new Map<string, Record<string, Binding>>()
    const visiting = new Set<string>()
    const translate = (binding: Binding): Binding => {
      if ('array' in binding) return { ...binding, array: binding.array.map(translate) }
      if ('select' in binding) return withPath(translate(binding.select), binding.path)
      if ('input' in binding) {
        if (inputMap && !Object.hasOwn(inputMap, binding.input))
          throw new Error(`缺少子工作流输入：${binding.input}`)
        return inputMap ? withPath(inputMap[binding.input]!, binding.path) : binding
      }
      if ('literal' in binding) return binding
      visit(binding.node)
      const result = outputs.get(binding.node)?.[binding.output]
      if (!result) throw new Error(`引用未声明输出：${binding.node}.${binding.output}`)
      return withPath(result, binding.path)
    }
    const visit = (id: string): void => {
      if (outputs.has(id)) return
      if (visiting.has(id)) throw new Error('工作流包含循环依赖')
      visiting.add(id)
      const node = flow.nodes.find((n) => n.id === id)!
      const step = stepVersion(store, owner, node.stepId, node.stepRevision)!
      const bindings = Object.fromEntries(
        Object.entries(node.inputs).map(([key, value]) => [key, translate(value)]),
      )
      if (step.implementation.kind === 'workflow') {
        const nested = publishedWorkflow(
          store,
          owner,
          step.implementation.workflowId,
          step.implementation.revision,
        )!
        outputs.set(id, expand(nested, `${prefix}${id}/`, bindings))
      } else {
        const expandedId = `${prefix}${id}`
        nodes.push({
          id: expandedId,
          step: structuredClone(step),
          inputs: bindings,
          state: 'pending',
        })
        const properties = step.outputSchema.properties as Record<string, unknown> | undefined
        outputs.set(
          id,
          Object.fromEntries(
            Object.keys(properties ?? {}).map((key) => [key, { node: expandedId, output: key }]),
          ),
        )
      }
      visiting.delete(id)
      if (nodes.length > 128) throw new Error('展开后的节点超过 128 个')
    }
    flow.nodes.forEach((node) => visit(node.id))
    return Object.fromEntries(
      Object.entries(flow.outputs).map(([key, binding]) => [key, translate(binding)]),
    )
  }
  return { nodes, outputs: expand(workflow, '') }
}
