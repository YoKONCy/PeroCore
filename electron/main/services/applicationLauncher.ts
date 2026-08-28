import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { shell } from 'electron'
import { activateWindow, listWindows } from './desktopAutomation'

export interface InstalledApplication {
  name: string
  appId: string
}

export interface ApplicationLaunchResult {
  success: true
  application: string
  mode: 'activated' | 'launched'
  targetType: 'window' | 'path' | 'aumid'
}

export interface ApplicationLauncherDeps {
  platform: NodeJS.Platform
  discoverApplications(): Promise<InstalledApplication[]>
  listWindows(): Promise<Array<{ processName: string; title: string }>>
  activateWindow(target: string): Promise<string>
  openPath(target: string): Promise<string>
  launchAumid(appId: string): Promise<void>
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, '')
}

export function rankApplications(
  query: string,
  applications: InstalledApplication[],
): InstalledApplication[] {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []
  return applications
    .map((application) => {
      const name = normalize(application.name)
      const appId = normalize(application.appId)
      const score =
        name === normalizedQuery
          ? 100
          : appId === normalizedQuery
            ? 95
            : name.startsWith(normalizedQuery)
              ? 80
              : name.includes(normalizedQuery)
                ? 60
                : appId.includes(normalizedQuery)
                  ? 40
                  : 0
      return { application, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.application.name.localeCompare(b.application.name))
    .map((item) => item.application)
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      },
    )
  })
}

const APPLICATION_CACHE_TTL_MS = 5 * 60_000
let windowsApplicationCache: { expiresAt: number; applications: InstalledApplication[] } | undefined

export async function discoverWindowsApplications(): Promise<InstalledApplication[]> {
  if (windowsApplicationCache && windowsApplicationCache.expiresAt > Date.now()) {
    return windowsApplicationCache.applications
  }
  const script = [
    '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()',
    'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress',
  ].join('; ')
  const output = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ])
  const parsed = JSON.parse(output || '[]') as
    | { Name?: unknown; AppID?: unknown }
    | Array<{ Name?: unknown; AppID?: unknown }>
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  const applications = entries
    .filter(
      (entry): entry is { Name: string; AppID: string } =>
        typeof entry.Name === 'string' && typeof entry.AppID === 'string',
    )
    .map((entry) => ({ name: entry.Name.trim(), appId: entry.AppID.trim() }))
    .filter((entry) => entry.name && entry.appId)
  windowsApplicationCache = {
    expiresAt: Date.now() + APPLICATION_CACHE_TTL_MS,
    applications,
  }
  return applications
}

const defaultDeps: ApplicationLauncherDeps = {
  platform: process.platform,
  discoverApplications: () =>
    process.platform === 'win32' ? discoverWindowsApplications() : Promise.resolve([]),
  listWindows,
  activateWindow,
  openPath: (target) => shell.openPath(target),
  launchAumid: async (appId) => {
    const explorer = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe')
    await execFileAsync(explorer, [`shell:AppsFolder\\${appId}`])
  },
}

function isExplicitPath(value: string, platform: NodeJS.Platform): boolean {
  return path.isAbsolute(value) || (platform === 'win32' && /^[a-z]:[\\/]/i.test(value))
}

export async function launchApplication(
  appName: string,
  deps: ApplicationLauncherDeps = defaultDeps,
): Promise<ApplicationLaunchResult> {
  const query = appName.trim()
  if (!query) throw new Error('APPLICATION_NAME_REQUIRED: 请提供应用名称')

  if (isExplicitPath(query, deps.platform)) {
    if (!fs.existsSync(query)) throw new Error(`APPLICATION_PATH_NOT_FOUND: ${query}`)
    const error = await deps.openPath(query)
    if (error) throw new Error(`APPLICATION_LAUNCH_FAILED: ${error}`)
    return { success: true, application: query, mode: 'launched', targetType: 'path' }
  }

  const windows = await deps.listWindows().catch(() => [])
  const existing = windows.find((window) => {
    const target = normalize(query)
    return (
      normalize(window.title).includes(target) || normalize(window.processName).includes(target)
    )
  })
  if (existing) {
    const title = await deps.activateWindow(existing.title)
    return { success: true, application: title, mode: 'activated', targetType: 'window' }
  }

  if (deps.platform !== 'win32') {
    throw new Error('APPLICATION_DISCOVERY_UNSUPPORTED: 当前平台暂不支持按名称发现应用')
  }

  const matches = rankApplications(query, await deps.discoverApplications())
  if (matches.length === 0) throw new Error(`APPLICATION_NOT_FOUND: ${query}`)
  const first = matches[0]!
  const second = matches[1]
  const exact =
    normalize(first.name) === normalize(query) || normalize(first.appId) === normalize(query)
  if (!exact && second) {
    throw new Error(
      `APPLICATION_AMBIGUOUS: 找到多个候选：${matches
        .slice(0, 5)
        .map((item) => item.name)
        .join('、')}`,
    )
  }
  await deps.launchAumid(first.appId)
  return { success: true, application: first.name, mode: 'launched', targetType: 'aumid' }
}
