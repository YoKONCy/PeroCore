import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KernelEventEnvelope } from '@infos/shared'
import {
  agentStateMeasurements,
  observerPolicies,
  observerProcessedEvents,
} from '@infos/backend/database/schema'
import { KernelEventBus } from '@infos/backend/kernel'
import {
  AgentStateRepository,
  ObserverContextRegionProvider,
  ObserverService,
} from '@infos/backend/observer'

let sqlite: Database.Database | undefined
function setup() {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE observer_processed_events (event_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
    CREATE TABLE agent_state_measurements (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
      confidence REAL NOT NULL, source_event_id TEXT NOT NULL, source_event_type TEXT NOT NULL,
      explanation TEXT NOT NULL, observed_at TEXT NOT NULL, UNIQUE(source_event_id, metric)
    );
    CREATE TABLE observer_policies (
      agent_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
      inject_context INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
  `)
  const db = drizzle(sqlite, {
    schema: { agentStateMeasurements, observerPolicies, observerProcessedEvents },
  }) as never
  return new AgentStateRepository(db)
}
afterEach(() => sqlite?.close())

function event(eventId = 'event-1'): KernelEventEnvelope<string, unknown> {
  return {
    protocolVersion: 1,
    eventId: eventId as never,
    type: 'kernel.execution.completed',
    durability: 'durable',
    principalId: 'pero',
    occurredAt: '2026-08-19T00:00:00.000Z',
    payload: { state: 'completed', usage: { llmCalls: 2 } },
  }
}

describe('Observer Service与Agent State', () => {
  it('应异步消费Durable Event并按Event ID去重', async () => {
    const repo = setup()
    const bus = new KernelEventBus()
    const observer = new ObserverService(repo)
    observer.start(bus)
    await expect(bus.publish(event())).resolves.toBeUndefined()
    await bus.publish(event())
    await observer.waitForIdle()
    expect(await repo.latest('pero')).toHaveLength(2)
    const aggregate = await repo.aggregate('pero')
    expect(aggregate.execution_reliability).toMatchObject({ value: 1, samples: 1 })
    expect(aggregate.llm_workload?.samples).toBe(1)
    expect(aggregate.llm_workload?.value).toBeCloseTo(0.2)
  })

  it('Observer失败和停用不得阻断Event Bus或Agent生成主链', async () => {
    const repo = setup()
    const bus = new KernelEventBus()
    const measure = vi.fn(() => {
      throw new Error('观察器失败')
    })
    const observer = new ObserverService(repo, { measure })
    observer.start(bus)
    await expect(bus.publish(event())).resolves.toBeUndefined()
    await observer.waitForIdle()
    expect(await repo.latest('pero')).toEqual([])
    await repo.setPolicy('pero', { enabled: false, injectContext: false })
    const disabled = new ObserverService(repo, { measure })
    disabled.start(bus)
    await bus.publish(event('event-2'))
    await disabled.waitForIdle()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('Agent State应可导出、删除且删除不修改历史Durable Event', async () => {
    const repo = setup()
    await repo.commitEvent(event(), [
      {
        agentId: 'pero',
        metric: 'mood_stability',
        value: 0.8,
        confidence: 0.6,
        explanation: '测试测量',
      },
    ])
    expect((await repo.exportAgent('pero')).measurements).toHaveLength(1)
    expect(await repo.deleteAgent('pero')).toBe(1)
    expect((await repo.exportAgent('pero')).measurements).toEqual([])
  })

  it('Observer Context必须由Thread ContextPolicy和Observer Policy双重开启', async () => {
    const repo = setup()
    await repo.commitEvent(event(), [
      {
        agentId: 'pero',
        metric: 'execution_reliability',
        value: 1,
        confidence: 1,
        explanation: '完成',
      },
    ])
    const provider = new ObserverContextRegionProvider(repo)
    const request = {
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      tokenBudget: 0,
      enabledKinds: ['observer'] as const,
      now: new Date().toISOString(),
    }
    expect(await provider.provide(request)).toEqual([])
    await repo.setPolicy('pero', { enabled: true, injectContext: true })
    const regions = await provider.provide(request)
    expect(regions[0]).toMatchObject({ kind: 'observer', trust: 'derived', required: false })
    expect(regions[0]!.content).toContain('不是人格事实')
    expect(await provider.provide({ ...request, enabledKinds: [] })).toEqual([])
  })
})
