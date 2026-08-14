import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
import type { IPty } from 'node-pty'
import type { ExecutionSession } from './executionSession'

export interface ProcessSpec {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  shell?: boolean | string
  signal?: AbortSignal
  cols?: number
  rows?: number
}

export interface SandboxProcess {
  id: string
  child: ChildProcessWithoutNullStreams
}

export interface ManagedTerminalProcess {
  id: string
  pid: number | null
  backend: 'pty' | 'pipe'
  onData(listener: (data: string) => void): void
  onExit(listener: (code: number | null, signal: string | null) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
}

export interface SandboxRunner {
  readonly kind: string
  createSession(session: ExecutionSession): Promise<void>
  spawn(session: ExecutionSession, spec: ProcessSpec): Promise<SandboxProcess>
  spawnTerminal(session: ExecutionSession, spec: ProcessSpec): Promise<ManagedTerminalProcess>
  terminateProcess(processId: string, force?: boolean): Promise<void>
  disposeSession(sessionId: string): Promise<void>
}

interface ManagedProcessEntry {
  sessionId: string
  pid: number | null
  running: boolean
  terminate(force: boolean): Promise<void>
}

/**
 * 本地策略执行器。
 *
 * 终端优先使用 node-pty（Windows ConPTY / Unix PTY），原生模块不可用时自动降级为 pipe。
 * 它仍不是 OS 级强沙箱，所有平台后端都必须继续遵守执行会话的 cwd 与环境策略。
 */
export class LocalPolicyRunner implements SandboxRunner {
  readonly kind = 'local-policy'
  private readonly processes = new Map<string, ManagedProcessEntry>()
  private readonly require = createRequire(import.meta.url)

  async createSession(_session: ExecutionSession): Promise<void> {}

  async spawn(session: ExecutionSession, spec: ProcessSpec): Promise<SandboxProcess> {
    const { cwd, env } = await this.prepareProcess(session, spec)
    const child = spawn(spec.command, spec.args ?? [], {
      cwd,
      env,
      shell: spec.shell ?? false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const id = `${session.id}:${child.pid ?? Date.now()}`
    this.registerProcess(id, session.id, child.pid ?? null, async (force) => {
      await this.killProcessTree(child.pid, force, child)
    })
    child.once('exit', () => this.markExited(id))
    this.bindAbort(id, spec.signal, () => child.once('exit', () => undefined))
    return { id, child }
  }

  async spawnTerminal(
    session: ExecutionSession,
    spec: ProcessSpec,
  ): Promise<ManagedTerminalProcess> {
    const prepared = await this.prepareProcess(session, spec)
    const pty = this.trySpawnPty(spec, prepared.cwd, prepared.env)
    if (pty) return this.wrapPty(session, spec, pty)
    return this.spawnPipeTerminal(session, spec, prepared.cwd, prepared.env)
  }

  async terminateProcess(processId: string, force = false): Promise<void> {
    const entry = this.processes.get(processId)
    if (!entry?.running) return
    await entry.terminate(force)
  }

  async disposeSession(sessionId: string): Promise<void> {
    const ids = [...this.processes.entries()]
      .filter(([, entry]) => entry.sessionId === sessionId)
      .map(([id]) => id)
    await Promise.all(ids.map((id) => this.terminateProcess(id, true)))
  }

  private trySpawnPty(spec: ProcessSpec, cwd: string, env: NodeJS.ProcessEnv): IPty | null {
    try {
      const nodePty = this.require('node-pty') as typeof import('node-pty')
      return nodePty.spawn(spec.command, spec.args ?? [], {
        name:
          process.platform === 'win32' ? 'xterm-256color' : process.env.TERM || 'xterm-256color',
        cols: Math.max(20, spec.cols ?? 120),
        rows: Math.max(5, spec.rows ?? 30),
        cwd,
        env,
        encoding: 'utf8',
        useConpty: process.platform === 'win32',
      })
    } catch {
      return null
    }
  }

  private wrapPty(session: ExecutionSession, spec: ProcessSpec, pty: IPty): ManagedTerminalProcess {
    const id = `${session.id}:pty:${pty.pid}`
    const exitListeners = new Set<(code: number | null, signal: string | null) => void>()
    const dataListeners = new Set<(data: string) => void>()
    pty.onData((data) => {
      for (const listener of dataListeners) listener(data)
    })
    pty.onExit(({ exitCode, signal }) => {
      this.markExited(id)
      for (const listener of exitListeners) listener(exitCode, signal ? String(signal) : null)
    })
    this.registerProcess(id, session.id, pty.pid, async (force) => {
      if (process.platform === 'win32') {
        await this.killProcessTree(pty.pid, force)
      } else {
        const signal = force ? 'SIGKILL' : 'SIGTERM'
        try {
          process.kill(-pty.pid, signal)
        } catch {
          // 优先杀整个进程组，避免 Unix 下幽灵子进程
          pty.kill(signal)
        } // 进程组不可用时退回只杀 pty 主进程
      }
    })
    this.bindAbort(id, spec.signal)
    return {
      id,
      pid: pty.pid,
      backend: 'pty',
      onData: (listener) => dataListeners.add(listener),
      onExit: (listener) => exitListeners.add(listener),
      write: (data) => pty.write(data),
      resize: (cols, rows) => pty.resize(Math.max(1, cols), Math.max(1, rows)),
    }
  }

  private async spawnPipeTerminal(
    session: ExecutionSession,
    spec: ProcessSpec,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<ManagedTerminalProcess> {
    const child = spawn(spec.command, spec.args ?? [], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const id = `${session.id}:pipe:${child.pid ?? Date.now()}`
    this.registerProcess(id, session.id, child.pid ?? null, async (force) => {
      await this.killProcessTree(child.pid, force, child)
    })
    this.bindAbort(id, spec.signal)
    return {
      id,
      pid: child.pid ?? null,
      backend: 'pipe',
      onData: (listener) => {
        child.stdout.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')))
        child.stderr.on('data', (chunk: Buffer) => listener(`\n[stderr] ${chunk.toString('utf8')}`))
      },
      onExit: (listener) => {
        child.once('error', (error) => listener(1, error.message))
        child.once('exit', (code, signal) => {
          this.markExited(id)
          listener(code, signal)
        })
      },
      write: (data) => child.stdin.write(data),
      resize: () => undefined,
    }
  }

  private async prepareProcess(session: ExecutionSession, spec: ProcessSpec) {
    const activeCount = [...this.processes.values()].filter(
      (entry) => entry.sessionId === session.id && entry.running,
    ).length
    if (activeCount >= session.sandboxProfile.maxProcesses) {
      throw new Error(`执行会话进程数已达到上限 ${session.sandboxProfile.maxProcesses}`)
    }
    const cwd = path.resolve(spec.cwd ?? session.workspaceRoot)
    const roots = session.sandboxProfile.readableRoots
    const allowed =
      session.sandboxProfile.name === 'full-access' ||
      roots.some((root) => {
        const relative = path.relative(path.resolve(root), cwd)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      })
    if (!allowed) throw new Error(`终端工作目录超出执行会话允许范围: ${cwd}`)
    // 词法路径合法仍可能经 symlink/Junction 指向外部，启动进程前必须校验真实 cwd。
    const actualCwd = await realpath(cwd)
    const realRoots = await Promise.all(
      roots.map(async (root) => realpath(root).catch(() => path.resolve(root))),
    )
    const actualAllowed =
      session.sandboxProfile.name === 'full-access' ||
      realRoots.some((root) => {
        const relative = path.relative(root, actualCwd)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      })
    if (!actualAllowed) throw new Error(`终端工作目录通过符号链接越出执行会话允许范围: ${cwd}`)
    return { cwd: actualCwd, env: this.buildEnvironment(session, spec.env) }
  }

  private registerProcess(
    id: string,
    sessionId: string,
    pid: number | null,
    terminate: (force: boolean) => Promise<void>,
  ): void {
    this.processes.set(id, { sessionId, pid, running: true, terminate })
  }

  private markExited(id: string): void {
    const entry = this.processes.get(id)
    if (entry) entry.running = false
    this.processes.delete(id)
  }

  private bindAbort(id: string, signal?: AbortSignal, _onExit?: () => void): void {
    if (!signal) return
    const abort = () => void this.terminateProcess(id, true)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }

  private async killProcessTree(
    pid: number | undefined,
    force: boolean,
    child?: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    if (!pid) return
    if (process.platform === 'win32') {
      // 用 taskkill /T 杀掉整棵进程树，避免 PowerShell 派生的子进程成为幽灵终端。
      const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
      const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' })
      await new Promise<void>((resolve) => {
        // 无论 taskkill 成功、失败还是无法启动，都必须 resolve，避免等待悬挂。
        killer.once('error', () => resolve())
        killer.once('exit', () => resolve())
      })
      // taskkill 兜底之后，若子进程句柄仍未退出（如 taskkill 缺失），直接对句柄再杀一次。
      if (child && child.pid && child.exitCode === null) {
        try {
          child.kill(force ? 'SIGKILL' : 'SIGTERM')
        } catch {
          /* 进程已退出，忽略 */
        }
      }
    } else {
      try {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
      } catch {
        child?.kill(force ? 'SIGKILL' : 'SIGTERM')
      }
    }
  }

  private buildEnvironment(
    session: ExecutionSession,
    additions?: Record<string, string>,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const key of session.sandboxProfile.inheritEnv) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    env.PAGER = 'cat'
    env.NO_COLOR = '1'
    env.INFOS_EXECUTION_SESSION_ID = session.id
    env.INFOS_SANDBOX_PROFILE = session.sandboxProfile.name
    for (const [key, value] of Object.entries(additions ?? {})) env[key] = value
    if (!env.HOME && os.homedir()) env.HOME = os.homedir()
    return env
  }
}
