/**
 * terminalManager — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ExecutionSession, ExecutionSessionManager } from './executionSession'
import type { SandboxRunner } from './sandboxRunner'

export type TerminalStatus = 'running' | 'exited' | 'killed' | 'failed'

export interface TerminalSnapshot {
  id: string
  executionSessionId: string
  title: string
  command?: string
  cwd: string
  pid: number | null
  status: TerminalStatus
  startedAt: string
  exitedAt?: string
  exitCode?: number | null
  signal?: string | null
  outputLength: number
  backend: 'pty' | 'pipe'
  cols: number
  rows: number
}

interface TerminalRecord extends TerminalSnapshot {
  processId: string
  output: string
  writeInput: (data: string) => void
  resizeTerminal: (cols: number, rows: number) => void
  maxOutputBytes: number
  /** 当前缓冲区首字符在完整输出流中的绝对偏移。 */
  bufferStartOffset: number
  /** 完整输出流累计字符数（单调递增）。 */
  absoluteOutputLength: number
}

export interface CreateTerminalInput {
  executionSessionId: string
  /** 为空时启动当前平台的交互式系统 Shell。 */
  command?: string
  cwd?: string
  title?: string
  signal?: AbortSignal
  cols?: number
  rows?: number
}

/**
 * 多终端管理器（第一期 pipe backend）。
 *
 * 每次创建立即返回句柄，长时命令不会占住 ReAct 工具调用；后续可无缝把底层替换为 node-pty。
 */
export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly waiters = new Map<string, Set<() => void>>()

  constructor(
    private readonly sessions: ExecutionSessionManager,
    private readonly runner: SandboxRunner,
  ) {}

  async create(input: CreateTerminalInput): Promise<TerminalSnapshot> {
    const session = this.requireSession(input.executionSessionId)
    const shell = this.resolveShell(input.command)
    const terminalId = randomUUID()
    // 终端工具的相对 cwd 永远基于当前 Agent 的执行会话 workspace，而非后端进程 cwd。
    // 缺省或 "." 均指向 workspace 根目录；绝对路径仍交给 SandboxRunner 做范围校验。
    const requestedCwd = input.cwd?.trim()
    const cwd = requestedCwd
      ? path.isAbsolute(requestedCwd)
        ? path.normalize(requestedCwd)
        : path.resolve(session.workspaceRoot, requestedCwd)
      : session.workspaceRoot
    const process = await this.runner.spawnTerminal(session, {
      command: shell.command,
      args: shell.args,
      cwd,
      signal: input.signal,
      cols: input.cols,
      rows: input.rows,
    })
    const now = new Date().toISOString()
    const record: TerminalRecord = {
      id: terminalId,
      executionSessionId: session.id,
      title: input.title?.trim() || shell.title,
      command: input.command,
      cwd,
      pid: process.pid,
      status: 'running',
      startedAt: now,
      outputLength: 0,
      backend: process.backend,
      cols: input.cols ?? 120,
      rows: input.rows ?? 30,
      processId: process.id,
      output: '',
      writeInput: (data) => process.write(data),
      resizeTerminal: (cols, rows) => process.resize(cols, rows),
      maxOutputBytes: session.sandboxProfile.maxOutputBytes,
      bufferStartOffset: 0,
      absoluteOutputLength: 0,
    }
    this.terminals.set(terminalId, record)
    const append = (chunk: Buffer | string) => {
      const text = chunk.toString()
      record.output += text
      record.absoluteOutputLength += text.length
      if (Buffer.byteLength(record.output, 'utf8') > record.maxOutputBytes) {
        const before = record.output.length
        record.output = record.output.slice(-record.maxOutputBytes)
        record.bufferStartOffset += before - record.output.length
      }
      record.outputLength = record.absoluteOutputLength
      this.notify(terminalId)
    }
    process.onData(append)
    process.onExit((code, signal) => {
      record.status = record.status === 'killed' ? 'killed' : code === 0 ? 'exited' : 'failed'
      record.exitCode = code
      record.signal = signal
      record.exitedAt = new Date().toISOString()
      this.notify(terminalId)
    })
    return this.snapshot(record)
  }

  async run(
    input: CreateTerminalInput & { timeoutMs?: number; outputLimit?: number },
  ): Promise<{ terminal: TerminalSnapshot; output: string; truncated: boolean }> {
    const terminal = await this.create(input)
    const timeoutMs = Math.max(100, Math.min(input.timeoutMs ?? 30_000, 10 * 60_000))
    const waited = await this.wait(terminal.id, terminal.executionSessionId, {
      timeoutMs,
      exitOnly: true,
    })
    if (waited.status === 'running') {
      await this.kill(terminal.id, terminal.executionSessionId)
      throw new Error(`命令执行超时 (${timeoutMs}ms)`)
    }
    const limit = Math.max(1, Math.min(input.outputLimit ?? 20_000, 128_000))
    const record = this.requireTerminal(terminal.id, terminal.executionSessionId)
    const truncated = record.output.length > limit
    const output = truncated
      ? `${record.output.slice(0, Math.floor(limit / 2))}\n...[输出已截断]...\n${record.output.slice(-Math.floor(limit / 2))}`
      : record.output
    const snapshot = this.snapshot(record)
    await this.close(terminal.id, terminal.executionSessionId)
    if (snapshot.status === 'failed') {
      throw new Error(
        `命令执行失败 (exitCode=${snapshot.exitCode ?? 'unknown'})${output ? `\n${output}` : ''}`,
      )
    }
    return { terminal: snapshot, output: output || '(无输出)', truncated }
  }

  list(executionSessionId: string): TerminalSnapshot[] {
    return [...this.terminals.values()]
      .filter((record) => record.executionSessionId === executionSessionId)
      .map((record) => this.snapshot(record))
  }

  get(terminalId: string, executionSessionId: string): TerminalSnapshot {
    return this.snapshot(this.requireTerminal(terminalId, executionSessionId))
  }

  read(terminalId: string, executionSessionId: string, cursor = 0, limit = 8_000) {
    const record = this.requireTerminal(terminalId, executionSessionId)
    const requestedCursor = Math.max(0, cursor)
    const safeCursor = Math.max(
      record.bufferStartOffset,
      Math.min(requestedCursor, record.absoluteOutputLength),
    )
    const localCursor = safeCursor - record.bufferStartOffset
    const safeLimit = Math.max(1, Math.min(limit, 32_000))
    const output = record.output.slice(localCursor, localCursor + safeLimit)
    const nextCursor = safeCursor + output.length
    return {
      output,
      cursor: safeCursor,
      nextCursor,
      droppedChars: Math.max(0, record.bufferStartOffset - requestedCursor),
      hasMore: nextCursor < record.absoluteOutputLength,
      status: record.status,
      exitCode: record.exitCode,
    }
  }

  async wait(
    terminalId: string,
    executionSessionId: string,
    options: { cursor?: number; pattern?: string; timeoutMs?: number; exitOnly?: boolean },
  ) {
    const record = this.requireTerminal(terminalId, executionSessionId)
    const cursor = options.cursor ?? 0
    const matches = () => {
      if (record.status !== 'running') return true
      if (options.exitOnly) return false
      return options.pattern
        ? record.output.slice(cursor).includes(options.pattern)
        : record.output.length > cursor
    }
    if (!matches()) {
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          clearTimeout(timer)
          this.waiters.get(terminalId)?.delete(callback)
          resolve()
        }
        const callback = () => matches() && cleanup()
        const timer = setTimeout(cleanup, Math.min(options.timeoutMs ?? 30_000, 120_000))
        const set = this.waiters.get(terminalId) ?? new Set()
        set.add(callback)
        this.waiters.set(terminalId, set)
      })
    }
    return this.read(terminalId, executionSessionId, cursor)
  }

  write(terminalId: string, executionSessionId: string, data: string): void {
    const record = this.requireTerminal(terminalId, executionSessionId)
    if (record.status !== 'running') throw new Error('终端已退出，无法写入')
    record.writeInput(data)
  }

  resize(terminalId: string, executionSessionId: string, cols: number, rows: number): void {
    const record = this.requireTerminal(terminalId, executionSessionId)
    record.resizeTerminal(cols, rows)
    record.cols = cols
    record.rows = rows
  }

  async interrupt(terminalId: string, executionSessionId: string): Promise<void> {
    const record = this.requireTerminal(terminalId, executionSessionId)
    if (process.platform === 'win32') await this.runner.terminateProcess(record.processId, false)
    else if (record.pid) process.kill(-record.pid, 'SIGINT')
  }

  async kill(terminalId: string, executionSessionId: string): Promise<void> {
    const record = this.requireTerminal(terminalId, executionSessionId)
    record.status = 'killed'
    await this.runner.terminateProcess(record.processId, true)
  }

  async close(terminalId: string, executionSessionId: string): Promise<void> {
    const record = this.requireTerminal(terminalId, executionSessionId)
    if (record.status === 'running') await this.kill(terminalId, executionSessionId)
    this.terminals.delete(terminalId)
    this.waiters.delete(terminalId)
  }

  async disposeSession(executionSessionId: string): Promise<void> {
    const ids = this.list(executionSessionId).map((terminal) => terminal.id)
    await Promise.all(ids.map((id) => this.close(id, executionSessionId)))
    await this.runner.disposeSession(executionSessionId)
  }

  private resolveShell(command?: string): { command: string; args: string[]; title: string } {
    const requestedCommand = command?.trim()
    if (process.platform === 'win32') {
      // 中文 Windows 下 PowerShell 默认输出 GBK，而 ConPTY/pipe 后端按 UTF-8 解码，
      // 会导致中文乱码。这里强制把控制台输入/输出与管道输出统一为 UTF-8（无 BOM）。
      const utf8Init =
        '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); ' +
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' +
        '$OutputEncoding = [System.Text.UTF8Encoding]::new();'
      if (!requestedCommand) {
        // 交互式系统 Shell：先初始化 UTF-8，再用 -NoExit 保持交互供用户/Agent 持续使用。
        return {
          command: 'powershell.exe',
          args: ['-NoLogo', '-NoExit', '-Command', utf8Init],
          title: 'PowerShell',
        }
      }
      return {
        command: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `${utf8Init} ${requestedCommand}`,
        ],
        title: requestedCommand.slice(0, 80),
      }
    }
    const systemShell = process.env.SHELL || '/bin/sh'
    return requestedCommand
      ? {
          command: systemShell,
          args: ['-lc', requestedCommand],
          title: requestedCommand.slice(0, 80),
        }
      : { command: systemShell, args: ['-l'], title: systemShell.split('/').pop() || 'Shell' }
  }

  private requireSession(id: string): ExecutionSession {
    const session = this.sessions.get(id)
    if (!session || session.state !== 'active') throw new Error(`执行会话不存在或已关闭: ${id}`)
    return session
  }

  private requireTerminal(id: string, executionSessionId: string): TerminalRecord {
    const record = this.terminals.get(id)
    if (!record || record.executionSessionId !== executionSessionId)
      throw new Error(`终端不存在或无权访问: ${id}`)
    return record
  }

  private notify(terminalId: string): void {
    for (const callback of this.waiters.get(terminalId) ?? []) callback()
  }

  private snapshot(record: TerminalRecord): TerminalSnapshot {
    return {
      id: record.id,
      executionSessionId: record.executionSessionId,
      title: record.title,
      command: record.command,
      cwd: record.cwd,
      pid: record.pid,
      status: record.status,
      startedAt: record.startedAt,
      exitedAt: record.exitedAt,
      exitCode: record.exitCode,
      signal: record.signal,
      outputLength: record.outputLength,
      backend: record.backend,
      cols: record.cols,
      rows: record.rows,
    }
  }
}
