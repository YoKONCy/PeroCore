import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDataLease } from '../src/applicationLifetime'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const roots: string[] = []
const previousPid = process.pid + 100000
const root = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'infos-application-lease-'))
  roots.push(directory)
  return directory
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(execFileSync).mockReset()
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('应用数据目录独占锁', () => {
  it('同一进程也不能重复持有同一个目录', () => {
    const directory = root()
    const lease = new ApplicationDataLease(directory)
    expect(() => new ApplicationDataLease(directory)).toThrow('已有运行中的应用')
    lease.release()
    new ApplicationDataLease(directory).release()
  })

  it('原进程已经退出时自动回收旧锁', () => {
    const directory = root()
    writeFileSync(path.join(directory, 'host.lock'), String(previousPid))
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('进程已退出'), { code: 'ESRCH' })
    })
    const lease = new ApplicationDataLease(directory)
    expect(JSON.parse(readFileSync(path.join(directory, 'host.lock'), 'utf8')).pid).toBe(
      process.pid,
    )
    lease.release()
  })

  it('新进程恰好取得旧锁中的 PID 时同样能识别残留锁', () => {
    const directory = root()
    const acquiredAt = Date.now() - process.uptime() * 1000 - 5000
    writeFileSync(
      path.join(directory, 'host.lock'),
      JSON.stringify({ pid: process.pid, acquiredAt }),
    )
    const lease = new ApplicationDataLease(directory)
    expect(() => new ApplicationDataLease(directory)).toThrow('已有运行中的应用')
    lease.release()
  })

  it('旧锁中的 PID 被后来启动的其他进程复用时允许启动', () => {
    const directory = root(),
      file = path.join(directory, 'host.lock')
    writeFileSync(file, String(previousPid))
    utimesSync(file, new Date('2026-01-01'), new Date('2026-01-01'))
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.mocked(execFileSync).mockReturnValue('2026-02-01T00:00:00.000Z')
    new ApplicationDataLease(directory).release()
  })

  it('原实例仍活跃或无法读取启动时间时保留原锁', () => {
    const directory = root(),
      file = path.join(directory, 'host.lock')
    const value = JSON.stringify({
      pid: previousPid,
      acquiredAt: Date.parse('2026-02-01'),
      token: 'original',
    })
    writeFileSync(file, value)
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.mocked(execFileSync).mockReturnValue('2026-01-01T00:00:00.000Z')
    expect(() => new ApplicationDataLease(directory)).toThrow('已有运行中的应用')
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('权限不足')
    })
    expect(() => new ApplicationDataLease(directory)).toThrow('已有运行中的应用')
    expect(readFileSync(file, 'utf8')).toBe(value)
  })

  it('释放旧实例时不删除后来替换的锁', () => {
    const directory = root(),
      file = path.join(directory, 'host.lock')
    const lease = new ApplicationDataLease(directory)
    const replacement = JSON.stringify({
      pid: process.pid,
      acquiredAt: Date.now(),
      token: 'replacement',
    })
    writeFileSync(file, replacement)
    lease.release()
    expect(readFileSync(file, 'utf8')).toBe(replacement)
  })
})
