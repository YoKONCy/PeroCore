import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  DOCUMENT_MAX_HTML_BYTES,
  DOCUMENT_MAX_OUTPUT_BYTES,
  type DocumentPdfRequest,
  type DocumentPdfResponse,
} from '@infos/shared'

let activeRenders = 0

/** 文档专用后台页面，无账户会话、文件路径、桌面输入或外部网络访问。 */
export async function renderDocumentPdf(
  value: unknown,
  signal: AbortSignal,
): Promise<DocumentPdfResponse> {
  const input = value as Partial<DocumentPdfRequest> | null
  if (
    !input ||
    typeof input.html !== 'string' ||
    Buffer.byteLength(input.html) > DOCUMENT_MAX_HTML_BYTES ||
    !['A4', 'Letter'].includes(input.paper ?? '') ||
    typeof input.landscape !== 'boolean' ||
    typeof input.marginMm !== 'number' ||
    !Number.isFinite(input.marginMm) ||
    input.marginMm < 8 ||
    input.marginMm > 40
  )
    throw new Error('DOCUMENT_INPUT_INVALID: 文档渲染参数无效')
  signal.throwIfAborted()
  if (activeRenders >= 2) throw new Error('DOCUMENT_RENDER_BUSY: 正在导出的 PDF 较多，请稍后重试')
  activeRenders++
  const renderSession = session.fromPartition(`document-export:${randomUUID()}`)
  renderSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  renderSession.setPermissionCheckHandler(() => false)
  renderSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' })
  })
  let win: BrowserWindow
  try {
    win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1200,
      webPreferences: {
        session: renderSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        backgroundThrottling: false,
        // 文稿脚本由下方强制 CSP 禁止；资源准备检查只由主进程执行。
        javascript: true,
      },
    })
  } catch (error) {
    activeRenders--
    throw error
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  const close = () => {
    if (!win.isDestroyed()) win.destroy()
  }
  const timer = setTimeout(close, 30000)
  signal.addEventListener('abort', close, { once: true })
  try {
    const policy =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'\">"
    const html = `<!doctype html>${policy}${input.html.replace(/<!doctype[^>]*>/gi, '')}`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    signal.throwIfAborted()
    // load 完成后打印仍等待字体；不接受来自文稿的可执行脚本。
    await win.webContents.executeJavaScript(
      'document.fonts.ready.then(() => Promise.all(Array.from(document.images, image => image.decode().catch(() => undefined))))',
    )
    signal.throwIfAborted()
    const margin = input.marginMm / 25.4
    const bytes = await win.webContents.printToPDF({
      pageSize: input.paper,
      landscape: input.landscape,
      printBackground: true,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
    })
    signal.throwIfAborted()
    if (bytes.length > DOCUMENT_MAX_OUTPUT_BYTES)
      throw new Error('DOCUMENT_TOO_LARGE: PDF 超过 20MB')
    return { mimeType: 'application/pdf', base64: bytes.toString('base64') }
  } finally {
    activeRenders--
    clearTimeout(timer)
    signal.removeEventListener('abort', close)
    close()
    renderSession.webRequest.onBeforeRequest(null)
    await renderSession.clearCache().catch(() => undefined)
  }
}
