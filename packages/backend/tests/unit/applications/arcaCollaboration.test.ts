import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArcaCollaborationService } from '../../../src/applications/arcaCollaboration'
import type { BackgroundTaskInfo } from '../../../src/services/task/backgroundTaskService'

const services: ArcaCollaborationService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()))
})
function setup() {
  let instanceId: string | undefined = 'instance-1'
  let completion: ((task: BackgroundTaskInfo) => Promise<string>) | undefined
  const records = new Map<string, BackgroundTaskInfo>()
  const grants = new Map<
    string,
    {
      collaborationId: string
      instanceId: string
      changeSetId: string
      revoked: boolean
      proposal: unknown
    }
  >()
  const tasks = {
    registerApplicationCompletion: vi.fn((_app: string, callback: typeof completion) => {
      completion = callback
      return () => {
        completion = undefined
      }
    }),
    getTask: vi.fn(async (id: string) => records.get(id) ?? null),
    query: vi.fn(async (input: { status?: string[] }) => {
      const items = [...records.values()].filter(
        (task) => !input.status || input.status.includes(task.status),
      )
      return { items, total: items.length, pageSize: 100 }
    }),
    cancel: vi.fn(async (id: string) => {
      const task = records.get(id)!
      task.status = 'cancelled'
      return task
    }),
    dispatch: vi.fn(
      async (input: {
        agentId: string
        idempotencyKey: string
        metadata: Record<string, unknown>
        title: string
        targetThreadId?: string
        instruction: string
      }) => {
        const id = `bgtask_${createHash('sha256').update(`${input.agentId}:${input.idempotencyKey}`).digest('hex')}`
        const task = {
          id,
          agentId: input.agentId,
          metadata: input.metadata,
          title: input.title,
          instruction: input.instruction,
          status: 'queued',
          targetThreadId: input.targetThreadId ?? null,
          createdAt: '2026-10-17T00:00:00.000Z',
          updatedAt: '2026-10-17T00:00:00.000Z',
          result: null,
          errorMessage: null,
          progress: null,
          currentStage: null,
        } as unknown as BackgroundTaskInfo
        records.set(id, task)
        return task
      },
    ),
  }
  const arca = {
    available: () => !!instanceId,
    invoke: vi.fn(async (operation: string, input: Record<string, unknown>) => {
      if (operation === 'document.inspect') return { revisionId: 'revision-1' }
      if (operation === 'collaboration.grant') {
        const id = String(input.collaborationId)
        const grant = {
          collaborationId: id,
          instanceId: instanceId!,
          changeSetId: `arca-collaboration:${id}`,
          revoked: false,
          proposal: null,
        }
        grants.set(id, grant)
        return grant
      }
      if (operation === 'collaboration.get')
        return grants.get(String(input.collaborationId)) ?? null
      if (operation === 'collaboration.revoke') {
        const grant = grants.get(String(input.collaborationId))
        if (grant) grant.revoked = true
        return { revoked: true }
      }
      if (operation === 'document.changeset.validate') return { status: 'validated' }
      throw new Error('意外的测试调用')
    }),
  }
  const threads = {
    getThread: vi.fn(async () => ({ status: 'active', purpose: 'conversation', agentId: 'pero' })),
  }
  const service = new ArcaCollaborationService(
    tasks as never,
    arca as never,
    { get: async () => undefined } as never,
    () => (instanceId ? { instanceId } : undefined),
    threads as never,
  )
  services.push(service)
  service.start()
  const input = {
    documentId: 'document-1',
    instruction: '润色正文',
    scope: 'document' as const,
    agentId: 'pero',
    requestId: 'request-1',
    baseRevisionId: 'revision-1',
  }
  return {
    service,
    tasks,
    arca,
    records,
    grants,
    threads,
    input,
    completion: (task: BackgroundTaskInfo) => completion!(task),
    loseInstance: () => {
      instanceId = undefined
    },
  }
}

describe('Arca 宿主协作闭环', () => {
  it('重复提交返回同一任务，原会话与真实实例绑定，并拒绝同键不同内容', async () => {
    const fixture = setup()
    const input = { ...fixture.input, originThreadId: 'original-thread' }
    const first = await fixture.service.create(input),
      second = await fixture.service.create(input)
    expect(second.taskId).toBe(first.taskId)
    expect(fixture.tasks.dispatch).toHaveBeenCalledOnce()
    expect(fixture.tasks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        realmId: 'infos.arca',
        targetThreadId: 'original-thread',
        completionAction: 'send_to_chat',
        metadata: expect.objectContaining({
          applicationInstanceId: 'instance-1',
          collaborationId: expect.any(String),
          changeSetId: expect.any(String),
        }),
      }),
    )
    await expect(fixture.service.create({ ...input, instruction: '另一份要求' })).rejects.toThrow(
      '同一请求标识',
    )
  })
  it('同一作者的其他提案不能作为任务产物，权威提案确认后才允许交付', async () => {
    const fixture = setup(),
      created = await fixture.service.create(fixture.input)
    const task = fixture.records.get(created.taskId)!
    const id = String(task.metadata.collaborationId),
      grant = fixture.grants.get(id)!
    await expect(fixture.completion(task)).rejects.toThrow('有效提案')
    grant.proposal = {
      changeSetId: 'another-proposal',
      actorPrincipalId: 'another-agent',
      status: 'validated',
    }
    await expect(fixture.completion(task)).rejects.toThrow('有效提案')
    grant.proposal = {
      changeSetId: grant.changeSetId,
      actorPrincipalId: 'pero',
      status: 'validated',
    }
    await expect(fixture.completion(task)).resolves.toContain(grant.changeSetId)
    expect(fixture.arca.invoke).toHaveBeenCalledWith(
      'document.changeset.validate',
      expect.objectContaining({ __arcaCollaborationId: id, changeSetId: grant.changeSetId }),
      expect.any(Object),
    )
  })
  it('停止先撤销运行任务授权并取消任务，随后拒绝新提交', async () => {
    const fixture = setup(),
      created = await fixture.service.create(fixture.input)
    const task = fixture.records.get(created.taskId)!
    await fixture.service.prepareStop()
    expect(fixture.grants.get(String(task.metadata.collaborationId))?.revoked).toBe(true)
    expect(task.status).toBe('cancelled')
    await expect(fixture.service.create({ ...fixture.input, requestId: 'next' })).rejects.toThrow(
      '尚未就绪',
    )
  })
  it('不能向另一角色的原会话派发交付', async () => {
    const fixture = setup()
    fixture.threads.getThread.mockResolvedValue({
      status: 'active',
      purpose: 'conversation',
      agentId: 'nana',
    })
    await expect(
      fixture.service.create({ ...fixture.input, originThreadId: 'another-thread' }),
    ).rejects.toThrow('不属于所选协作者')
    expect(fixture.tasks.dispatch).not.toHaveBeenCalled()
  })
})
