import { t as __t } from './i18n'
import type { Binding, Step, Workflow, ServiceProfile } from './domain'
import { effectiveService } from './providers'
import type { Store } from './store'
import { bindingLeaves, dependencies } from './bindings'
import { compileSchema, validate } from './schema'

export interface WorkflowIssue {
  code: string
  message: string
  nodeId?: string
  field?: string
  severity: 'error' | 'warning'
}
type Schema = Record<string, unknown>
const properties = (schema?: Schema) => (schema?.properties || {}) as Record<string, Schema>
function pathSchema(
  schema: Schema | undefined,
  path: Array<string | number> = [],
): Schema | undefined {
  for (const key of path)
    schema =
      schema?.type === 'array' && typeof key === 'number'
        ? (schema?.items as Schema | undefined)
        : properties(schema)[String(key)]
  return schema
}
function literalSchema(value: unknown): Schema {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value))
    return { type: 'array', items: value.length ? literalSchema(value[0]) : {} }
  if (value && typeof value === 'object')
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, literalSchema(entry)]),
      ),
    }
  return { type: typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value }
}
function compatible(source?: Schema, target?: Schema): boolean {
  if (!source || !target || !source.type || !target.type) return true
  const sourceTypes = Array.isArray(source.type) ? source.type : [source.type],
    targetTypes = Array.isArray(target.type) ? target.type : [target.type]
  if (
    !sourceTypes.every(
      (type) =>
        targetTypes.includes(type) || (type === 'integer' && targetTypes.includes('number')),
    )
  )
    return false
  return (
    !sourceTypes.includes('array') || compatible(source.items as Schema, target.items as Schema)
  )
}

/** 提前报告可确定的结构／类型问题；实际输出仍在执行时按 schema 验证。 */
export function workflowIssues(
  workflow: Workflow,
  store: Store,
  owner: string,
  stack: string[] = [],
  budget = { nodes: 0 },
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [],
    steps = new Map<string, Step>(),
    ids = new Set<string>()
  const add = (code: string, message: string, nodeId?: string, field?: string) =>
    issues.push({ code, message, nodeId, field, severity: 'error' })
  if (stack.length >= 8 || stack.includes(workflow.id)) {
    add('recursive', '工作流递归或嵌套超过限制')
    return issues
  }
  for (const [field, schema] of [
    ['inputSchema', workflow.inputSchema],
    ['outputSchema', workflow.outputSchema],
  ] as const) {
    try {
      compileSchema(schema)
    } catch (error) {
      add('schema', error instanceof Error ? error.message : '字段定义无效', undefined, field)
    }
  }
  for (const node of workflow.nodes) {
    if (++budget.nodes > 128) {
      add('limit', '展开后的节点超过 128 个')
      return issues
    }
    if (ids.has(node.id)) add('duplicate', '节点 ID 重复', node.id)
    ids.add(node.id)
    const step = store.get<{ snapshot: Step }>(
      owner,
      'step-version',
      `${node.stepId}:${node.stepRevision}`,
    )?.snapshot
    if (!step || !step.enabled || !store.get<Step>(owner, 'step', node.stepId)?.enabled) {
      add('step', '步骤不可用或已停用', node.id)
      continue
    }
    steps.set(node.id, step)
    if (step.implementation.kind === 'workflow') {
      const nested = store.get<{ snapshot: Workflow }>(
        owner,
        'published',
        `${step.implementation.workflowId}:${step.implementation.revision}`,
      )?.snapshot
      if (!nested) add('workflow', '已发布工作流不存在', node.id)
      else
        for (const issue of workflowIssues(nested, store, owner, [...stack, workflow.id], budget))
          issues.push({ ...issue, nodeId: node.id, message: `${step.name}：${issue.message}` })
      if (budget.nodes > 128) return issues
    } else if (step.implementation.kind === 'service') {
      const service = effectiveService(
        store,
        owner,
        store.get<ServiceProfile>(owner, 'service', step.implementation.serviceId),
      )
      if (
        !service?.enabled ||
        (service.requiresCredential && !store.secret(owner, service.credentialId ?? service.id))
      )
        add('service', '服务未配置', node.id)
    }
  }
  const schemaOf = (binding: Binding): Schema | undefined => {
    if ('literal' in binding) return literalSchema(binding.literal)
    if ('select' in binding) {
      if (
        'array' in binding.select &&
        !binding.select.flatten &&
        typeof binding.path[0] === 'number'
      )
        return pathSchema(
          binding.select.array[binding.path[0]]
            ? schemaOf(binding.select.array[binding.path[0]]!)
            : undefined,
          binding.path.slice(1),
        )
      return pathSchema(schemaOf(binding.select), binding.path)
    }
    if ('array' in binding) {
      const item = binding.array[0] ? schemaOf(binding.array[0]) : undefined
      return { type: 'array', items: binding.flatten && item?.type === 'array' ? item.items : item }
    }
    return pathSchema(
      'input' in binding
        ? properties(workflow.inputSchema)[binding.input]
        : properties(steps.get(binding.node)?.outputSchema)[binding.output],
      binding.path,
    )
  }
  const check = (binding: Binding, target?: Schema, nodeId?: string, field?: string) => {
    for (const leaf of bindingLeaves(binding)) {
      if (
        'input' in leaf &&
        workflow.inputSchema.additionalProperties === false &&
        !Object.hasOwn(properties(workflow.inputSchema), leaf.input)
      )
        add('input', `未声明输入：${leaf.input}`, nodeId, field)
      if ('node' in leaf && !ids.has(leaf.node))
        add('reference', `节点不存在：${leaf.node}`, nodeId, field)
      else if (
        'node' in leaf &&
        !Object.hasOwn(properties(steps.get(leaf.node)?.outputSchema), leaf.output)
      )
        add('output', `未声明输出：${leaf.output}`, nodeId, field)
    }
    const inspect = (value: Binding, expected?: Schema): void => {
      if ('literal' in value) {
        if (expected)
          try {
            validate(expected, value.literal)
          } catch {
            add('literal', '固定值不符合字段要求', nodeId, field)
          }
      } else if ('array' in value) {
        if (expected?.type && expected.type !== 'array')
          add('type', '此字段不接受多项输入', nodeId, field)
        if (!value.array.length && Number(expected?.minItems || 0) > 0)
          add('required', '添加输入引用', nodeId, field)
        for (const item of value.array) {
          const source = schemaOf(item)
          inspect(
            item,
            value.flatten && source?.type === 'array' ? expected : (expected?.items as Schema),
          )
        }
      } else {
        const source = schemaOf(value)
        if (!compatible(source, expected)) add('type', '输入与输出类型不匹配', nodeId, field)
        if ('path' in value && value.path?.length && !source)
          issues.push({
            code: 'path',
            message: __t('apps.pictoria.ui', '选取路径将在运行时校验'),
            nodeId,
            field,
            severity: 'warning',
          })
      }
    }
    inspect(binding, target)
  }
  for (const node of workflow.nodes) {
    const schema = steps.get(node.id)?.inputSchema
    if (!schema) continue
    for (const key of (schema.required as string[]) || [])
      if (!Object.hasOwn(node.inputs, key)) add('required', '必填输入未连接', node.id, key)
    for (const [key, binding] of Object.entries(node.inputs)) {
      if (schema.additionalProperties === false && !Object.hasOwn(properties(schema), key))
        add('field', '输入字段未声明', node.id, key)
      check(binding, properties(schema)[key], node.id, key)
    }
  }
  for (const key of (workflow.outputSchema.required as string[]) || [])
    if (!Object.hasOwn(workflow.outputs, key)) add('required', '输出未连接', undefined, key)
  for (const [key, binding] of Object.entries(workflow.outputs)) {
    if (
      workflow.outputSchema.additionalProperties === false &&
      !Object.hasOwn(properties(workflow.outputSchema), key)
    )
      add('field', '输出字段未声明', undefined, key)
    check(binding, properties(workflow.outputSchema)[key], undefined, key)
  }
  const completed = new Set<string>()
  while (completed.size < ids.size) {
    const ready = workflow.nodes.filter(
      (node) =>
        !completed.has(node.id) && dependencies(node.inputs).every((id) => completed.has(id)),
    )
    if (!ready.length) {
      if (!issues.some((issue) => issue.code === 'reference')) add('cycle', '连线包含循环依赖')
      break
    }
    ready.forEach((node) => completed.add(node.id))
  }
  return issues
}
