import { BrowserWindow, app } from 'electron'
import { isPackagedRuntime } from '../utils/runtimeMode'
import os from 'node:os'
import path from 'node:path'
import { access, mkdtemp, writeFile, unlink, rmdir, statfs } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  parseStatusCardDesign,
  statusCardDocument,
  type StatusCardImage,
  type StatusCardSnapshot,
} from '../../../packages/shared/src/statusCard'

const execFileAsync = promisify(execFile)
let activeRenders = 0

const cpuTimes = () =>
  os.cpus().reduce(
    (sum, cpu) => {
      sum.idle += cpu.times.idle
      sum.total += Object.values(cpu.times).reduce((a, b) => a + b, 0)
      return sum
    },
    { idle: 0, total: 0 },
  )

async function readGpu(): Promise<StatusCardSnapshot['gpu']> {
  try {
    // 仅执行固定的只读查询；没有 NVIDIA 驱动时继续读取 Electron 的设备信息。
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=name,utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ],
      { windowsHide: true, timeout: 1800, maxBuffer: 16 * 1024 },
    )
    const [name, usage, used, total] = stdout
      .trim()
      .split(/\r?\n/)[0]!
      .split(',')
      .map((s) => s.trim())
    if (name)
      return {
        name,
        percent: numeric(usage, 1),
        usedBytes: numeric(used, 1024 ** 2),
        totalBytes: numeric(total, 1024 ** 2),
      }
  } catch {
    /* 未安装 NVIDIA 驱动时不视为采集失败。 */
  }
  try {
    let gpuTimer: ReturnType<typeof setTimeout> | undefined
    const info = (await Promise.race([
      app.getGPUInfo('basic'),
      new Promise<never>((_, reject) => {
        gpuTimer = setTimeout(() => reject(new Error('GPU 信息读取超时')), 1000)
      }),
    ]).finally(() => {
      if (gpuTimer) clearTimeout(gpuTimer)
    })) as {
      gpuDevice?: Array<{ active?: boolean; deviceString?: string }>
    }
    const device = info.gpuDevice?.find((d) => d.active) ?? info.gpuDevice?.[0]
    return device?.deviceString
      ? { name: device.deviceString, percent: null, usedBytes: null, totalBytes: null }
      : null
  } catch {
    return null
  }
}

function numeric(value: string | undefined, multiplier: number): number | null {
  if (!value?.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n * multiplier : null
}

async function readSnapshot(tasks: StatusCardSnapshot['tasks']): Promise<StatusCardSnapshot> {
  const start = cpuTimes()
  const [gpu, disk] = await Promise.all([
    readGpu(),
    statfs(
      process.platform === 'win32' ? path.parse(process.env.SystemRoot ?? 'C:\\Windows').root : '/',
    )
      .then((s) => ({ totalBytes: s.blocks * s.bsize, usedBytes: (s.blocks - s.bavail) * s.bsize }))
      .catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 300)),
  ])
  const end = cpuTimes()
  const total = end.total - start.total
  return {
    capturedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    deviceName: os.hostname(),
    platform: `${os.platform()} · ${os.arch()}`,
    uptimeSeconds: os.uptime(),
    cpu: {
      model: os.cpus()[0]?.model ?? '未知',
      cores: os.cpus().length,
      percent:
        total > 0 ? Math.max(0, Math.min(100, (1 - (end.idle - start.idle) / total) * 100)) : null,
    },
    memory: { totalBytes: os.totalmem(), usedBytes: os.totalmem() - os.freemem() },
    gpu,
    disk,
    tasks,
  }
}

/** 专用隐藏窗口渲染，不操作用户浏览器，也不读取桌面画面。 */
export async function renderStatusCard(
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<StatusCardImage> {
  const design = parseStatusCardDesign(input.design)
  if (activeRenders >= 1) throw new Error('STATUS_CARD_BUSY: 状态卡片正在生成，请稍后再试')
  if (signal.aborted) throw new Error('STATUS_CARD_CANCELLED: 卡片生成已取消')
  activeRenders++
  let win: BrowserWindow | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let tempDir: string | undefined
  const close = () => {
    if (win && !win.isDestroyed()) win.destroy()
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    const tasks = Array.isArray(input.tasks)
      ? input.tasks.slice(0, 5).map((item) => {
          const t = item as Record<string, unknown>
          return {
            title: String(t?.title ?? '').slice(0, 80),
            status: String(t?.status ?? '').slice(0, 32),
          }
        })
      : []
    const snapshot = await readSnapshot(tasks)
    if (signal.aborted) throw new Error('STATUS_CARD_CANCELLED: 卡片生成已取消')
    const fontPath = isPackagedRuntime
      ? path.join(process.resourcesPath, 'status-card/zpix.ttf')
      : path.join(app.getAppPath(), 'packages/frontend/src/assets/fonts/zpix.ttf')
    await access(fontPath)
    const fontUrl = pathToFileURL(fontPath).href
    const html = statusCardDocument(design, snapshot, fontUrl)
    tempDir = await mkdtemp(path.join(app.getPath('temp'), 'infos-status-card-'))
    const htmlPath = path.join(tempDir, 'card.html')
    await writeFile(htmlPath, html, 'utf8')
    if (signal.aborted) throw new Error('STATUS_CARD_CANCELLED: 卡片生成已取消')
    win = new BrowserWindow({
      show: false,
      focusable: false,
      skipTaskbar: true,
      width: 720,
      height: 1600,
      frame: false,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: 'status-card-renderer',
      },
    })
    const contents = win.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    )
    const htmlUrl = pathToFileURL(htmlPath).href
    contents.session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== htmlUrl && details.url !== fontUrl }),
    )
    return await Promise.race([
      (async () => {
        await contents.loadFile(htmlPath)
        const height = (await contents.executeJavaScript(
          'document.fonts.ready.then(() => { if (!document.fonts.check("16px Zpix")) throw new Error("像素字体加载失败"); return Math.ceil(document.body.getBoundingClientRect().height) })',
        )) as number
        if (!Number.isFinite(height) || height > 1600 || height < 1)
          throw new Error('STATUS_CARD_SIZE_INVALID: 卡片内容超出图片尺寸')
        win!.setContentSize(720, height)
        await contents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        )
        const image = await contents.capturePage(
          { x: 0, y: 0, width: 720, height },
          { stayHidden: true, stayAwake: true },
        )
        if (image.isEmpty()) throw new Error('STATUS_CARD_EMPTY: 未生成卡片图片')
        return {
          imageBase64: image.toPNG().toString('base64'),
          mimeType: 'image/png' as const,
          snapshot,
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          close()
          reject(new Error('STATUS_CARD_TIMEOUT: 卡片渲染超时'))
        }, 10_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', close)
    close()
    activeRenders--
    if (tempDir) {
      await unlink(path.join(tempDir, 'card.html')).catch(() => {})
      await rmdir(tempDir).catch(() => {})
    }
  }
}
