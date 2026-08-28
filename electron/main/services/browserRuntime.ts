import { createHash, randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, app, session, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface BrowserTarget {
  id: string
  window: BrowserWindow
  overlay?: WebContentsView
  createdAt: string
  lastUsedAt: string
  generation: number
  previousSnapshot?: {
    snapshotId: string
    contentHash: string
    structureHash: string
    elementIds: string[]
  }
  pendingDialog?: { type: string; message: string; defaultPrompt?: string }
  network: Array<Record<string, unknown>>
}

interface BrowserDownload {
  id: string
  filename: string
  state: 'running' | 'completed' | 'cancelled' | 'failed'
  receivedBytes: number
  totalBytes: number
  path?: string
}

interface ElementDescriptor {
  handle: string
  tag: string
  text: string
  role?: string
  name?: string
  type?: string
  disabled?: boolean
  checked?: boolean
  value?: string
  required?: boolean
  label?: string
  parentFormHandle?: string
  sensitive?: boolean
  valueLength?: number
  imageId?: string
  src?: string
  alt?: string
  bounds?: { x: number; y: number; width: number; height: number }
}

const PARTITION = 'persist:infos-browser'
const SEARCH_ENDPOINT = 'https://www.bing.com/search?q='
const NAVIGATION_TIMEOUT_MS = 15_000
const MAX_TEXT_LENGTH = 120_000
const MAX_TARGETS = 8
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000
const SEARCH_MIN_INTERVAL_MS = 1_200
const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  bing_cn: 'https://cn.bing.com/search?q=',
  bing_global: SEARCH_ENDPOINT,
} as const

type SearchEngine = keyof typeof SEARCH_ENGINES

export class ElectronBrowserRuntime {
  private readonly targets = new Map<string, BrowserTarget>()
  private activeTargetId?: string
  private nextTarget = 1
  private sessionConfigured = false
  private downloadsAllowed = false
  private readonly downloads = new Map<string, BrowserDownload>()
  private readonly downloadDir = path.join(app.getPath('userData'), 'browser-downloads')
  private invocationQueue: Promise<void> = Promise.resolve()
  private rejectActiveInvocation?: (error: Error) => void
  private readonly programmaticCloseTargetIds = new Set<string>()
  private activeOperator = 'Agent'
  private unlockTimer?: NodeJS.Timeout
  private idleTimer?: NodeJS.Timeout
  private lastError?: string
  private lastCloseReason?: string
  private readonly searchCache = new Map<string, { expiresAt: number; result: unknown }>()
  private readonly searchLastAt = new Map<SearchEngine, number>()

  async invoke(
    operation: string,
    input: Record<string, unknown>,
    operatorName = 'Agent',
  ): Promise<unknown> {
    const run = this.invocationQueue.then(() => {
      this.activeOperator = operatorName
      this.touchRuntime()
      return this.invokeOnce(operation, input)
    })
    this.invocationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async invokeOnce(operation: string, input: Record<string, unknown>): Promise<unknown> {
    let rejectTermination!: (error: Error) => void
    const termination = new Promise<never>((_resolve, reject) => {
      rejectTermination = reject
    })
    this.rejectActiveInvocation = rejectTermination
    if (this.unlockTimer) clearTimeout(this.unlockTimer)
    this.unlockTimer = undefined
    await this.lockActiveTarget(input)
    try {
      return await Promise.race([this.dispatch(operation, input), termination])
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.rejectActiveInvocation = undefined
      this.unlockTimer = setTimeout(() => {
        this.unlockTimer = undefined
        this.unlockAllTargets()
      }, 250)
    }
  }

  private async dispatch(operation: string, input: Record<string, unknown>): Promise<unknown> {
    switch (operation) {
      case 'open':
        return this.open(String(input.url ?? 'about:blank'))
      case 'inspect':
        return this.inspect()
      case 'extract':
        return this.extract()
      case 'search':
        return this.search(input)
      case 'screenshot':
        return this.screenshot()
      case 'elementScreenshot':
        return this.elementScreenshot(input)
      case 'click':
      case 'nativeClick':
        return this.click(String(input.handle ?? input.target ?? ''))
      case 'hover':
        return this.hover(String(input.handle ?? input.target ?? ''))
      case 'type':
      case 'setValue':
        return this.type(
          String(input.handle ?? input.target ?? ''),
          String(input.text ?? input.value ?? ''),
        )
      case 'sendKeys':
        return this.sendKeys(String(input.keys ?? ''))
      case 'selectOption':
        return this.select(String(input.handle ?? input.target ?? ''), input)
      case 'check':
        return this.check(String(input.handle ?? input.target ?? ''), input.checked !== false)
      case 'scroll':
        return this.scroll(input)
      case 'back':
        return this.back()
      case 'wait':
        return this.wait(input)
      case 'listTargets':
        return this.listTargets()
      case 'createTarget':
        return this.createTarget(String(input.url ?? 'about:blank'), true)
      case 'switchTarget':
        return this.switchTarget(String(input.targetId ?? ''))
      case 'closeTarget':
        return this.closeTarget(String(input.targetId ?? ''))
      case 'domQuery':
        return this.domQuery(input)
      case 'sourceSearch':
        return this.sourceSearch(input)
      case 'frameQuery':
        return this.frameQuery()
      case 'handleDialog':
        return this.handleDialog(input)
      case 'storage':
        return this.storage(input)
      case 'emulate':
        return this.emulate(input)
      case 'evaluate':
        return this.evaluate(String(input.expression ?? ''))
      case 'runtimeStatus':
        return this.status()
      case 'networkQuery':
        return this.networkQuery(input)
      case 'networkBody':
        return this.networkBody(input)
      case 'networkConfigure':
        return this.networkConfigure(input)
      case 'downloadConfigure':
        return this.configureDownload(input)
      case 'uploadFile':
        return this.uploadFile(input)
      default:
        throw new Error(`WEB_OPERATION_UNSUPPORTED: ${operation}`)
    }
  }

  private activateTarget(target: BrowserTarget): void {
    this.activeTargetId = target.id
    if (!target.window.isVisible()) target.window.show()
    if (target.window.isMinimized()) target.window.restore()
    target.window.focus()
  }

  show(): void {
    this.activateTarget(this.activeTarget())
  }

  private async lockActiveTarget(_input: Record<string, unknown>): Promise<void> {
    const target = this.activeTargetId ? this.targets.get(this.activeTargetId) : undefined
    if (target && !target.window.isDestroyed()) await this.lockTarget(target)
  }

  private overlayHtml(): string {
    const displayName =
      this.activeOperator === 'system'
        ? 'Agent'
        : this.activeOperator.charAt(0).toUpperCase() + this.activeOperator.slice(1)
    const operator = displayName.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    )
    return `<!doctype html><html><head><meta charset="UTF-8"><style>
      :root{color-scheme:dark;--violet:#a98cff;--violet-2:#7658df}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:Inter,"Microsoft YaHei",sans-serif}
      body{display:grid;place-items:center;background:radial-gradient(circle at 50% 48%,rgba(110,76,205,.1),transparent 38%),rgba(10,12,24,.18);user-select:none;cursor:wait}
      .halo{position:absolute;width:390px;height:190px;border:1px solid rgba(169,140,255,.16);border-radius:50%;filter:blur(.2px);animation:halo 2.8s ease-in-out infinite}.halo:after{position:absolute;inset:18px;content:"";border:1px dashed rgba(169,140,255,.16);border-radius:50%;animation:spin 9s linear infinite}
      .card{position:relative;display:grid;grid-template-columns:54px 1fr;gap:15px;align-items:center;min-width:336px;padding:18px 22px;border:1px solid rgba(171,139,255,.5);border-radius:18px;background:linear-gradient(135deg,rgba(29,25,54,.96),rgba(15,21,40,.94));box-shadow:0 20px 70px rgba(6,8,20,.55),0 0 36px rgba(128,89,235,.16),inset 0 1px rgba(255,255,255,.09);overflow:hidden;animation:card-in .35s cubic-bezier(.2,.8,.2,1)}
      .card:before{position:absolute;inset:0;content:"";background:linear-gradient(110deg,transparent 20%,rgba(151,119,255,.16) 45%,transparent 70%);transform:translateX(-120%);animation:sheen 2.2s ease-in-out infinite}.card:after{position:absolute;right:18px;bottom:9px;width:74px;height:2px;content:"";background:linear-gradient(90deg,transparent,var(--violet),transparent);animation:scan 1.8s ease-in-out infinite}
      .orb{position:relative;width:48px;height:48px;border:1px solid rgba(166,132,255,.45);border-radius:15px;background:rgba(123,92,230,.12);box-shadow:inset 0 0 18px rgba(154,118,255,.1)}
      .orbit{position:absolute;inset:5px;border:1px solid rgba(190,168,255,.22);border-radius:12px;animation:orbit 3.6s linear infinite}.cube{position:absolute;top:14px;left:14px;width:19px;height:19px;border:1px solid #d4c6ff;border-radius:6px;background:linear-gradient(145deg,#e2d9ff,#8b65ef 55%,#5136a2);box-shadow:0 6px 18px rgba(137,98,239,.62);animation:float 1.25s cubic-bezier(.37,0,.24,1) infinite}
      .dot{position:absolute;width:4px;height:4px;border-radius:2px;background:#c9b9ff;animation:spark 1.25s ease-out infinite}.d1{top:5px;right:3px}.d2{bottom:5px;left:3px;animation-delay:.24s}
      strong{display:block;color:#f4f0ff;font-size:14px;letter-spacing:.03em}small{display:flex;align-items:center;gap:8px;margin-top:6px;color:#aaa5c4;font-size:11px}.live{color:#c2adff}.live:before{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:var(--violet);box-shadow:0 0 10px var(--violet);content:"";animation:pulse .9s ease-in-out infinite}
      @keyframes card-in{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}@keyframes halo{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:.9;transform:scale(1.06)}}@keyframes orbit{to{transform:rotate(360deg)}}@keyframes spin{to{transform:rotate(-360deg)}}@keyframes pulse{50%{opacity:.35;transform:scale(.72)}}@keyframes float{0%,100%{transform:translateY(3px) rotate(-8deg)}50%{transform:translateY(-5px) rotate(95deg)}}@keyframes spark{0%,30%{opacity:0;transform:scale(.5)}55%{opacity:1}100%{opacity:0;transform:translate(3px,-5px) rotate(90deg)}}@keyframes sheen{0%,35%{transform:translateX(-120%)}75%,100%{transform:translateX(120%)}}@keyframes scan{0%,100%{opacity:.2;transform:translateX(-18px)}50%{opacity:1;transform:translateX(18px)}}
    </style></head><body><div class="halo"></div><section class="card"><div class="orb"><i class="orbit"></i><i class="cube"></i><i class="dot d1"></i><i class="dot d2"></i></div><div><strong>${operator} 操作中...</strong><small><span class="live">LIVE</span><span>页面已安全锁定，请稍候</span></small></div></section></body></html>`
  }

  private syncOverlayBounds(target: BrowserTarget): void {
    if (!target.overlay || target.window.isDestroyed()) return
    const { width, height } = target.window.getContentBounds()
    target.overlay.setBounds({ x: 0, y: 0, width, height })
  }

  private async lockTarget(target: BrowserTarget): Promise<void> {
    if (target.overlay) return
    const overlay = new WebContentsView({
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })
    target.overlay = overlay
    overlay.setBackgroundColor('#00000000')
    target.window.contentView.addChildView(overlay)
    this.syncOverlayBounds(target)
    await overlay.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(this.overlayHtml())}`,
    )
    if (!target.window.isDestroyed()) {
      this.syncOverlayBounds(target)
      target.window.contentView.addChildView(overlay)
    }
  }

  private unlockAllTargets(): void {
    for (const target of this.targets.values()) {
      if (target.overlay) {
        if (!target.window.isDestroyed()) target.window.contentView.removeChildView(target.overlay)
        if (!target.overlay.webContents.isDestroyed()) target.overlay.webContents.close()
      }
      target.overlay = undefined
    }
  }

  private failActiveInvocation(code: string, message: string): void {
    this.rejectActiveInvocation?.(new Error(`${code}: ${message}`))
  }

  async close(): Promise<void> {
    if (this.unlockTimer) clearTimeout(this.unlockTimer)
    this.unlockTimer = undefined
    for (const id of this.targets.keys()) this.programmaticCloseTargetIds.add(id)
    this.unlockAllTargets()
    for (const target of this.targets.values()) {
      if (!target.window.isDestroyed()) target.window.destroy()
    }
    this.targets.clear()
    this.programmaticCloseTargetIds.clear()
    this.activeTargetId = undefined
    await session
      .fromPartition(PARTITION)
      .clearAuthCache()
      .catch(() => undefined)
  }

  private async loadUrlWithTimeout(window: BrowserWindow, url: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        window.loadURL(this.normalizeUrl(url)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            window.webContents.stop()
            reject(new Error(`WEB_NAVIGATION_TIMEOUT: 页面加载超过${NAVIGATION_TIMEOUT_MS}ms`))
          }, NAVIGATION_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private touchRuntime(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const now = new Date().toISOString()
    for (const target of this.targets.values()) target.lastUsedAt = now
    this.idleTimer = setTimeout(() => {
      this.lastCloseReason = 'idle-timeout'
      for (const id of this.targets.keys()) this.programmaticCloseTargetIds.add(id)
      this.unlockAllTargets()
      for (const target of this.targets.values()) {
        if (!target.window.isDestroyed()) target.window.destroy()
      }
      this.targets.clear()
      this.programmaticCloseTargetIds.clear()
      this.activeTargetId = undefined
    }, IDLE_TIMEOUT_MS)
  }

  private async search(input: Record<string, unknown>): Promise<unknown> {
    if (Array.isArray(input.queries)) {
      const queries = input.queries
        .map((query) => String(query).trim())
        .filter(Boolean)
        .slice(0, 10)
      if (queries.length === 0) throw new Error('WEB_SEARCH_QUERY_REQUIRED: 缺少搜索关键词')
      const items: unknown[] = []
      const mergedResults: Array<Record<string, unknown>> = []
      const seen = new Set<string>()
      for (const query of queries) {
        try {
          const result = (await this.search({ ...input, queries: undefined, query })) as Record<
            string,
            unknown
          >
          items.push({ query, success: true, result })
          for (const item of (result.results as Array<Record<string, unknown>> | undefined) ?? []) {
            const url = String(item.url ?? '')
            if (!url || seen.has(url)) continue
            seen.add(url)
            mergedResults.push({ ...item, matchedQuery: query })
          }
        } catch (error) {
          items.push({
            query,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return { batch: true, queryCount: queries.length, items, results: mergedResults }
    }
    const query = String(input.query ?? '').trim()
    if (!query) throw new Error('WEB_SEARCH_QUERY_REQUIRED: 缺少搜索关键词')
    const requested = String(input.engine ?? 'auto').toLowerCase()
    const engine: SearchEngine =
      requested === 'auto'
        ? /[\u3400-\u9fff]/u.test(query)
          ? 'bing_cn'
          : 'bing_global'
        : requested in SEARCH_ENGINES
          ? (requested as SearchEngine)
          : 'bing_global'
    const maxResults = Math.min(30, Math.max(1, Number(input.maxResults ?? 10)))
    const cacheKey = JSON.stringify({
      query,
      engine,
      maxResults,
      timeRange: input.timeRange,
      market: input.market,
      safeSearch: input.safeSearch,
    })
    const cached = this.searchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() && input.bypassCache !== true) {
      return { ...(cached.result as Record<string, unknown>), cached: true }
    }
    const waitMs = SEARCH_MIN_INTERVAL_MS - (Date.now() - (this.searchLastAt.get(engine) ?? 0))
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    this.searchLastAt.set(engine, Date.now())
    const url = new URL(`${SEARCH_ENGINES[engine]}${encodeURIComponent(query)}`)
    const market = String(input.market ?? '')
    if (market) {
      url.searchParams.set('mkt', market)
      url.searchParams.set('hl', market)
    }
    const safeSearch = String(input.safeSearch ?? '').toLowerCase()
    if (engine.startsWith('bing') && safeSearch) url.searchParams.set('adlt', safeSearch)
    if (engine === 'google' && safeSearch) {
      url.searchParams.set('safe', safeSearch === 'strict' ? 'active' : 'off')
    }
    if (input.timeRange) {
      if (engine.startsWith('bing'))
        url.searchParams.set('filters', `ex1:${String(input.timeRange)}`)
      if (engine === 'google') url.searchParams.set('tbs', `qdr:${String(input.timeRange)}`)
    }
    await this.open(url.toString())
    const extracted = (await this.activeContents().executeJavaScript(`(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const body = clean(document.body?.innerText || '');
      const blocked = /captcha|verify you are human|unusual traffic|安全验证|人机验证/i.test(body);
      const configs = {
        google: ['div.MjjYud,div.g', 'h3', 'a', '.VwiC3b,.IsZvec'],
        baidu: ['div.result,div.c-container', 'h3,.t', 'h3 a,.t a,a', '.c-abstract,[class*=abstract]'],
        bing: ['li.b_algo,li.b_ans', 'h2,h3', 'h2 a,h3 a,a', '.b_caption p,.b_snippet,p']
      };
      const mode = location.hostname.includes('google') ? 'google' : location.hostname.includes('baidu') ? 'baidu' : 'bing';
      const [containerSelector,titleSelector,linkSelector,snippetSelector] = configs[mode];
      const seen = new Set();
      const results = [...document.querySelectorAll(containerSelector)].flatMap((container) => {
        const titleNode = container.querySelector(titleSelector);
        const linkNode = container.querySelector(linkSelector)?.closest('a') || container.querySelector(linkSelector);
        const title = clean(titleNode?.textContent || linkNode?.textContent);
        const href = linkNode?.href || '';
        if (!title || !/^https?:/i.test(href) || seen.has(href)) return [];
        seen.add(href);
        return [{ title, url: href, snippet: clean(container.querySelector(snippetSelector)?.textContent).slice(0, 1000) }];
      }).slice(0, ${maxResults}).map((item,index) => ({ rank:index + 1, ...item }));
      return { effectiveUrl: location.href, pageTitle: document.title, blocked, results };
    })()`)) as Record<string, unknown>
    const result = { query, requestedEngine: engine, ...extracted, cached: false }
    if (!extracted.blocked) {
      this.searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, result })
      if (this.searchCache.size > 200)
        this.searchCache.delete(this.searchCache.keys().next().value!)
    }
    return result
  }

  private async open(url: string): Promise<unknown> {
    if (!this.activeTargetId || !this.targets.has(this.activeTargetId)) {
      const created = (await this.createTarget(url, true)) as { targetId: string }
      const target = this.targets.get(created.targetId)
      if (!target) throw new Error('WEB_TARGET_UNAVAILABLE: 浏览器窗口创建失败')
      return this.inspect()
    }
    const target = this.activeTarget()
    await this.loadUrlWithTimeout(target.window, url)
    return this.inspect()
  }

  private async inspect(): Promise<unknown> {
    const target = this.activeTarget()
    const contents = target.window.webContents
    const page = await contents.executeJavaScript(`(() => {
      const observed = [...document.querySelectorAll('form,a,button,input,textarea,select,img,video,[role]')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
        })
        .slice(0, 500);
      observed.forEach((node, index) => node.setAttribute('data-infos-browser-handle', '${target.generation}:' + String(index + 1)));
      let imageIndex = 0;
      const elements = observed
        .map((node) => {
          const handle = node.getAttribute('data-infos-browser-handle');
          const inputType = node.getAttribute('type') || '';
          const sensitive = node.tagName === 'INPUT' && /password|token|secret|auth|cookie|session|cc-|card|cvv|payment/i.test([inputType,node.id,node.getAttribute('name'),node.getAttribute('autocomplete'),node.getAttribute('aria-label')].filter(Boolean).join(' '));
          const rawValue = typeof node.value === 'string' ? node.value : undefined;
          const isVisual = node.tagName === 'IMG' || node.tagName === 'VIDEO';
          const rect = node.getBoundingClientRect();
          const imageId = isVisual && rect.width >= 96 && rect.height >= 72 ? 'IMG' + String(++imageIndex) : undefined;
          if (imageId) node.setAttribute('data-infos-image-id', imageId);
          return {
            handle,
            tag: node.tagName.toLowerCase(),
            text: (node.innerText || node.textContent || '').trim().slice(0, 500),
            role: node.getAttribute('role') || node.tagName.toLowerCase(),
            name: node.getAttribute('aria-label') || node.getAttribute('name') || (node.innerText || '').trim().slice(0, 200) || undefined,
            type: inputType || undefined,
            disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
            checked: typeof node.checked === 'boolean' ? node.checked : undefined,
            value: sensitive ? undefined : rawValue?.slice(0, 1000),
            valueLength: sensitive ? rawValue?.length : undefined,
            sensitive,
            imageId,
            src: imageId ? (node.currentSrc || node.src || undefined) : undefined,
            alt: imageId ? (node.getAttribute('alt') || node.getAttribute('aria-label') || undefined) : undefined,
            required: Boolean(node.required || node.getAttribute('aria-required') === 'true'),
            label: node.labels?.[0]?.innerText?.trim() || undefined,
            parentFormHandle: node.form?.getAttribute('data-infos-browser-handle') || undefined,
            bounds: (() => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()
          };
        });
      return {
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || '').slice(0, ${MAX_TEXT_LENGTH}),
        hiddenText: [...document.querySelectorAll('body *')]
          .filter((node) => { const style = getComputedStyle(node); return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0; })
          .map((node) => node.textContent || '').join('\\n').slice(0, 20000),
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        elements
      };
    })()`)
    const text = String(page.text ?? '')
    const elements = (page.elements ?? []) as ElementDescriptor[]
    const structure = JSON.stringify(elements)
    const contentHash = createHash('sha256').update(text).digest('hex')
    const structureHash = createHash('sha256').update(structure).digest('hex')
    const snapshotId = `snapshot:${target.id}:${target.generation}:${createHash('sha256')
      .update(text + structure)
      .digest('hex')
      .slice(0, 16)}`
    const elementIds = elements.map((element) => element.handle)
    const previous = target.previousSnapshot
    const diff = {
      previousSnapshotId: previous?.snapshotId,
      contentChanged: Boolean(previous && previous.contentHash !== contentHash),
      structureChanged: Boolean(previous && previous.structureHash !== structureHash),
      addedElementIds: previous ? elementIds.filter((id) => !previous.elementIds.includes(id)) : [],
      removedElementIds: previous
        ? previous.elementIds.filter((id) => !elementIds.includes(id))
        : [],
    }
    target.previousSnapshot = { snapshotId, contentHash, structureHash, elementIds }
    const groundedMarkdown = this.compileGroundedMarkdown(
      String(page.title ?? ''),
      String(page.url ?? contents.getURL()),
      text,
      elements,
      page.viewport as Record<string, unknown>,
    )
    return {
      targetId: target.id,
      generation: target.generation,
      snapshotId,
      title: String(page.title ?? ''),
      url: String(page.url ?? contents.getURL()),
      text,
      hiddenText: String(page.hiddenText ?? ''),
      viewport: page.viewport,
      groundedMarkdown,
      diff,
      contentHash,
      structureHash,
      elements,
      canGoBack: contents.navigationHistory.canGoBack(),
      loading: contents.isLoading(),
    }
  }

  private compileGroundedMarkdown(
    title: string,
    url: string,
    text: string,
    elements: ElementDescriptor[],
    viewport: Record<string, unknown>,
  ): string {
    const lines = [`# ${title || '未命名页面'}`, `URL: ${url}`, '']
    lines.push(
      `> 视口 ${Number(viewport.width ?? 0)}×${Number(viewport.height ?? 0)}，滚动位置 (${Number(viewport.scrollX ?? 0)}, ${Number(viewport.scrollY ?? 0)})`,
      '',
      text.slice(0, 40_000),
      '',
      '## 可操作对象',
    )
    for (const [index, element] of elements.entries()) {
      if (element.imageId) {
        lines.push(
          `- [图片 ${element.imageId}｜${element.alt || element.name || '无描述'}｜${Math.round(element.bounds?.width ?? 0)}×${Math.round(element.bounds?.height ?? 0)}｜handle=${element.handle}]`,
        )
        continue
      }
      if (!['a', 'button', 'input', 'textarea', 'select', 'form'].includes(element.tag)) continue
      const shortId = `A${index + 1}`
      const state = [
        element.disabled ? 'disabled' : '',
        element.checked !== undefined ? `checked=${element.checked}` : '',
        element.sensitive
          ? `value=[已隐藏,长度=${element.valueLength ?? 0}]`
          : element.value
            ? `value=${element.value}`
            : '',
      ]
        .filter(Boolean)
        .join(', ')
      lines.push(
        `- [${shortId}] ${element.role || element.tag}「${element.name || element.label || element.text || '未命名'}」 handle=${element.handle}${state ? ` (${state})` : ''}`,
      )
    }
    return lines.join('\n')
  }

  private async extract(): Promise<unknown> {
    const snapshot = (await this.inspect()) as {
      title: string
      url: string
      text: string
      groundedMarkdown: string
      diff: unknown
    }
    return {
      title: snapshot.title,
      url: snapshot.url,
      content: snapshot.groundedMarkdown,
      plainText: snapshot.text,
      diff: snapshot.diff,
    }
  }

  private async elementScreenshot(input: Record<string, unknown>): Promise<unknown> {
    const target = String(input.imageId ?? input.handle ?? input.target ?? '')
    if (!target) throw new Error('WEB_IMAGE_TARGET_REQUIRED: 缺少图片ID或元素句柄')
    const bounds = (await this.activeContents().executeJavaScript(`(() => {
      const key = ${JSON.stringify(target)};
      const node = document.querySelector('[data-infos-image-id="' + CSS.escape(key) + '"]') || document.querySelector('[data-infos-browser-handle="' + CSS.escape(key) + '"]');
      if (!node) throw new Error('WEB_ELEMENT_NOT_FOUND: ' + key);
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = node.getBoundingClientRect();
      return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    })()`)) as { x: number; y: number; width: number; height: number }
    const image = await this.activeContents().capturePage(bounds)
    return { base64: image.toPNG().toString('base64'), mimeType: 'image/png', target }
  }

  private async screenshot(): Promise<unknown> {
    const image = await this.activeContents().capturePage()
    return { base64: image.toPNG().toString('base64'), mimeType: 'image/png' }
  }

  private async click(target: string): Promise<unknown> {
    this.assertHandleGeneration(target)
    await this.withElement(target, `(element) => element.click()`)
    await this.wait({ ms: 250 })
    return this.inspect()
  }

  private async hover(target: string): Promise<unknown> {
    await this.withElement(
      target,
      `(element) => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`,
    )
    return this.inspect()
  }

  private async type(target: string, text: string): Promise<unknown> {
    await this.withElement(
      target,
      `(element) => {
        element.focus();
        element.value = ${JSON.stringify(text)};
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
    )
    return this.inspect()
  }

  private async sendKeys(keys: string): Promise<unknown> {
    this.activeContents().sendInputEvent({ type: 'keyDown', keyCode: keys })
    this.activeContents().sendInputEvent({ type: 'keyUp', keyCode: keys })
    return this.inspect()
  }

  private async select(target: string, input: Record<string, unknown>): Promise<unknown> {
    const value = input.value ?? input.index ?? ''
    await this.withElement(
      target,
      `(element) => { element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event('change', { bubbles: true })); }`,
    )
    return this.inspect()
  }

  private async check(target: string, checked: boolean): Promise<unknown> {
    await this.withElement(
      target,
      `(element) => { element.checked = ${checked}; element.dispatchEvent(new Event('change', { bubbles: true })); }`,
    )
    return this.inspect()
  }

  private async scroll(input: Record<string, unknown>): Promise<unknown> {
    const direction = String(input.direction ?? 'down')
    const amount = Math.max(1, Number(input.amount ?? 0))
    const target = String(input.target ?? input.handle ?? '')
    return this.activeContents().executeJavaScript(`(() => {
      const root = ${JSON.stringify(target)} ? (document.querySelector(${JSON.stringify(target)}) || document.querySelector('[data-infos-browser-handle="' + CSS.escape(${JSON.stringify(target)}) + '"]')) : document.scrollingElement;
      if (!root) throw new Error('WEB_SCROLL_TARGET_NOT_FOUND');
      const before = { x: root.scrollLeft, y: root.scrollTop };
      const vw = root === document.scrollingElement ? innerWidth : root.clientWidth;
      const vh = root === document.scrollingElement ? innerHeight : root.clientHeight;
      const stepX = ${amount} || Math.round(vw * .8);
      const stepY = ${amount} || Math.round(vh * .8);
      const direction = ${JSON.stringify(direction)};
      if (direction === 'top') root.scrollTo({ top: 0, behavior: 'instant' });
      else if (direction === 'bottom') root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
      else if (direction === 'left') root.scrollBy({ left: -stepX, behavior: 'instant' });
      else if (direction === 'right') root.scrollBy({ left: stepX, behavior: 'instant' });
      else if (direction === 'to') root.scrollTo({ left: ${Number(input.x ?? 0)}, top: ${Number(input.y ?? 0)}, behavior: 'instant' });
      else root.scrollBy({ top: ['up','page_up'].includes(direction) ? -stepY : stepY, behavior: 'instant' });
      const after = { x: root.scrollLeft, y: root.scrollTop };
      return { before, after, moved: before.x !== after.x || before.y !== after.y, reachedBoundary: before.x === after.x && before.y === after.y, max: { x: root.scrollWidth - root.clientWidth, y: root.scrollHeight - root.clientHeight } };
    })()`)
  }

  private async back(): Promise<unknown> {
    const contents = this.activeContents()
    if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    await this.wait({ ms: 300 })
    return this.inspect()
  }

  private async wait(input: Record<string, unknown>): Promise<unknown> {
    const condition = String(input.condition ?? 'delay')
    const timeoutMs = Math.min(30_000, Math.max(0, Number(input.timeoutMs ?? input.ms ?? 500)))
    if (condition === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs))
      return this.inspect()
    }
    const pollMs = Math.min(1_000, Math.max(50, Number(input.pollMs ?? 100)))
    const stableMs = Math.min(timeoutMs, Math.max(100, Number(input.stableMs ?? 500)))
    const started = Date.now()
    let stableSince = 0
    let previousHash = ''
    while (Date.now() - started <= timeoutMs) {
      const state = (await this.activeContents().executeJavaScript(`(() => {
        const condition = ${JSON.stringify(condition)};
        const target = ${JSON.stringify(String(input.target ?? ''))};
        const expected = ${JSON.stringify(String(input.text ?? input.url ?? input.value ?? ''))};
        const node = target ? (() => { try { return document.querySelector(target) || document.querySelector('[data-infos-browser-handle="' + CSS.escape(target) + '"]'); } catch { return null; } })() : null;
        const visible = node ? (() => { const r=node.getBoundingClientRect(),s=getComputedStyle(node); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; })() : false;
        const pass = condition==='element' ? Boolean(node) : condition==='visible' ? visible : condition==='hidden' ? !node||!visible : condition==='text' ? (document.body?.innerText||'').includes(expected) : condition==='url' ? location.href.includes(expected) : condition==='value' ? String(node?.value??'')===expected : false;
        return { pass, hash: document.body?.innerText?.length + ':' + document.querySelectorAll('*').length, url: location.href };
      })()`)) as { pass: boolean; hash: string; url: string }
      if (condition === 'dom_stable') {
        if (state.hash === previousHash) stableSince ||= Date.now()
        else stableSince = 0
        previousHash = state.hash
        if (stableSince && Date.now() - stableSince >= stableMs)
          return { condition, satisfied: true }
      } else if (state.pass) return { condition, satisfied: true, url: state.url }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    throw new Error(`WEB_WAIT_TIMEOUT: 等待条件 ${condition} 超时`)
  }

  private listTargets(): unknown[] {
    return [...this.targets.values()].map((target) => ({
      targetId: target.id,
      title: target.window.webContents.getTitle(),
      url: target.window.webContents.getURL(),
      active: target.id === this.activeTargetId,
      visible: target.window.isVisible(),
      createdAt: target.createdAt,
      lastUsedAt: target.lastUsedAt,
      generation: target.generation,
    }))
  }

  private async createTarget(url: string, activate: boolean): Promise<unknown> {
    if (this.targets.size >= MAX_TARGETS) {
      throw new Error(`WEB_TARGET_LIMIT_REACHED: 浏览器窗口数量已达上限 ${MAX_TARGETS}`)
    }
    const id = `browser-${this.nextTarget++}`
    const browserSession = session.fromPartition(PARTITION)
    if (!this.sessionConfigured) {
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      fs.mkdirSync(this.downloadDir, { recursive: true })
      browserSession.on('will-download', (event, item) => {
        if (!this.downloadsAllowed) {
          event.preventDefault()
          return
        }
        const id = randomUUID()
        const filename = path.basename(item.getFilename())
        const destination = path.join(this.downloadDir, `${id}-${filename}`)
        const download: BrowserDownload = {
          id,
          filename,
          state: 'running',
          receivedBytes: 0,
          totalBytes: item.getTotalBytes(),
          path: destination,
        }
        this.downloads.set(id, download)
        item.setSavePath(destination)
        item.on('updated', (_event, state) => {
          download.receivedBytes = item.getReceivedBytes()
          if (state === 'interrupted') download.state = 'failed'
        })
        item.once('done', (_event, state) => {
          download.receivedBytes = item.getReceivedBytes()
          download.state =
            state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed'
        })
      })
      this.sessionConfigured = true
    }
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      title: 'infOS Browser',
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
    win.webContents.setWindowOpenHandler(({ url: requestedUrl }) => {
      void this.createTarget(requestedUrl, true)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, requestedUrl) => {
      if (!this.isAllowedUrl(requestedUrl)) event.preventDefault()
    })
    win.on('closed', () => {
      const programmatic = this.programmaticCloseTargetIds.delete(id)
      if (target.overlay) {
        if (!target.overlay.webContents.isDestroyed()) target.overlay.webContents.close()
        target.overlay = undefined
      }
      this.lastCloseReason = programmatic ? 'programmatic' : 'user-closed'
      this.targets.delete(id)
      if (this.activeTargetId === id) this.activeTargetId = this.targets.keys().next().value
      if (!programmatic) {
        this.failActiveInvocation('WEB_TARGET_CLOSED', '用户关闭了内置浏览器窗口')
      }
    })
    win.on('move', () => this.syncOverlayBounds(target))
    win.on('resize', () => this.syncOverlayBounds(target))
    win.on('maximize', () => this.syncOverlayBounds(target))
    win.on('unmaximize', () => this.syncOverlayBounds(target))
    win.webContents.on('render-process-gone', (_event, details) => {
      this.lastCloseReason = `renderer-${details.reason}`
      this.failActiveInvocation(
        'WEB_RENDERER_CRASHED',
        `内置浏览器渲染进程异常退出（${details.reason}，exitCode=${details.exitCode}）`,
      )
      this.programmaticCloseTargetIds.add(id)
      if (!win.isDestroyed()) win.destroy()
    })
    win.on('unresponsive', () => {
      this.failActiveInvocation('WEB_TARGET_UNRESPONSIVE', '内置浏览器窗口无响应')
    })
    const now = new Date().toISOString()
    const target: BrowserTarget = {
      id,
      window: win,
      createdAt: now,
      lastUsedAt: now,
      generation: 1,
      network: [],
    }
    this.targets.set(id, target)
    if (activate) this.activateTarget(target)
    await this.lockTarget(target)
    void this.attachDebugger(target).catch(() => undefined)
    win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) target.generation += 1
    })
    win.webContents.on('did-finish-load', () => {
      target.generation = Math.max(1, target.generation)
    })
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      target.network.push({
        type: 'navigation-failed',
        code,
        description,
        url,
        at: new Date().toISOString(),
      })
    })
    await this.loadUrlWithTimeout(win, url)
    return { targetId: id, url: win.webContents.getURL() }
  }

  private switchTarget(targetId: string): unknown {
    const target = this.targets.get(targetId)
    if (!target) throw new Error(`WEB_TARGET_NOT_FOUND: ${targetId}`)
    this.activateTarget(target)
    return this.listTargets()
  }

  private closeTarget(targetId: string): unknown {
    const target = this.targets.get(targetId)
    if (!target) return this.listTargets()
    this.programmaticCloseTargetIds.add(targetId)
    target.window.destroy()
    return this.listTargets()
  }

  private async domQuery(input: Record<string, unknown>): Promise<unknown> {
    const selector = String(input.selector ?? '*')
    return this.activeContents().executeJavaScript(
      `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 200).map((node) => ({ tag: node.tagName.toLowerCase(), text: (node.innerText || node.textContent || '').trim().slice(0, 1000), html: node.outerHTML.slice(0, 4000) })))()`,
    )
  }

  private async sourceSearch(input: Record<string, unknown>): Promise<unknown> {
    const query = String(input.query ?? '')
    if (!query) throw new Error('WEB_SOURCE_QUERY_REQUIRED')
    const regex = input.regex === true
    const caseSensitive = input.caseSensitive === true
    const maxResults = Math.min(100, Math.max(1, Number(input.maxResults ?? 20)))
    return this.activeContents().executeJavaScript(`(() => {
      const query = ${JSON.stringify(query)};
      const flags = ${JSON.stringify(caseSensitive ? 'g' : 'gi')};
      const pattern = ${regex} ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^\${}()|[\\]\\]/g, '\\$&'), flags);
      const selectedScopes = new Set(${JSON.stringify(
        String(input.scope ?? 'dom,inline_script,style,codeblock')
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean),
      )});
      const sources = [
        { scope:'dom', content: document.documentElement.outerHTML },
        ...[...document.querySelectorAll('script:not([src])')].map((node) => ({ scope:'inline_script', content:node.textContent||'' })),
        ...[...document.querySelectorAll('style')].map((node) => ({ scope:'style', content:node.textContent||'' })),
        ...[...document.querySelectorAll('pre,code')].map((node) => ({ scope:'codeblock', content:node.textContent||'' }))
      ].filter((source) => selectedScopes.has(source.scope));
      const results=[];
      for (const source of sources) {
        pattern.lastIndex=0; let match;
        while ((match=pattern.exec(source.content)) && results.length < ${maxResults}) {
          results.push({ scope:source.scope, index:match.index, match:match[0], excerpt:source.content.slice(Math.max(0,match.index-300),match.index+match[0].length+300) });
          if (!match[0]) pattern.lastIndex++;
        }
      }
      return { query, regex:${regex}, results, total:results.length, truncated:results.length>=${maxResults} };
    })()`)
  }

  private frameQuery(): unknown {
    return this.activeContents().mainFrame.framesInSubtree.map((frame) => ({
      name: frame.name,
      url: frame.url,
    }))
  }

  private async attachDebugger(target: BrowserTarget): Promise<void> {
    const debuggerApi = target.window.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    await debuggerApi.sendCommand('Network.enable')
    await debuggerApi.sendCommand('Page.enable')
    debuggerApi.on('message', (_event, method, params) => {
      if (method.startsWith('Network.')) {
        target.network.push({
          method,
          ...(params as Record<string, unknown>),
          at: new Date().toISOString(),
        })
        if (target.network.length > 2_000) target.network.splice(0, target.network.length - 2_000)
      }
      if (method === 'Page.javascriptDialogOpening') {
        const value = params as { type?: string; message?: string; defaultPrompt?: string }
        target.pendingDialog = {
          type: value.type ?? 'alert',
          message: value.message ?? '',
          defaultPrompt: value.defaultPrompt,
        }
      }
      if (method === 'Page.javascriptDialogClosed') target.pendingDialog = undefined
    })
  }

  private async handleDialog(input: Record<string, unknown>): Promise<unknown> {
    const target = this.activeTarget()
    if (!target.pendingDialog) throw new Error('WEB_DIALOG_UNAVAILABLE: 当前没有待处理对话框')
    await target.window.webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
      accept: input.accept !== false,
      promptText: typeof input.promptText === 'string' ? input.promptText : undefined,
    })
    const dialog = target.pendingDialog
    target.pendingDialog = undefined
    return { handled: true, dialog }
  }

  private networkQuery(input: Record<string, unknown>): unknown {
    const query = String(input.query ?? '').toLowerCase()
    const events = this.activeTarget().network
    return query
      ? events.filter((event) => JSON.stringify(event).toLowerCase().includes(query)).slice(-500)
      : events.slice(-500)
  }

  private async networkBody(input: Record<string, unknown>): Promise<unknown> {
    const requestId = String(input.requestId ?? '')
    if (!requestId) throw new Error('WEB_NETWORK_REQUEST_ID_REQUIRED')
    return this.activeContents().debugger.sendCommand('Network.getResponseBody', { requestId })
  }

  private async networkConfigure(input: Record<string, unknown>): Promise<unknown> {
    const debuggerApi = this.activeContents().debugger
    if (typeof input.offline === 'boolean') {
      await debuggerApi.sendCommand('Network.emulateNetworkConditions', {
        offline: input.offline,
        latency: Number(input.latency ?? 0),
        downloadThroughput: Number(input.downloadThroughput ?? -1),
        uploadThroughput: Number(input.uploadThroughput ?? -1),
      })
    }
    if (input.clear === true) this.activeTarget().network.length = 0
    return { configured: true }
  }

  private configureDownload(input: Record<string, unknown>): unknown {
    this.downloadsAllowed = input.enabled !== false
    return {
      enabled: this.downloadsAllowed,
      directory: this.downloadDir,
      downloads: [...this.downloads.values()].map((download) => ({
        ...download,
        digest:
          download.state === 'completed' && download.path && fs.existsSync(download.path)
            ? `sha256:${createHash('sha256').update(fs.readFileSync(download.path)).digest('hex')}`
            : undefined,
      })),
    }
  }

  private async uploadFile(input: Record<string, unknown>): Promise<unknown> {
    const token = String(input.fileToken ?? '')
    const handle = String(input.handle ?? input.target ?? '')
    if (!token || !/^[a-zA-Z0-9._-]+$/.test(token)) throw new Error('FILE_HANDLE_INVALID')
    const importRoot = path.resolve(app.getPath('userData'), 'imports')
    const filePath = path.resolve(importRoot, token)
    if (!filePath.startsWith(`${importRoot}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new Error('FILE_HANDLE_NOT_FOUND')
    }
    this.assertHandleGeneration(handle)
    const documentNodeId = await this.resolveBackendNodeId(handle)
    await this.activeContents().debugger.sendCommand('DOM.setFileInputFiles', {
      files: [filePath],
      backendNodeId: documentNodeId,
    })
    return {
      uploaded: true,
      fileToken: token,
      digest: `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`,
    }
  }

  private async resolveBackendNodeId(handle: string): Promise<number> {
    const document = (await this.activeContents().debugger.sendCommand('DOM.getDocument', {
      depth: 1,
    })) as { root: { nodeId: number } }
    const result = (await this.activeContents().debugger.sendCommand('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: `[data-infos-browser-handle="${handle.replaceAll('"', '\\"')}"]`,
    })) as { nodeId: number }
    if (!result.nodeId) throw new Error(`WEB_ELEMENT_NOT_FOUND: ${handle}`)
    const described = (await this.activeContents().debugger.sendCommand('DOM.describeNode', {
      nodeId: result.nodeId,
    })) as { node: { backendNodeId: number } }
    return described.node.backendNodeId
  }

  private async storage(input: Record<string, unknown>): Promise<unknown> {
    const area = String(input.area ?? 'local')
    const action = String(input.action ?? 'get')
    if (area === 'cookies') {
      const browserSession = session.fromPartition(PARTITION)
      if (action === 'get')
        return browserSession.cookies.get(
          typeof input.origin === 'string' ? { url: input.origin } : {},
        )
      if (action === 'clear') return browserSession.clearStorageData({ storages: ['cookies'] })
      throw new Error('WEB_STORAGE_OPERATION_UNAVAILABLE: Cookie写入需要结构化 Cookie输入')
    }
    const storageName = area === 'session' ? 'sessionStorage' : 'localStorage'
    const key = typeof input.key === 'string' ? input.key : undefined
    if (action === 'get')
      return this.activeContents().executeJavaScript(
        key
          ? `${storageName}.getItem(${JSON.stringify(key)})`
          : `Object.fromEntries(Object.entries(${storageName}))`,
      )
    if (action === 'set' && key)
      return this.activeContents().executeJavaScript(
        `${storageName}.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(input.value ?? ''))})`,
      )
    if (action === 'remove' && key)
      return this.activeContents().executeJavaScript(
        `${storageName}.removeItem(${JSON.stringify(key)})`,
      )
    if (action === 'clear') return this.activeContents().executeJavaScript(`${storageName}.clear()`)
    throw new Error('WEB_STORAGE_INPUT_INVALID')
  }

  private async emulate(input: Record<string, unknown>): Promise<unknown> {
    if (typeof input.userAgent === 'string') this.activeContents().setUserAgent(input.userAgent)
    const width = Number(input.width)
    const height = Number(input.height)
    if (Number.isFinite(width) && Number.isFinite(height))
      this.activeTarget().window.setContentSize(Math.max(320, width), Math.max(240, height))
    return this.status()
  }

  private async evaluate(expression: string): Promise<unknown> {
    if (!expression.trim()) throw new Error('WEB_EVALUATE_EXPRESSION_REQUIRED')
    return this.activeContents().executeJavaScript(expression)
  }

  private status(): unknown {
    const active = this.activeTargetId ? this.targets.get(this.activeTargetId) : undefined
    return {
      available: true,
      partition: PARTITION,
      profilePath: path.join(app.getPath('userData'), 'Partitions', 'infos-browser'),
      activeTargetId: this.activeTargetId,
      targetCount: this.targets.size,
      maxTargets: MAX_TARGETS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      rendererPid: active?.window.webContents.getOSProcessId(),
      debuggerAttached: active?.window.webContents.debugger.isAttached() ?? false,
      locked: Boolean(active?.overlay),
      activeOperator: this.activeOperator,
      lastError: this.lastError,
      lastCloseReason: this.lastCloseReason,
      searchCacheEntries: this.searchCache.size,
      targets: this.listTargets(),
      pendingDialog: this.activeTargetId
        ? this.targets.get(this.activeTargetId)?.pendingDialog
        : undefined,
      downloads: [...this.downloads.values()],
    }
  }

  private async withElement(target: string, operation: string): Promise<void> {
    if (!target.trim()) throw new Error('WEB_ELEMENT_TARGET_REQUIRED')
    this.assertHandleGeneration(target)
    const script = `(() => {
      const escaped = ${JSON.stringify(target)};
      const byHandle = document.querySelector('[data-infos-browser-handle="' + CSS.escape(escaped) + '"]');
      const bySelector = (() => { try { return document.querySelector(escaped); } catch { return null; } })();
      const byText = [...document.querySelectorAll('a,button,input,textarea,select,[role]')].find((node) => (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim().includes(escaped));
      const element = byHandle || bySelector || byText;
      if (!element) throw new Error('WEB_ELEMENT_NOT_FOUND: ' + escaped);
      return (${operation})(element);
    })()`
    await this.activeContents().executeJavaScript(script)
  }

  private assertHandleGeneration(handle: string): void {
    const match = /^(\d+):/.exec(handle)
    if (match && Number(match[1]) !== this.activeTarget().generation) {
      throw new Error(
        `RUNTIME_STALE_HANDLE: 句柄代次 ${match[1]} 与当前页面代次 ${this.activeTarget().generation} 不一致`,
      )
    }
  }

  private activeTarget(): BrowserTarget {
    const target = this.activeTargetId ? this.targets.get(this.activeTargetId) : undefined
    if (!target || target.window.isDestroyed()) throw new Error('WEB_TARGET_UNAVAILABLE')
    return target
  }

  private activeContents(): WebContents {
    return this.activeTarget().window.webContents
  }

  private normalizeUrl(value: string): string {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
    if (!this.isAllowedUrl(url)) throw new Error(`WEB_URL_SCHEME_BLOCKED: ${url}`)
    return url
  }

  private isAllowedUrl(value: string): boolean {
    try {
      return ['http:', 'https:', 'about:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }
}
