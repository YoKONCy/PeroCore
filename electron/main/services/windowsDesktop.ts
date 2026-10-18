import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { WINDOWS_DESKTOP_SOURCE } from './windowsDesktopSource'
import type { DesktopWindowInfo, DesktopElementInfo } from '@infos/shared'

interface WorkerMessage {
  id?: string
  ok?: boolean
  result?: unknown
  error?: string
  activity?: string
  ready?: boolean
  monitor?: boolean
  idleMs?: number
  dispatched?: boolean
}

/** 单个受控 Windows 桥接进程；取消必须等待输入清理或进程退出。 */
class WindowsDesktop extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams
  private starting?: Promise<void>
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      cleanup: () => void
    }
  >()
  monitor = false
  lastActivityAt = 0

  async start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.launch().catch((error) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  private launch(): Promise<void> {
    if (process.platform !== 'win32')
      throw new Error('DESKTOP_PLATFORM_UNSUPPORTED: 当前桌面执行器需要 Windows')
    const bootstrap = [
      '$ErrorActionPreference="Stop"',
      '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)',
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
      '$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))',
      'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Web.Extensions',
      '$refs=@([System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ControlType].Assembly.Location,[System.Windows.Rect].Assembly.Location,[System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,"System.dll","System.Core.dll")',
      'Add-Type -TypeDefinition $source -ReferencedAssemblies $refs',
      '[InfOSDesktop]::Run()',
    ].join(';')
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(bootstrap, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: 'pipe' },
    )
    this.process = child
    child.stdin.on('error', () => {})
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-3000)
    })
    return new Promise<void>((resolve, reject) => {
      let ready = false
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('DESKTOP_BRIDGE_TIMEOUT: Windows 桌面组件启动超时'))
      }, 20_000)
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        let message: WorkerMessage
        try {
          message = JSON.parse(line.replace(/^\uFEFF/, '')) as WorkerMessage
        } catch {
          return
        }
        if (message.ready) {
          ready = true
          clearTimeout(timer)
          this.monitor = message.monitor === true
          this.lastActivityAt = Date.now() - Number(message.idleMs ?? 0)
          resolve()
        } else if (message.activity) {
          this.lastActivityAt = Date.now()
          this.emit('activity', message.activity)
        } else if (message.id) {
          const call = this.pending.get(message.id)
          if (!call) return
          this.pending.delete(message.id)
          call.cleanup()
          if (message.ok) call.resolve(message.result)
          else
            call.reject(
              Object.assign(
                new Error(message.error ?? 'DESKTOP_BRIDGE_ERROR: Windows 桌面操作失败'),
                { dispatched: message.dispatched },
              ),
            )
        }
      })
      const closed = (error: Error) => {
        clearTimeout(timer)
        lines.close()
        if (!ready) reject(error)
        if (this.process !== child) return
        this.process = undefined
        this.starting = undefined
        this.monitor = false
        for (const call of this.pending.values()) {
          call.cleanup()
          call.reject(error)
        }
        this.pending.clear()
        this.emit('unavailable', error.message)
      }
      child.once('error', (error) => closed(error))
      child.once('exit', () =>
        closed(
          new Error(`DESKTOP_BRIDGE_CLOSED: Windows 桌面组件已退出${stderr ? '：' + stderr : ''}`),
        ),
      )
      child.stdin.write(Buffer.from(WINDOWS_DESKTOP_SOURCE, 'utf8').toString('base64') + '\n')
    })
  }

  async request<T = unknown>(
    operation: string,
    input: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    await this.start()
    if (signal?.aborted) throw new Error('DESKTOP_CANCELLED: 桌面操作已取消')
    const child = this.process!
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        if (!child.killed && child.stdin.writable)
          child.stdin.write(JSON.stringify({ operation: 'cancel', targetId: id }) + '\n')
      }
      const timer = setTimeout(() => {
        cancel()
        // UIA Provider 可能阻塞；超时后回收桥接，禁止旧调用迟到后继续输入。
        child.stdin.end()
        child.kill()
      }, 10_000)
      this.pending.set(id, {
        resolve: (value) =>
          signal?.aborted
            ? reject(new Error('DESKTOP_CANCELLED: 桌面操作已取消'))
            : resolve(value as T),
        reject,
        cleanup: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
        },
      })
      signal?.addEventListener('abort', cancel, { once: true })
      child.stdin.write(JSON.stringify({ ...input, operation, id }) + '\n')
      if (signal?.aborted) cancel()
    })
  }

  async stop(): Promise<void> {
    const child = this.process
    if (!child) return
    await this.request('release').catch(() => {})
    child.stdin.end()
  }

  async release(): Promise<void> {
    if (this.process && this.monitor) await this.request('release').catch(() => {})
  }

  windows(): Promise<DesktopWindowInfo[]> {
    return this.request('windows')
  }
  active(): Promise<DesktopWindowInfo | null> {
    return this.request('active')
  }
  observe(windowId?: string, includeElements = false, signal?: AbortSignal) {
    return this.request<{ window: DesktopWindowInfo; elements: DesktopElementInfo[] }>(
      'observe',
      { windowId, includeElements },
      signal,
    )
  }
}

export const windowsDesktop = new WindowsDesktop()
