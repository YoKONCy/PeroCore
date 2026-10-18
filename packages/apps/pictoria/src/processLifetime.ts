import { createConnection } from 'node:net'
import { z } from 'zod'

export const desktopGuardSchema = z
  .object({
    pipe: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) =>
          /^\\\\\.\\pipe\\infos-pictoria-\d+-[a-f0-9]{16}$/.test(value) ||
          (/^\//.test(value) &&
            /\/infos-pcl-\d+-[a-f0-9]{16}\.sock$/.test(value) &&
            !/[\0\r\n]/.test(value)),
        '桌面存活连接地址无效',
      ),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type DesktopGuard = z.infer<typeof desktopGuardSchema>

/** Daemon 与子应用分别观察同一连接，任意一侧卡住时另一侧仍可回收进程。 */
export function watchDesktopGuard(raw: unknown, onLost: () => void) {
  const value = desktopGuardSchema.parse(raw),
    socket = createConnection(value.pipe)
  let ready = false,
    finished = false,
    disposed = false,
    buffer = ''
  let rejectReady: (failure: Error) => void = () => undefined
  const timeout = setTimeout(() => lost(), 5000)
  const lost = () => {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    socket.destroy()
    if (!ready) rejectReady(new Error('桌面存活连接不可用'))
    if (!disposed) onLost()
  }
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

/** 生命周期属于挂载兼容层；独立运行时不传入宿主或桌面归属。 */
export class ProcessLifetime {
  private stopping = false
  private ownerTimer?: ReturnType<typeof setInterval>
  private desktopWatch?: ReturnType<typeof watchDesktopGuard>
  private descriptor?: DesktopGuard
  private binding?: Promise<void>
  private shutdownPromise?: Promise<void>
  constructor(
    private readonly stop: () => Promise<void>,
    ownerPid?: number,
  ) {
    if (ownerPid && Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      const check = () => {
        try {
          process.kill(ownerPid, 0)
        } catch (failure) {
          // 无查询权限不代表进程已消失，只有明确不存在时才停止。
          if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
            process.stderr.write('宿主进程已退出，正在停止 Pictoria\n')
            void this.shutdown()
          }
        }
      }
      this.ownerTimer = setInterval(check, 1000)
      this.ownerTimer.unref()
      check()
    }
  }
  assertRunning() {
    if (this.stopping) throw new Error('Pictoria 正在退出')
  }
  bindDesktop(raw: unknown): Promise<void> {
    this.assertRunning()
    const value = desktopGuardSchema.parse(raw)
    if (this.descriptor) {
      if (value.pipe !== this.descriptor.pipe || value.token !== this.descriptor.token)
        throw new Error('Pictoria 已归属于另一个桌面进程')
      return this.binding || Promise.resolve()
    }
    this.descriptor = value
    this.desktopWatch = watchDesktopGuard(value, () => {
      if (!this.stopping) {
        process.stderr.write('桌面连接已断开，正在停止 Pictoria\n')
        void this.shutdown()
      }
    })
    this.binding = this.desktopWatch.ready
    return this.binding
  }
  shutdown(code = 0): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopping = true
    if (this.ownerTimer) clearInterval(this.ownerTimer)
    this.desktopWatch?.dispose()
    // 宿主已消失时仍有强退时限，防止网络请求或关闭钩子无限等待。
    const forced = setTimeout(() => {
      process.stderr.write('Pictoria 退出等待超时，正在强制结束\n')
      process.exit(1)
    }, 8000)
    this.shutdownPromise = (async () => {
      try {
        await this.stop()
      } catch {
        code = 1
        process.stderr.write('Pictoria 退出清理失败，正在结束进程\n')
      } finally {
        clearTimeout(forced)
        process.exit(code)
      }
    })()
    return this.shutdownPromise
  }
}
