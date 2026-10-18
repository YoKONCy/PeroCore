import { createConnection } from 'node:net'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export interface ApplicationDesktopGuard {
  pipe: string
  token: string
}

/** 存活凭据只接受本地应用专用管道，不能用于连接任意网络地址。 */
export function parseApplicationDesktopGuard(raw: unknown): ApplicationDesktopGuard {
  const value = raw as Partial<ApplicationDesktopGuard> | null
  if (
    !value ||
    typeof value.pipe !== 'string' ||
    value.pipe.length > 240 ||
    !(
      /^\\\\\.\\pipe\\infos-[a-z]+-\d+-[a-f0-9]{16}$/.test(value.pipe) ||
      /^\/[^\0\r\n]*\/infos-[a-z]+-\d+-[a-f0-9]{16}\.sock$/.test(value.pipe)
    ) ||
    typeof value.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.token)
  ) {
    throw new Error('桌面存活凭据无效')
  }
  return { pipe: value.pipe, token: value.token }
}

export function watchApplicationDesktop(raw: unknown, onLost: () => void) {
  const value = parseApplicationDesktopGuard(raw)
  const socket = createConnection(value.pipe)
  let ready = false,
    disposed = false,
    finished = false,
    buffer = ''
  let rejectReady: (error: Error) => void = () => undefined
  const lost = () => {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    socket.destroy()
    if (!ready) rejectReady(new Error('桌面存活连接不可用'))
    if (!disposed) onLost()
  }
  const timeout = setTimeout(lost, 5000)
  const connected = new Promise<void>((resolve, reject) => {
    rejectReady = reject
    socket.once('connect', () => socket.write(JSON.stringify({ token: value.token }) + '\n'))
    socket.on('data', (chunk) => {
      if (ready || finished) return
      buffer += chunk.toString('utf8')
      if (buffer.length > 1024) {
        lost()
        return
      }
      if (!buffer.includes('\n')) return
      try {
        if (JSON.parse(buffer.split('\n')[0]!).ready !== true) {
          lost()
          return
        }
        ready = true
        buffer = ''
        clearTimeout(timeout)
        resolve()
      } catch {
        lost()
      }
    })
    socket.once('error', lost)
    socket.once('end', lost)
    socket.once('close', lost)
  })
  return {
    ready: connected,
    dispose() {
      disposed = true
      lost()
    },
  }
}

/** 进程归属属于兼容层；独立运行时不绑定桌面或 Kernel。 */
export class ApplicationProcessLifetime {
  private stopping = false
  private ownerTimer?: ReturnType<typeof setInterval>
  private desktop?: ReturnType<typeof watchApplicationDesktop>
  private descriptor?: ApplicationDesktopGuard
  private shutdownPromise?: Promise<void>
  constructor(
    private readonly name: string,
    private readonly stop: () => Promise<void>,
    ownerPid?: number,
  ) {
    if (ownerPid && Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      const check = () => {
        try {
          process.kill(ownerPid, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') void this.shutdown()
        }
      }
      this.ownerTimer = setInterval(check, 1000)
      this.ownerTimer.unref()
      check()
    }
  }
  assertRunning(): void {
    if (this.stopping) throw new Error(`${this.name} 正在退出`)
  }
  bindDesktop(raw: unknown): Promise<void> {
    this.assertRunning()
    const value = parseApplicationDesktopGuard(raw)
    if (this.descriptor) {
      if (value.pipe !== this.descriptor.pipe || value.token !== this.descriptor.token)
        throw new Error(`${this.name} 已归属于另一个桌面进程`)
      return this.desktop!.ready
    }
    this.descriptor = value
    this.desktop = watchApplicationDesktop(value, () => {
      void this.shutdown()
    })
    return this.desktop.ready
  }
  shutdown(code = 0): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopping = true
    if (this.ownerTimer) clearInterval(this.ownerTimer)
    this.desktop?.dispose()
    const forced = setTimeout(() => {
      process.stderr.write(`${this.name} 退出等待超时，正在强制结束\n`)
      process.exit(1)
    }, 8000)
    this.shutdownPromise = Promise.resolve().then(async () => {
      try {
        await this.stop()
      } catch (error) {
        code = 1
        process.stderr.write(`${this.name} 退出清理失败：${String(error)}\n`)
      } finally {
        clearTimeout(forced)
        process.exit(code)
      }
    })
    return this.shutdownPromise
  }
}

/** 只查询进程元数据；查询失败时保留锁，不能据此认定原实例已经退出。 */
function processStartedAt(pid: number): number | undefined {
  try {
    const output =
      process.platform === 'win32'
        ? execFileSync(
            path.join(
              process.env.SystemRoot || 'C:\\Windows',
              'System32/WindowsPowerShell/v1.0/powershell.exe',
            ),
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$leaseProcess = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Write($leaseProcess.StartTime.ToUniversalTime().ToString('o'))`,
            ],
            {
              encoding: 'utf8',
              timeout: 3000,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'ignore'],
            },
          )
        : execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
            encoding: 'utf8',
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: { ...process.env, LC_ALL: 'C' },
          })
    const startedAt = Date.parse(output.trim())
    return Number.isFinite(startedAt) ? startedAt : undefined
  } catch {
    return undefined
  }
}

/** 同一数据目录只允许一个业务实例持有，防止任务和凭据文件相互覆盖。 */
export class ApplicationDataLease {
  private readonly file: string
  private readonly value = JSON.stringify({
    pid: process.pid,
    acquiredAt: Date.now(),
    token: randomUUID(),
  })
  private owned = false
  constructor(directory: string) {
    this.file = path.join(directory, 'host.lock')
    if (existsSync(this.file)) {
      const previous = readFileSync(this.file, 'utf8')
      let record: number | { pid: number; acquiredAt: number }
      try {
        record = JSON.parse(previous)
      } catch {
        throw new Error('应用锁文件损坏，请确认原实例已退出后处理')
      }
      const pid = typeof record === 'number' ? record : record?.pid
      const acquiredAt =
        typeof record === 'number' ? statSync(this.file).mtimeMs : record?.acquiredAt
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error('应用锁文件损坏，请确认原实例已退出后处理')
      let alive = true
      try {
        process.kill(pid, 0)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ESRCH') alive = false
        else if (code !== 'EPERM') throw error
      }
      // 残留 PID 可能已被其他进程复用，必须同时核对进程启动时间。
      const startedAt = !alive
        ? undefined
        : pid === process.pid
          ? Date.now() - process.uptime() * 1000
          : processStartedAt(pid)
      if (
        alive &&
        !(startedAt !== undefined && Number.isFinite(acquiredAt) && startedAt > acquiredAt + 1500)
      )
        throw new Error('此数据目录已有运行中的应用')
      if (readFileSync(this.file, 'utf8') !== previous) throw new Error('应用锁已变更，请重试启动')
      rmSync(this.file)
    }
    writeFileSync(this.file, this.value, { flag: 'wx', mode: 0o600 })
    this.owned = true
  }
  release(): void {
    if (!this.owned) return
    if (existsSync(this.file) && readFileSync(this.file, 'utf8') === this.value) rmSync(this.file)
    this.owned = false
  }
}
