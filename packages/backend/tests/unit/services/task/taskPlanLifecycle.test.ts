import {
  createDrizzleConnection,
  closeDrizzleConnection,
  type DrizzleDb,
} from '@infos/backend/database/connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@infos/backend/database/schema'
import { TaskPlanRepository } from '@infos/backend/repositories/taskPlan.repo'
import { ThreadRepository } from '@infos/backend/repositories/thread.repo'
import { TaskPlanService } from '@infos/backend/services/task/taskPlanService'
import { ThreadService } from '@infos/backend/services/thread/threadService'

const connections: DrizzleDb[] = []
afterEach(() => {
  for (const connection of connections.splice(0)) closeDrizzleConnection(connection)
})
function setup() {
  // 使用正式初始化入口，包含基线迁移之后的兼容字段补齐。
  const db = createDrizzleConnection(':memory:')
  connections.push(db)
  db.insert(schema.threads)
    .values({ id: 'conversation', agentId: 'pero', channel: 'desktop' })
    .run()
  const service = new TaskPlanService(new TaskPlanRepository(db), async () => {})
  const scope = {
    agentId: 'pero',
    threadId: 'conversation',
    pairId: 'first-turn',
    toolCallId: 'create',
  }
  const create = () =>
    service.update(scope, {
      action: 'create',
      title: '绘制页面',
      steps: [{ id: 'draw', title: '创建 HTML', status: 'in_progress' }],
    })
  return { db, service, scope, create }
}

describe('对话清单的撤回边界', () => {
  it('重启恢复清理没有成功回复的轮次清单，保留已交付的清单', async () => {
    const { db, service, create, scope } = setup()
    await create()
    db.insert(schema.threadMessages)
      .values({ threadId: scope.threadId, pairId: scope.pairId, role: 'user', content: '绘制页面' })
      .run()
    await service.recoverInterruptedTurns()
    expect(service.get(scope.threadId, scope.agentId)).toBeNull()
    const nextScope = { ...scope, pairId: 'successful-turn' }
    const completed = await service.update(nextScope, {
      action: 'create',
      title: '已完成的清单',
      steps: [{ id: 'draw', title: '创建页面', status: 'completed' }],
    })
    db.insert(schema.threadMessages)
      .values({
        threadId: scope.threadId,
        pairId: nextScope.pairId,
        role: 'assistant',
        agentId: scope.agentId,
        content: '已完成',
      })
      .run()
    await service.recoverInterruptedTurns()
    expect(service.get(scope.threadId, scope.agentId)?.id).toBe(completed?.id)
  })

  it('创建后本轮失败，清单不再占位；重复回退没有副作用', async () => {
    const { service, create, scope } = setup()
    await create()
    await service.rollbackPairs(scope.threadId, [scope.pairId])
    expect(service.get(scope.threadId, scope.agentId)).toBeNull()
    await service.rollbackPairs(scope.threadId, [scope.pairId])
    expect(service.get(scope.threadId, scope.agentId)).toBeNull()
  })

  it('撤回后续更新恢复此前步骤，修订号仍递增', async () => {
    const { service, create, scope } = setup()
    const previous = (await create())!
    const updated = (await service.update(
      { ...scope, pairId: 'second-turn', toolCallId: 'update' },
      {
        action: 'update',
        expectedRevision: previous.revision,
        steps: [{ id: 'draw', title: '创建 HTML', status: 'completed' }],
      },
    ))!
    await service.rollbackPairs(scope.threadId, ['second-turn'])
    const restored = service.get(scope.threadId, scope.agentId)!
    expect(restored.steps).toEqual(previous.steps)
    expect(restored.revision).toBeGreaterThan(updated.revision)
  })

  it('单独撤回较早轮次不会覆盖之后已保存的计划', async () => {
    const { service, create, scope } = setup()
    const previous = (await create())!
    const newer = (await service.update(
      { ...scope, pairId: 'second-turn', toolCallId: 'update' },
      {
        action: 'update',
        expectedRevision: previous.revision,
        title: '新的要求',
        steps: [{ id: 'draw', title: '创建 SVG', status: 'in_progress' }],
      },
    ))!
    await service.rollbackPairs(scope.threadId, [scope.pairId])
    expect(service.get(scope.threadId, scope.agentId)).toEqual(newer)
  })

  it('非法创建不留清单或可撤回的成功变更', async () => {
    const { db, service, scope } = setup()
    await expect(
      service.update(scope, {
        action: 'create',
        title: '绘制页面',
        steps: [
          { id: 'one', title: '绘制', status: 'in_progress' },
          { id: 'two', title: '验证', status: 'in_progress' },
        ],
      }),
    ).rejects.toThrow()
    expect(service.get(scope.threadId, scope.agentId)).toBeNull()
    expect(db.select().from(schema.taskPlanMutations).all()).toHaveLength(0)
  })

  it('先撤回较早轮次再撤回后续轮次，不会重新出现已撤回的清单', async () => {
    const { service, create, scope } = setup()
    const original = (await create())!
    await service.update(
      { ...scope, pairId: 'second-turn' },
      {
        action: 'update',
        expectedRevision: original.revision,
        steps: [{ id: 'draw', title: '创建 HTML', status: 'completed' }],
      },
    )
    await service.rollbackPairs(scope.threadId, [scope.pairId])
    expect(service.get(scope.threadId, scope.agentId)).not.toBeNull()
    await service.rollbackPairs(scope.threadId, ['second-turn'])
    expect(service.get(scope.threadId, scope.agentId)).toBeNull()
  })

  it('整条会话删除不读取或执行文件回滚，同时清除清单', async () => {
    const { db, service, scope, create } = setup()
    await create()
    const rollback = vi.fn()
    const filePreview = vi.fn()
    const threads = new ThreadService(new ThreadRepository(db), undefined, {
      rollback,
      previewThread: filePreview,
    } as never)
    threads.setPlanLifecycle(service)
    const preview = await threads.previewThreadRewind(scope.threadId)
    expect(preview.files).toHaveLength(0)
    const result = await threads.rewindThread(scope.threadId)
    expect(result.workspace.rolledBackCount).toBe(0)
    expect(rollback).not.toHaveBeenCalled()
    expect(filePreview).not.toHaveBeenCalled()
    expect(await threads.getThread(scope.threadId)).toBeNull()
    expect(
      db
        .select()
        .from(schema.taskPlans)
        .all()
        .every((plan) => plan.status === 'archived'),
    ).toBe(true)
  })
})
