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
        context.signal.addEventListener('abort', () => void terminate(session, 'SIGTERM'), {
          once: true,
        })
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
          if (available || matched || Date.now() - startedAt >= timeoutMs) break
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
        await terminate(session, 'SIGTERM')
        sessions.delete(terminalId)
        return { terminalId, closed: true }
      }
      throw new Error(`REMOTE_TERMINAL_OPERATION_UNSUPPORTED: ${operation}`)
    },

    async stop() {
      await Promise.all([...sessions.values()].map((session) => terminate(session, 'SIGTERM')))
      sessions.clear()
    },
  }
}
