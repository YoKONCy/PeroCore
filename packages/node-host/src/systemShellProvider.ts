import { translate as __t } from '@infos/shared/i18n'
import '@infos/shared/i18n/catalogs/platform'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import type { NodeProvider } from '@infos/node-sdk'

const MAX_BUFFER_CHARS = 2_000_000

interface ShellSession {
  id: string
  command: string
  cwd: string
  process: ChildProcessWithoutNullStreams
  output: string
  baseCursor: number
  status: 'running' | 'exited' | 'failed'
  exitCode: number | null
  signal: NodeJS.Signals | null
  startedAt: string
  completedAt?: string
}

/** 在能力节点本机维护长时 Shell Session 的 system.shell Provider。 */
export function createSystemShellProvider(nodeId: KernelNodeId): NodeProvider {
  const sessions = new Map<string, ShellSession>()

  const get = (id: string): ShellSession => {
    const session = sessions.get(id)
    if (!session) throw new Error(`REMOTE_TERMINAL_NOT_FOUND: ${id}`)
    return session
  }

  const view = (session: ShellSession) => ({
    terminalId: session.id,
    command: session.command,
    cwd: session.cwd,
    pid: session.process.pid,
    status: session.status,
    exitCode: session.exitCode,
    signal: session.signal,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  })

  const append = (session: ShellSession, chunk: Buffer | string) => {
    session.output += chunk.toString()
    if (session.output.length <= MAX_BUFFER_CHARS) return
    const removed = session.output.length - MAX_BUFFER_CHARS
    session.output = session.output.slice(removed)
    session.baseCursor += removed
  }

  const terminate = async (session: ShellSession, signal: NodeJS.Signals) => {
    if (session.status !== 'running') return
    if (process.platform === 'win32' && session.process.pid) {
      // Windows 必须回收进程树，单独终止 Shell 会留下其启动的子进程。
      const killer = spawn('taskkill.exe', ['/PID', String(session.process.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          killer.kill()
          finish()
        }, 2_000)
        killer.once('error', finish)
        killer.once('exit', finish)
      })
      if (session.process.exitCode === null) session.process.kill('SIGKILL')
      return
    }
    if (process.platform !== 'win32' && session.process.pid) {
      try {
        process.kill(-session.process.pid, signal)
        return
      } catch {
        // 进程组不可用时退回直接终止子进程。
      }
    }
    session.process.kill(signal)
  }

  const shellEnvironment = (): NodeJS.ProcessEnv => {
    const names = [
      'PATH',
      'HOME',
      'USER',
      'SHELL',
      'LANG',
      'LC_ALL',
      'TERM',
      'TMPDIR',
      'CUDA_HOME',
      'CUDA_PATH',
      'CUDA_VISIBLE_DEVICES',
      'LD_LIBRARY_PATH',
      'PYTHONPATH',
      'VIRTUAL_ENV',
      'CONDA_PREFIX',
    ]
    return Object.fromEntries(
      names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
    )
  }

  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.system.shell',
      name: '能力节点 Shell',
      version: '1.0.0',
      definition: {
        capabilityType: 'system.shell',
        contractVersion: '1.0',
        operations: {
          create: { risk: 'root', idempotency: 'unsafe' },
          list: { risk: 'read', idempotency: 'safe' },
          get: { risk: 'read', idempotency: 'safe' },
          read: { risk: 'read', idempotency: 'safe' },
          wait: { risk: 'read', idempotency: 'safe' },
          write: { risk: 'root', idempotency: 'unsafe' },
          interrupt: { risk: 'root', idempotency: 'safe' },
          kill: { risk: 'root', idempotency: 'safe' },
          close: { risk: 'root', idempotency: 'safe' },
        },
      },
      offer: {
        offerId: `system.shell@1.0:${nodeId}`,
        capabilityType: 'system.shell',
        contractVersion: '1.0',
        operations: [
          'create',
          'list',
          'get',
          'read',
          'wait',
          'write',
          'interrupt',
          'kill',
          'close',
        ],
        resourceKinds: ['shell-session', 'process'],
      },
      configurationSchema: {
        type: 'object',
        properties: {
          defaultCwd: { type: 'string' },
        },
      },
    },

    async invoke(envelope: KernelEnvelope<{ operation: string; input: unknown }>, context) {
      context.signal.throwIfAborted()
      const operation = envelope.payload.operation
      const input = (envelope.payload.input ?? {}) as Record<string, unknown>

      if (operation === 'create') {
        const command = String(input.command ?? '').trim()
        if (!command) throw new Error('REMOTE_TERMINAL_COMMAND_REQUIRED')
        const cwd = String(input.cwd ?? '').trim() || os.homedir()
        const shell =
          process.platform === 'win32' ? process.env.ComSpec || 'powershell.exe' : '/bin/bash'
        const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]
        const child = spawn(shell, args, {
          cwd,
          env: shellEnvironment(),
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          windowsHide: true,
        })
        const session: ShellSession = {
          id: randomUUID(),
          command,
          cwd,
          process: child,
          output: '',
          baseCursor: 0,
          status: 'running',
          exitCode: null,
          signal: null,
          startedAt: new Date().toISOString(),
        }
        sessions.set(session.id, session)
        child.stdout.on('data', (chunk) => append(session, chunk))
        child.stderr.on('data', (chunk) => append(session, chunk))
        child.once('error', (error) => {
          append(session, `\n[节点终端错误] ${error.message}\n`)
          session.status = 'failed'
          session.completedAt = new Date().toISOString()
        })
        child.once('exit', (code, signal) => {
          session.status = code === 0 ? 'exited' : 'failed'
          session.exitCode = code
          session.signal = signal
          session.completedAt = new Date().toISOString()
        })
        const abort = () => {
          void terminate(session, 'SIGKILL').catch((error) =>
            console.warn(__t('platform.node-host', '远程终端回收失败'), error),
          )
        }
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined
        const dispose = () => {
          if (deadlineTimer) clearTimeout(deadlineTimer)
          context.signal.removeEventListener('abort', abort)
        }
        child.once('exit', dispose)
        child.once('error', dispose)
        context.signal.addEventListener('abort', abort, { once: true })
        if (context.signal.aborted) abort()
        // 创建 RPC 返回后，终端仍须遵守父执行的绝对截止时间。
        if (envelope.deadline) {
          const remaining = Date.parse(envelope.deadline) - Date.now()
          if (!Number.isFinite(remaining) || remaining <= 0) abort()
          else {
            deadlineTimer = setTimeout(abort, Math.min(remaining, 2_147_483_647))
            deadlineTimer.unref?.()
          }
        }
        return view(session)
      }

      if (operation === 'list') return [...sessions.values()].map(view)
      const terminalId = String(input.terminalId ?? input.terminal_id ?? '')
      const session = get(terminalId)
      if (operation === 'get') return view(session)
      if (operation === 'read') {
        const requested = Math.max(Number(input.cursor ?? session.baseCursor), session.baseCursor)
        const limit = Math.min(Math.max(Number(input.limit ?? 8_000), 1), 64_000)
        const offset = requested - session.baseCursor
        const output = session.output.slice(offset, offset + limit)
        const nextCursor = requested + output.length
        return {
          ...view(session),
          output,
          cursor: requested,
          nextCursor,
          hasMore: nextCursor < session.baseCursor + session.output.length,
          truncatedBefore: requested > Number(input.cursor ?? requested),
        }
      }
      if (operation === 'wait') {
        const cursor = Number(input.cursor ?? session.baseCursor)
        const pattern = input.pattern ? String(input.pattern) : ''
        const timeoutMs = Math.min(
          Math.max(Number(input.timeoutMs ?? input.timeout_ms ?? 30_000), 0),
          300_000,
        )
        const startedAt = Date.now()
        while (session.status === 'running') {
          const available = session.baseCursor + session.output.length > cursor
          const matched = pattern && session.output.includes(pattern)
          if ((pattern ? matched : available) || Date.now() - startedAt >= timeoutMs) break
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (context.signal.aborted) throw new Error('REMOTE_TERMINAL_WAIT_CANCELLED')
        }
        const requested = Math.max(cursor, session.baseCursor)
        const offset = requested - session.baseCursor
        const output = session.output.slice(offset, offset + 8_000)
        const nextCursor = requested + output.length
        return {
          ...view(session),
          output,
          cursor: requested,
          nextCursor,
          hasMore: nextCursor < session.baseCursor + session.output.length,
          truncatedBefore: requested > cursor,
        }
      }
      if (operation === 'write') {
        if (session.status !== 'running') throw new Error('REMOTE_TERMINAL_NOT_RUNNING')
        session.process.stdin.write(String(input.data ?? ''))
        return { terminalId, written: true }
      }
      if (operation === 'interrupt') {
        await terminate(session, 'SIGINT')
        return { terminalId, interrupted: true }
      }
      if (operation === 'kill') {
        await terminate(session, 'SIGKILL')
        return { terminalId, killed: true }
      }
      if (operation === 'close') {
        await terminate(session, 'SIGKILL')
        sessions.delete(terminalId)
        return { terminalId, closed: true }
      }
      throw new Error(`REMOTE_TERMINAL_OPERATION_UNSUPPORTED: ${operation}`)
    },

    async stop() {
      await Promise.all([...sessions.values()].map((session) => terminate(session, 'SIGKILL')))
      sessions.clear()
    },
  }
}
