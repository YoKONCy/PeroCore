import type { BuiltinTool } from '../index'
import type { FactsRepository } from '../../repositories/facts.repo'

let facts: FactsRepository | null = null

export function setFactsToolDeps(repository: FactsRepository): void {
  facts = repository
}

function requireFacts(): FactsRepository {
  if (!facts) throw new Error('事实库服务未初始化')
  return facts
}

export const queryFactsTool: BuiltinTool = {
  name: 'query_facts',
  async execute(args) {
    const object = typeof args.object === 'string' ? args.object.trim() : ''
    if (!object) throw new Error('必须提交要查询的对象名称或别名')
    return JSON.stringify(await requireFacts().query(object))
  },
}

export const writeFactTool: BuiltinTool = {
  name: 'write_fact',
  async execute(args, ctx) {
    return JSON.stringify(
      await requireFacts().write({
        objectId: typeof args.objectId === 'string' ? args.objectId : undefined,
        standardName: typeof args.standardName === 'string' ? args.standardName : undefined,
        aliases: Array.isArray(args.aliases)
          ? args.aliases.filter((item): item is string => typeof item === 'string')
          : undefined,
        statement: String(args.fact ?? ''),
        observedAt:
          typeof args.observedAt === 'string' ? args.observedAt : new Date().toISOString(),
        source: typeof args.source === 'string' ? args.source : undefined,
        confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
        createdByAgentId: ctx.agentId,
        operationId: typeof args.operationId === 'string' ? args.operationId : undefined,
      }),
    )
  },
}

export const supersedeFactTool: BuiltinTool = {
  name: 'supersede_fact',
  async execute(args, ctx) {
    return JSON.stringify(
      await requireFacts().supersede(String(args.objectId ?? ''), String(args.oldFactId ?? ''), {
        statement: String(args.newFact ?? ''),
        observedAt:
          typeof args.observedAt === 'string' ? args.observedAt : new Date().toISOString(),
        source: typeof args.source === 'string' ? args.source : undefined,
        confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
        createdByAgentId: ctx.agentId,
        operationId: typeof args.operationId === 'string' ? args.operationId : undefined,
      }),
    )
  },
}

export const deleteFactTool: BuiltinTool = {
  name: 'delete_fact',
  async execute(args) {
    await requireFacts().deleteFact(
      String(args.factId ?? ''),
      typeof args.operationId === 'string' ? args.operationId : undefined,
    )
    return JSON.stringify({ deleted: true })
  },
}

export const addFactObjectAliasTool: BuiltinTool = {
  name: 'add_fact_object_alias',
  async execute(args) {
    await requireFacts().addAlias(
      String(args.objectId ?? ''),
      String(args.alias ?? ''),
      typeof args.operationId === 'string' ? args.operationId : undefined,
    )
    return JSON.stringify({ updated: true })
  },
}

export const removeFactObjectAliasTool: BuiltinTool = {
  name: 'remove_fact_object_alias',
  async execute(args) {
    await requireFacts().removeAlias(
      String(args.objectId ?? ''),
      String(args.alias ?? ''),
      typeof args.operationId === 'string' ? args.operationId : undefined,
    )
    return JSON.stringify({ updated: true })
  },
}
