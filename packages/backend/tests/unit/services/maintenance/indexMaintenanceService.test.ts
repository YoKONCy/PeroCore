import { describe, expect, it, vi } from 'vitest'
import { IndexMaintenanceService } from '@infos/backend/services/maintenance/indexMaintenanceService'
import type { KernelScheduleInput } from '@infos/backend/kernel/kernelScheduler'

function fixture() {
  const agents = [{ id: 'pero' }]
  const context = {
    agentManager: {
      listAgents: () => agents,
      getAgent: (id: string) => agents.find((agent) => agent.id === id),
    },
    storeRegistry: {
      listStoredAgentIds: () => ['pero', 'lin'],
      getDimension: () => 768,
      resolveAgentStorePath: (id: string, scope: string) => `${id}/${scope}`,
      resolveSharedStorePath: (scope: string) => scope,
      describeStore: () => ({ exists: true, dimension: 768, nodeCount: 1 }),
      rebuildSocialStore: vi.fn(),
    },
    embeddingService: { getConfig: () => config, isAvailable: true },
    kernelScheduler: {
      get: () => ({ state: 'queued' }),
      submit: vi.fn(async (_input: KernelScheduleInput) => ({
        descriptor: { executionId: 'rebuild-1' },
      })),
      subscribe: () => () => {},
    },
  }
  const config = { model: '测试模型', dimension: 768 }
  return { agents, context, service: new IndexMaintenanceService(context as never) }
}

describe('已删除角色的索引维护边界', () => {
  it('磁盘残留 lin 的向量库不能让已删除角色重新出现在列表', () => {
    const { service } = fixture()
    const indexes = service.status().indexes
    expect(indexes).toHaveLength(4)
    expect(indexes.filter((item) => item.agentId).map((item) => item.agentId)).toEqual([
      'pero',
      'pero',
    ])
    expect(indexes.some((item) => item.agentId === 'lin')).toBe(false)
  })

  it('拒绝为只有残留库、没有角色档案的 lin 重建索引', async () => {
    const { service, context } = fixture()
    await expect(service.rebuild('social', 'lin')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(context.kernelScheduler.submit).not.toHaveBeenCalled()
  })

  it('排队期间角色被删除后不能再为它重建图谱', async () => {
    const { service, context, agents } = fixture()
    await service.rebuild('social', 'pero')
    agents.splice(0)
    const input = context.kernelScheduler.submit.mock.calls[0]![0]
    await expect(input.run({ signal: new AbortController().signal } as never)).rejects.toThrow(
      '角色已删除',
    )
    expect(context.storeRegistry.rebuildSocialStore).not.toHaveBeenCalled()
  })
})
