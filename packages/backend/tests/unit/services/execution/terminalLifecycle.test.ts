import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ExecutionSessionManager,
  createDefaultSandboxProfile,
  type ExecutionSession,
} from '@infos/backend/services/execution/executionSession'
import {
  TerminalManager,
  TerminalRunError,
} from '@infos/backend/services/execution/terminalManager'
import type { SandboxRunner, ProcessSpec } from '@infos/backend/services/execution/sandboxRunner'
import { waitForCancellationCleanup } from '@infos/backend/services/execution/cancellation'

const managers: TerminalManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose()
  vi.useRealTimers()
})

function setup() {
  const sessions = new ExecutionSessionManager()
  const session: ExecutionSession = {
    id: 'session',
    ownerAgentId: 'pero',
    threadId: 'thread',
    channel: 'desktop',
    workspaceRoot: path.resolve('.'),
    sandboxProfile: createDefaultSandboxProfile('workspace-write', path.resolve('.')),
    state: 'active',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }
  vi.spyOn(sessions, 'get').mockImplementation((id) => (id === session.id ? session : undefined))
  vi.spyOn(sessions, 'list').mockReturnValue([session])
  let data: (chunk: string) => void = () => {}
  let exit: (code: number) => void = () => {}
  const handles = new Map<string, { data: (value: string) => void; exit: (code: number) => void }>()
  const runner = {
    spawnTerminal: vi.fn(async (_session: unknown, spec: ProcessSpec) => {
      const id = `process-${handles.size}`
      spec.signal?.addEventListener(
        'abort',
        () => {
          handles.get(id)?.exit(-1)
        },
        { once: true },
      )
      return {
        id,
        pid: 1,
        backend: 'pipe' as const,
        onData(listener: typeof data) {
          data = listener
          handles.set(id, { data, exit })
        },
        onExit(listener: typeof exit) {
          exit = listener
          handles.set(id, { data, exit })
        },
        write: vi.fn(),
        resize: vi.fn(),
      }
    }),
    terminateProcess: vi.fn(async (id: string) => {
      handles.get(id)?.exit(-1)
    }),
    disposeSession: vi.fn(async () => {}),
  }
  const manager = new TerminalManager(sessions, runner as unknown as SandboxRunner, {
    archiveAfterMs: 100,
    historyMs: 1000,
    perSession: 2,
    total: 3,
  })
  managers.push(manager)
  const create = (signal?: AbortSignal, owner: 'agent' | 'user' = 'agent') =>
    manager.create({ executionSessionId: session.id, command: '静默任务', signal, owner })
  return {
    manager,
    session,
    runner,
    create,
    handles,
    output: (value: string) => data(value),
    exit: (code: number) => exit(code),
  }
}

describe('终端等待与托管生命周期', () => {
  it('等待超时明确返回，静默长任务继续运行，直到真实退出才完成', async () => {
    vi.useFakeTimers()
    const { manager, session, create, exit, runner } = setup()
    const terminal = await create()
    const waiting = manager.wait(terminal.id, session.id, { timeoutMs: 10, exitOnly: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(await waiting).toMatchObject({
      waitReason: 'timeout',
      timedOut: true,
      completed: false,
      status: 'running',
    })
    expect(runner.terminateProcess).not.toHaveBeenCalled()
    exit(0)
    expect(await manager.wait(terminal.id, session.id, { exitOnly: true })).toMatchObject({
      waitReason: 'exit',
      timedOut: false,
      completed: true,
      exitCode: 0,
    })
  })

  it('缓冲裁剪后用绝对游标等待，不会把新输出或 pattern 漏掉', async () => {
    const { manager, session, create, output } = setup()
    session.sandboxProfile.maxOutputBytes = 16
    const terminal = await create()
    output('a'.repeat(80))
    const waiting = manager.wait(terminal.id, session.id, {
      cursor: 80,
      pattern: '完成',
      timeoutMs: 1000,
    })
    output('完成')
    expect(await waiting).toMatchObject({
      waitReason: 'pattern',
      matched: true,
      output: '完成',
      nextCursor: 82,
    })
    expect(Buffer.byteLength(manager.read(terminal.id, session.id, 0).output)).toBeLessThanOrEqual(
      16,
    )
  })

  it('短命令超时终止进程且返回已有输出，历史 ID 仍可读取', async () => {
    vi.useFakeTimers()
    const { manager, session, output, runner } = setup()
    const running = manager.run({
      executionSessionId: session.id,
      command: '长计算',
      timeoutMs: 100,
    })
    const assertion = expect(running).rejects.toBeInstanceOf(TerminalRunError)
    await vi.advanceTimersByTimeAsync(0)
    output('已完成步骤一\n')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    const error = (await running.catch((value: TerminalRunError) => value)) as TerminalRunError
    expect(error).toMatchObject({
      code: 'TERMINAL_TIMEOUT',
      result: { output: '已完成步骤一\n', terminal: { exitReason: 'timeout', status: 'killed' } },
    })
    expect(runner.terminateProcess).toHaveBeenCalled()
    expect(manager.list(session.id)).toEqual([])
    expect(manager.read(error.result.terminal.id, session.id).output).toBe('已完成步骤一\n')
  })

  it('跨轮托管后旧信号不再误杀；会话停止只回收 Agent 进程，保留手动终端', async () => {
    const { manager, session, create } = setup()
    const round = new AbortController()
    const terminal = await create(round.signal)
    const manual = await create(undefined, 'user')
    manager.handoff(session.id, round.signal)
    round.abort()
    expect(manager.get(terminal.id, session.id).status).toBe('running')
    await manager.stopOwned(session.id)
    expect(manager.get(terminal.id, session.id).status).toBe('killed')
    expect(manager.get(manual.id, session.id)).toMatchObject({
      status: 'running',
      pinned: true,
      owner: 'user',
    })
    await manager.disposeSession(session.id)
    expect(manager.list(session.id, true)).toEqual([])
  })

  it('独立 NIT 信号不会被普通轮次托管解绑，父取消可等待资源清理', async () => {
    const { manager, session, create } = setup()
    const parent = new AbortController()
    const script = new AbortController()
    const terminal = await create(script.signal)
    manager.handoff(session.id, parent.signal)
    script.abort()
    await waitForCancellationCleanup(script.signal)
    expect(manager.get(terminal.id, session.id)).toMatchObject({
      status: 'killed',
      exitReason: 'cancelled',
    })
  })

  it('退出后自动归档、固定保护、历史数量和时间均有上限', async () => {
    const { manager, session, create, exit, output } = setup()
    const pinned = await create(undefined, 'user')
    exit(0)
    for (let i = 0; i < 4; i++) {
      const terminal = await create()
      output(`结果${i}`)
      exit(0)
      manager.sweep(Date.now() + 200)
      expect(manager.get(terminal.id, session.id).archivedAt).toBeDefined()
    }
    expect(manager.list(session.id)).toHaveLength(1)
    expect(manager.get(pinned.id, session.id).pinned).toBe(true)
    expect(manager.list(session.id, true)).toHaveLength(3)
    manager.sweep(Date.now() + 2000)
    expect(manager.list(session.id, true)).toHaveLength(1)
  })

  it('任务跨段等待保留退出结果，完成回收后仍可读日志', async () => {
    const { manager, session, create, output, exit } = setup()
    session.taskId = 'task-1'
    const terminal = await create()
    manager.retainResults(session.id, [terminal.id])
    output('计算结果')
    exit(0)
    manager.sweep(Date.now() + 2000)
    expect(manager.read(terminal.id, session.id).output).toBe('计算结果')
    await manager.disposeSession(session.id, true)
    expect(manager.list(session.id)).toHaveLength(0)
    expect(manager.read(terminal.id, session.id)).toMatchObject({
      status: 'exited',
      output: '计算结果',
    })
  })

  it('停止与创建竞态中迟到的 Agent 终端会被回收', async () => {
    const { manager, session, create, runner } = setup()
    let release!: () => void
    const spawn = runner.spawnTerminal.getMockImplementation()!
    runner.spawnTerminal.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return spawn(...args)
    })
    const creating = create()
    const cancelled = expect(creating).rejects.toThrow('所有者已请求停止')
    const stopping = manager.stopOwned(session.id)
    release()
    await cancelled
    await stopping
    expect(manager.list(session.id).every((item) => item.status !== 'running')).toBe(true)
    expect(runner.terminateProcess).toHaveBeenCalledOnce()
  })
})
