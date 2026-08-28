/**
 * executionSession — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

export type SandboxProfileName = 'read-only' | 'workspace-write' | 'task-isolated' | 'full-access'

export interface SandboxProfile {
  name: SandboxProfileName
  readableRoots: string[]
  writableRoots: string[]
  protectedPaths: string[]
  network: 'deny' | 'allow'
  inheritEnv: string[]
  maxProcesses: number
  maxRuntimeMs: number
  maxOutputBytes: number
}

export interface ExecutionSession {
  id: string
  ownerAgentId: string
  threadId?: string
  taskId?: string
  channel: string
  workspaceRoot: string
  sandboxProfile: SandboxProfile
  state: 'active' | 'closing' | 'closed'
  createdAt: string
  lastActiveAt: string
}

export interface CreateExecutionSessionInput {
  ownerAgentId: string
  threadId?: string
  taskId?: string
  channel: string
  workspaceRoot: string
  sandboxProfile?: SandboxProfile
}

/** 第一阶段默认策略：提供可审计的软件边界，不宣称为 OS 级强隔离。 */
export function createDefaultSandboxProfile(
  name: SandboxProfileName,
  workspaceRoot: string,
): SandboxProfile {
  const writable = name === 'read-only' ? [] : [workspaceRoot]
  return {
    name,
    readableRoots: name === 'full-access' ? [] : [workspaceRoot],
    writableRoots: name === 'full-access' ? [] : writable,
    protectedPaths: ['.git', '.infos', '.env'],
    network: name === 'full-access' ? 'allow' : 'deny',
    inheritEnv: [
      'PATH',
      'Path',
      'PATHEXT',
      'SystemRoot',
      'WINDIR',
      'HOME',
      'USERPROFILE',
      'TEMP',
      'TMP',
    ],
    maxProcesses: name === 'task-isolated' ? 8 : 16,
    maxRuntimeMs: 30 * 60_000,
    maxOutputBytes: 2 * 1024 * 1024,
  }
}

/**
 * 执行会话管理器。
 *
 * 普通 Thread 按 threadId 复用；后台任务按 taskId 隔离。资源释放由上层生命周期显式触发。
 */
export class ExecutionSessionManager {
  private readonly sessions = new Map<string, ExecutionSession>()
  private readonly ownerIndex = new Map<string, string>()

  async getOrCreate(input: CreateExecutionSessionInput): Promise<ExecutionSession> {
    const ownerKey = this.createOwnerKey(input)
    if (ownerKey) {
      const existingId = this.ownerIndex.get(ownerKey)
      const existing = existingId ? this.sessions.get(existingId) : undefined
      if (existing?.state === 'active') {
        const expectedRoot = path.resolve(input.workspaceRoot)
        if (
          existing.ownerAgentId !== input.ownerAgentId ||
          existing.channel !== input.channel ||
          existing.workspaceRoot !== expectedRoot
        ) {
          throw new Error('执行会话所有权或工作区不匹配，拒绝跨 Agent 复用')
        }
        existing.lastActiveAt = new Date().toISOString()
        return existing
      }
    }

    const workspaceRoot = path.resolve(input.workspaceRoot)
    await mkdir(workspaceRoot, { recursive: true })
    const now = new Date().toISOString()
    const session: ExecutionSession = {
      id: randomUUID(),
      ownerAgentId: input.ownerAgentId,
      threadId: input.threadId,
      taskId: input.taskId,
      channel: input.channel,
      workspaceRoot,
      sandboxProfile:
        input.sandboxProfile ??
        createDefaultSandboxProfile(
          input.taskId ? 'task-isolated' : 'workspace-write',
          workspaceRoot,
        ),
      state: 'active',
      createdAt: now,
      lastActiveAt: now,
    }
    this.sessions.set(session.id, session)
    if (ownerKey) this.ownerIndex.set(ownerKey, session.id)
    return session
  }

  get(sessionId: string): ExecutionSession | undefined {
    return this.sessions.get(sessionId)
  }

  findByOwner(input: {
    threadId?: string
    taskId?: string
    agentId?: string
    channel?: string
  }): ExecutionSession | undefined {
    return [...this.sessions.values()].find(
      (session) =>
        session.state === 'active' &&
        (!input.taskId || session.taskId === input.taskId) &&
        (!input.threadId || session.threadId === input.threadId) &&
        (!input.agentId || session.ownerAgentId === input.agentId) &&
        (!input.channel || session.channel === input.channel),
    )
  }

  listByAgent(agentId: string): ExecutionSession[] {
    return [...this.sessions.values()].filter((session) => session.ownerAgentId === agentId)
  }

  markClosing(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.state = 'closing'
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.state = 'closed'
    const key = this.createOwnerKey({
      ownerAgentId: session.ownerAgentId,
      threadId: session.threadId,
      taskId: session.taskId,
      channel: session.channel,
    })
    if (key && this.ownerIndex.get(key) === sessionId) this.ownerIndex.delete(key)
    this.sessions.delete(sessionId)
  }

  /** Agent、Channel 与业务所有者共同组成复用键，避免跨角色/通道串用执行会话。 */
  private createOwnerKey(
    input: Pick<CreateExecutionSessionInput, 'ownerAgentId' | 'threadId' | 'taskId' | 'channel'>,
  ): string | null {
    const owner = input.taskId
      ? `task:${input.taskId}`
      : input.threadId
        ? `thread:${input.threadId}`
        : null
    return owner ? `${input.ownerAgentId}:${input.channel}:${owner}` : null
  }
}
