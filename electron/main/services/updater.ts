/**
 * Electron Release 更新服务。
 *
 * 安装版：下载所选 Release 的 NSIS 安装包，应用完整退出后静默安装。
 * 便携版：下载所选 Release 的 ZIP，预先解压到缓存；应用退出后由 cmd 助手覆盖本体并重启。
 * 数据目录独立于程序本体：安装版位于 userData/data，便携版位于 exe 同级 data，更新器绝不覆盖它。
 */
import { app, BrowserWindow } from 'electron'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isDev, isPackaged, isPortable, paths } from '../utils/env'
import { logger } from '../utils/logger'

const RELEASES_URL = 'https://api.github.com/repos/YoKONCy/infOS/releases?per_page=20'
const RELEASES_PAGE = 'https://github.com/YoKONCy/infOS/releases'
const CACHE_FILE = 'client-release-list.json'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export type ReleaseChannel = 'stable' | 'rc' | 'alpha' | 'beta' | 'hotfix'
export type UpdateDeployment = 'installed' | 'portable' | 'unsupported'

export interface UpdateRelease {
  tagName: string
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  channel: ReleaseChannel
  prerelease: boolean
  assetName: string
  assetSize: number
  downloadUrl: string
  digest?: string
}

export interface UpdateState {
  phase: UpdatePhase
  deployment: UpdateDeployment
  currentVersion: string
  selectedVersion?: string
  selectedTag?: string
  progress: number
  transferredBytes?: number
  totalBytes?: number
  message: string
  checkedAt?: string
  downloadedPath?: string
}

interface GithubAsset {
  name?: unknown
  size?: unknown
  browser_download_url?: unknown
  digest?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  published_at?: unknown
  html_url?: unknown
  prerelease?: unknown
  draft?: unknown
  assets?: unknown
}

let releases: UpdateRelease[] = []
let selectedRelease: UpdateRelease | null = null
let portableStagingPath: string | null = null
let state: UpdateState = createInitialState()

function deployment(): UpdateDeployment {
  // Steam 版通过安装目录内的 steam_appid.txt 固化识别，不能依赖构建时环境变量继续存在。
  const steamManaged =
    process.env.INFOS_EDITION === 'steam' ||
    (isPackaged && existsSync(join(dirname(app.getPath('exe')), 'steam_appid.txt')))
  if (!isPackaged || isDev || steamManaged) return 'unsupported'
  return isPortable ? 'portable' : 'installed'
}

function createInitialState(): UpdateState {
  const mode = deployment()
  return {
    phase: 'idle',
    deployment: mode,
    currentVersion: app.getVersion(),
    progress: 0,
    message:
      mode === 'unsupported'
        ? isDev
          ? '开发版本不使用 Release 自动更新'
          : '当前发行形态不支持此更新器'
        : '尚未检查更新',
  }
}

function broadcast(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('client-update-state', { ...state })
  })
}

function updateState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

function normalizeVersion(tagName: string): string {
  return tagName.trim().replace(/^v/i, '')
}

/** Release 标签映射优先级：hotfix > alpha > beta > rc > stable */
export function classifyReleaseChannel(versionOrTag: string): ReleaseChannel {
  const value = versionOrTag.toLocaleLowerCase()
  if (value.includes('hotfix')) return 'hotfix'
  if (value.includes('alpha')) return 'alpha'
  if (value.includes('beta')) return 'beta'
  if (/(?:^|[.-])rc(?:[.-]?\d+)?(?:$|[.+-])/.test(value)) return 'rc'
  return 'stable'
}

function versionParts(value: string): Array<number | string> {
  return (
    normalizeVersion(value)
      .replace(/\+/g, '-')
      // rc10 / beta2 / hotfix3 等后缀必须拆成文字与数字，否则会出现 rc10 < rc2 的字典序错误。
      .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
      .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
      .split(/[.-]/)
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLocaleLowerCase()))
  )
}

/**
 * 比较 Release 版本。
 *
 * hotfix 是项目发行通道而非普通 SemVer 预发布：同一基础版本下，
 * hotfixN 必须高于已发布稳定版，否则 0.9.3 永远看不到 0.9.3-hotfix1。
 * 其他 alpha、beta、rc 仍遵循“稳定版高于预发布”的规则。
 */
export function compareVersions(left: string, right: string): number {
  const leftChannel = classifyReleaseChannel(left)
  const rightChannel = classifyReleaseChannel(right)
  const leftBase = versionParts(left).slice(0, 3)
  const rightBase = versionParts(right).slice(0, 3)
  const baseLength = Math.max(leftBase.length, rightBase.length)
  for (let index = 0; index < baseLength; index++) {
    const av = leftBase[index] ?? 0
    const bv = rightBase[index] ?? 0
    if (av === bv) continue
    return av > bv ? 1 : -1
  }

  if (leftChannel !== rightChannel && (leftChannel === 'hotfix' || rightChannel === 'hotfix')) {
    return leftChannel === 'hotfix' ? 1 : -1
  }

  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const av = a[index]
    const bv = b[index]
    if (av === bv) continue
    if (av === undefined) return typeof bv === 'string' ? 1 : -1
    if (bv === undefined) return typeof av === 'string' ? -1 : 1
    if (typeof av === 'number' && typeof bv === 'string') return 1
    if (typeof av === 'string' && typeof bv === 'number') return -1
    return av > bv ? 1 : -1
  }
  return 0
}

function findAsset(rawAssets: unknown, mode: UpdateDeployment): GithubAsset | undefined {
  if (!Array.isArray(rawAssets)) return undefined
  const assets = rawAssets.filter((asset): asset is GithubAsset =>
    Boolean(asset && typeof asset === 'object'),
  )
  return assets.find((asset) => {
    const name = String(asset.name ?? '')
    return mode === 'portable' ? /Portable.*\.zip$/i.test(name) : /Setup.*\.exe$/i.test(name)
  })
}

function parseReleases(raw: unknown): UpdateRelease[] {
  if (!Array.isArray(raw)) return []
  const mode = deployment()
  const current = app.getVersion()
  return raw
    .filter((item): item is GithubRelease => Boolean(item && typeof item === 'object'))
    .filter((item) => !item.draft)
    .flatMap((item) => {
      const tagName = String(item.tag_name ?? '').trim()
      const version = normalizeVersion(tagName)
      const asset = findAsset(item.assets, mode)
      const downloadUrl = String(asset?.browser_download_url ?? '')
      if (!tagName || !version || !asset || !downloadUrl || compareVersions(version, current) <= 0)
        return []
      return [
        {
          tagName,
          version,
          name: String(item.name ?? tagName),
          body: String(item.body ?? ''),
          publishedAt: String(item.published_at ?? ''),
          htmlUrl: String(item.html_url ?? RELEASES_PAGE),
          channel: classifyReleaseChannel(version),
          prerelease: Boolean(item.prerelease),
          assetName: String(asset.name ?? ''),
          assetSize: Number(asset.size ?? 0),
          downloadUrl,
          digest: typeof asset.digest === 'string' ? asset.digest : undefined,
        } satisfies UpdateRelease,
      ]
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

async function fetchReleaseList(): Promise<UpdateRelease[]> {
  const cachePath = join(paths.cache, CACHE_FILE)
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'infOS-Updater' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
    const list = parseReleases(await response.json())
    await mkdir(paths.cache, { recursive: true })
    await writeFile(cachePath, JSON.stringify(list), 'utf8')
    return list
  } catch (error) {
    logger.warn('Updater', `获取 Release 列表失败，尝试读取缓存: ${String(error)}`)
    try {
      return JSON.parse(await readFile(cachePath, 'utf8')) as UpdateRelease[]
    } catch {
      throw error
    }
  }
}

export function setupUpdater(): void {
  if (deployment() === 'unsupported') return
  setTimeout(() => void checkForUpdates().catch(() => undefined), 10_000)
}

export function getUpdateState(): UpdateState {
  return { ...state }
}

export function getCachedReleases(): UpdateRelease[] {
  return releases.map((release) => ({ ...release }))
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (deployment() === 'unsupported') return getUpdateState()
  updateState({ phase: 'checking', progress: 0, message: '正在检查 GitHub Release…' })
  try {
    releases = await fetchReleaseList()
    selectedRelease = releases[0] ?? null
    updateState({
      phase: releases.length ? 'available' : 'up-to-date',
      selectedVersion: selectedRelease?.version,
      selectedTag: selectedRelease?.tagName,
      progress: releases.length ? 0 : 100,
      message: releases.length ? `发现 ${releases.length} 个可用版本` : '当前已是最新版本',
      checkedAt: new Date().toISOString(),
      downloadedPath: undefined,
    })
    return getUpdateState()
  } catch (error) {
    updateState({
      phase: 'error',
      message: `检查更新失败：${error instanceof Error ? error.message : String(error)}`,
    })
    throw error
  }
}

function selectRelease(tagName?: string): UpdateRelease {
  const target = tagName ? releases.find((release) => release.tagName === tagName) : releases[0]
  if (!target) throw new Error('未找到可下载的 Release 版本')
  selectedRelease = target
  return target
}

async function verifyDigest(filePath: string, digest?: string): Promise<void> {
  if (!digest) return
  const [algorithm, expected] = digest.split(':', 2)
  if (algorithm?.toLocaleLowerCase() !== 'sha256' || !expected) return
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  const actual = hash.digest('hex')
  if (actual.toLocaleLowerCase() !== expected.toLocaleLowerCase()) {
    throw new Error('更新包 SHA-256 校验失败')
  }
}

function assertTrustedDownloadUrl(rawUrl: string): void {
  const url = new URL(rawUrl)
  const trusted =
    url.protocol === 'https:' &&
    (url.hostname === 'github.com' ||
      url.hostname.endsWith('.github.com') ||
      url.hostname.endsWith('.githubusercontent.com'))
  if (!trusted) throw new Error('Release 资产下载地址不受信任')
}

async function downloadFile(release: UpdateRelease, destination: string): Promise<void> {
  assertTrustedDownloadUrl(release.downloadUrl)
  const response = await fetch(release.downloadUrl, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'infOS-Updater' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!response.ok || !response.body) throw new Error(`下载服务器返回 ${response.status}`)
  const total = Number(response.headers.get('content-length') ?? release.assetSize ?? 0)
  let transferred = 0
  const source = Readable.fromWeb(response.body as never)
  source.on('data', (chunk: Buffer) => {
    transferred += chunk.length
    const progress = total > 0 ? Math.min(99, Math.round((transferred / total) * 100)) : 0
    updateState({
      phase: 'downloading',
      progress,
      transferredBytes: transferred,
      totalBytes: total,
      message: total > 0 ? `正在下载 ${progress}%` : '正在下载更新包…',
    })
  })
  await pipeline(source, createWriteStream(destination))
}

async function findPortableRoot(root: string): Promise<string> {
  const marker = join(root, '.portable')
  try {
    if ((await stat(marker)).isFile()) return root
  } catch {
    // 继续扫描下一层
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = join(root, entry.name)
    try {
      if ((await stat(join(child, '.portable'))).isFile()) return child
    } catch {
      // 不是便携根目录
    }
  }
  throw new Error('便携更新包缺少 .portable 标记')
}

export async function downloadUpdate(tagName?: string): Promise<UpdateState> {
  if (deployment() === 'unsupported') return getUpdateState()
  const release = selectRelease(tagName)
  // 便携版暂存必须位于程序目录之外：便携 data/cache 位于目标目录内部，
  // 若在其中执行 /MIR 覆盖，会形成“源目录嵌套于目标目录”的危险更新拓扑。
  const updatesBase =
    deployment() === 'portable'
      ? join(app.getPath('temp'), 'infos-client-updates')
      : join(paths.cache, 'client-updates')
  const updateRoot = join(updatesBase, release.version)
  await rm(updateRoot, { recursive: true, force: true })
  await mkdir(updateRoot, { recursive: true })
  const downloadPath = join(updateRoot, basename(release.assetName))
  updateState({
    phase: 'downloading',
    selectedVersion: release.version,
    selectedTag: release.tagName,
    progress: 0,
    transferredBytes: 0,
    totalBytes: release.assetSize,
    downloadedPath: undefined,
    message: `准备下载 ${release.version}`,
  })
  try {
    await downloadFile(release, downloadPath)
    await verifyDigest(downloadPath, release.digest)
    portableStagingPath = null
    if (deployment() === 'portable') {
      const extractPath = join(updateRoot, 'staging')
      await mkdir(extractPath, { recursive: true })
      new AdmZip(downloadPath).extractAllTo(extractPath, true)
      portableStagingPath = await findPortableRoot(extractPath)
    }
    updateState({
      phase: 'downloaded',
      selectedVersion: release.version,
      selectedTag: release.tagName,
      progress: 100,
      transferredBytes: release.assetSize,
      totalBytes: release.assetSize,
      downloadedPath: downloadPath,
      message: '更新已下载，点击安装后应用将完整退出',
    })
    return getUpdateState()
  } catch (error) {
    updateState({
      phase: 'error',
      message: `下载更新失败：${error instanceof Error ? error.message : String(error)}`,
    })
    throw error
  }
}

function escapeBatch(value: string): string {
  return value.replace(/%/g, '%%').replace(/"/g, '""')
}

async function createInstallHelper(): Promise<string> {
  const helperPath = join(paths.cache, `install-update-${Date.now()}.cmd`)
  const pid = process.pid
  let commands: string[]
  if (deployment() === 'portable') {
    if (!portableStagingPath) throw new Error('便携更新暂存目录不存在')
    const target = dirname(paths.exe)
    commands = [
      '@echo off',
      ':wait_for_app',
      `tasklist /FI "PID eq ${pid}" /NH | find "${pid}" >nul`,
      'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait_for_app)',
      `robocopy "${escapeBatch(portableStagingPath)}" "${escapeBatch(target)}" /MIR /R:3 /W:1 /XD data >nul`,
      `start "" "${escapeBatch(paths.exe)}"`,
      'del "%~f0"',
    ]
  } else {
    if (!state.downloadedPath) throw new Error('安装包不存在')
    commands = [
      '@echo off',
      ':wait_for_app',
      `tasklist /FI "PID eq ${pid}" /NH | find "${pid}" >nul`,
      'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait_for_app)',
      `start "" /wait "${escapeBatch(state.downloadedPath)}" /S --updated`,
      'del "%~f0"',
    ]
  }
  await mkdir(paths.cache, { recursive: true })
  await writeFile(helperPath, commands.join('\r\n'), 'utf8')
  return helperPath
}

export async function installUpdate(): Promise<boolean> {
  if (state.phase !== 'downloaded' || !selectedRelease) return false
  const helperPath = await createInstallHelper()
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${helperPath}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  logger.info('Updater', `已启动退出安装助手: ${selectedRelease.version}`)
  setImmediate(() => app.quit())
  return true
}

/** 兼容旧 Launcher 的单条公告接口。 */
export async function getLatestRelease(): Promise<UpdateRelease | null> {
  if (!releases.length) await checkForUpdates()
  return releases[0] ?? null
}
