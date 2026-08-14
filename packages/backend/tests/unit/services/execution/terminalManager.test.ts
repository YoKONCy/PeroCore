import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExecutionSessionManager } from '@infos/backend/services/execution/executionSession'
import { LocalPolicyRunner } from '@infos/backend/services/execution/sandboxRunner'
import { TerminalManager } from '@infos/backend/services/execution/terminalManager'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'infos-terminal-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('TerminalManager', () => {
  it('创建终端后可等待、增量读取和关闭', async () => {
    const sessions = new ExecutionSessionManager()
    const runner = new LocalPolicyRunner()
    const manager = new TerminalManager(sessions, runner)
    const session = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      workspaceRoot: root,
    })
    const command =
      process.platform === 'win32' ? 'Write-Output "准备完成"' : 'printf "准备完成\\n"'
    const terminal = await manager.create({ executionSessionId: session.id, command })
    expect(['pty', 'pipe']).toContain(terminal.backend)
    expect(terminal.status).toBe('running')
    const output = await manager.wait(terminal.id, session.id, {
      pattern: '准备完成',
      timeoutMs: 10_000,
    })
    expect(output.output).toContain('准备完成')
    expect(['running', 'exited']).toContain(output.status)
    expect(manager.list(session.id)).toHaveLength(1)
    manager.resize(terminal.id, session.id, 100, 40)
    expect(manager.get(terminal.id, session.id)).toMatchObject({ cols: 100, rows: 40 })
    await manager.close(terminal.id, session.id)
    expect(manager.list(session.id)).toHaveLength(0)
  })

  it('短命令等待退出并返回完整结果', async () => {
    const sessions = new ExecutionSessionManager()
    const manager = new TerminalManager(sessions, new LocalPolicyRunner())
    const session = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'short',
      channel: 'desktop',
      workspaceRoot: root,
    })
    const command =
      process.platform === 'win32'
        ? 'Write-Output "第一行"; Start-Sleep -Milliseconds 100; Write-Output "第二行"'
        : 'printf "第一行\\n"; sleep 0.1; printf "第二行\\n"'
    const result = await manager.run({ executionSessionId: session.id, command, timeoutMs: 5_000 })
    expect(result.output).toContain('第一行')
    expect(result.output).toContain('第二行')
    expect(result.terminal.status).toBe('exited')
    expect(manager.list(session.id)).toHaveLength(0)
  })

  it('输出缓冲裁剪后仍使用绝对游标继续读取', async () => {
    const sessions = new ExecutionSessionManager()
    const manager = new TerminalManager(sessions, new LocalPolicyRunner())
    const session = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'cursor',
      channel: 'desktop',
      workspaceRoot: root,
      sandboxProfile: {
        name: 'workspace-write',
        readableRoots: [root],
        writableRoots: [root],
        protectedPaths: [],
        network: 'deny',
        inheritEnv: ['PATH', 'Path', 'SystemRoot', 'WINDIR'],
        maxProcesses: 2,
        maxRuntimeMs: 10_000,
        maxOutputBytes: 32,
      },
    })
    const command =
      process.platform === 'win32'
        ? "Write-Output ('a' * 80); Start-Sleep -Milliseconds 100; Write-Output 'TAIL'"
        : "printf '%080d\n' 0; sleep 0.1; printf 'TAIL\n'"
    const terminal = await manager.create({ executionSessionId: session.id, command })
    await manager.wait(terminal.id, session.id, { exitOnly: true, timeoutMs: 5_000 })
    const read = manager.read(terminal.id, session.id, 0, 32_000)
    expect(read.droppedChars).toBeGreaterThan(0)
    expect(read.output).toContain('TAIL')
    expect(read.nextCursor).toBeGreaterThan(32)
    await manager.close(terminal.id, session.id)
  })

  it('相对 cwd 始终以执行会话 workspace 根目录为基准', async () => {
    const sessions = new ExecutionSessionManager()
    const manager = new TerminalManager(sessions, new LocalPolicyRunner())
    const session = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'relative-cwd',
      channel: 'desktop',
      workspaceRoot: root,
    })
    await mkdir(path.join(root, 'notes'))
    const command = process.platform === 'win32' ? '(Get-Location).Path' : 'pwd'
    const result = await manager.run({
      executionSessionId: session.id,
      command,
      cwd: 'notes',
      timeoutMs: 5_000,
    })
    expect(path.normalize(result.output.trim())).toBe(path.join(root, 'notes'))
  })

  it('拒绝其他执行会话访问终端', async () => {
    const sessions = new ExecutionSessionManager()
    const manager = new TerminalManager(sessions, new LocalPolicyRunner())
    const owner = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'owner',
      channel: 'desktop',
      workspaceRoot: root,
    })
    const other = await sessions.getOrCreate({
      ownerAgentId: 'pero',
      threadId: 'other',
      channel: 'desktop',
      workspaceRoot: root,
    })
    const terminal = await manager.create({
      executionSessionId: owner.id,
      command: process.platform === 'win32' ? 'Write-Output ok' : 'printf ok',
    })
    expect(() => manager.get(terminal.id, other.id)).toThrow('无权访问')
    await manager.disposeSession(owner.id)
  })
})
