import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { repairNapCatRuntimeSource } from './napcatRuntimeRepair'
import { repairNapCatWebUiSource } from './napcatWebUiRepair'

export const NAPCAT_INSTALLATION_MARKER = '.infos-installing'

const userDirectories = new Set(['config', 'plugins', 'logs', 'temp', 'data', 'cache'])
const userFiles = new Set(['qqnt.json', '.infos-quick-login-account'])

/** 根目录 config.json 属于 QQ 程序版本信息，必须随发行文件更新。 */
export function isNapCatUserFile(relative: string): boolean {
  const parts = relative.replace(/\\/g, '/').toLowerCase().split('/')
  const pluginIndex =
    parts[0] === 'plugins' ? 0 : parts[0] === 'napcat' && parts[1] === 'plugins' ? 1 : -1
  if (pluginIndex >= 0) {
    // 进入插件目录后仅替换官方内置程序，第三方插件与 config/plugins 下的设置仍受保护。
    return parts.length > pluginIndex + 1 && parts[pluginIndex + 1] !== 'builtin'
  }
  return (
    userDirectories.has(parts[0]!) ||
    (parts[0] === 'napcat' && userDirectories.has(parts[1]!)) ||
    (parts.length === 1 && userFiles.has(parts[0]!))
  )
}

/** 旧内置插件使用多参数回调，不能被新版 ctx/event 接口调用。 */
export function getNapCatBuiltinProblem(directory: string): string | null {
  const file = path.join(directory, 'napcat', 'plugins', 'builtin', 'index.mjs')
  if (!fs.existsSync(file)) return null
  try {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(
      /\bplugin_(init|onmessage)\s*=\s*(?:async\s*)?\(([^)]*)\)/g,
    )) {
      const parameters = match[2]!.split(',').filter((parameter) => parameter.trim())
      if (parameters.length > (match[1] === 'init' ? 1 : 2))
        return 'NapCat 内置插件仍使用旧事件接口，请执行更新修复'
    }
    return null
  } catch {
    return 'NapCat 内置插件无法读取，请执行更新修复'
  }
}

function readObject(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('文件内容必须是对象')
  return value as Record<string, unknown>
}

/** 发行包的 package.json 来自经过 SHA256 校验的 QQ 程序文件。 */
export function readNapCatQQVersion(directory: string): { version: string; build: string } {
  let info: Record<string, unknown>
  try {
    info = readObject(path.join(directory, 'package.json'))
  } catch {
    throw new Error('NapCat 的 QQ 版本清单无法读取，请重新安装 NapCat')
  }
  const match = typeof info.version === 'string' && info.version.match(/^\d+\.\d+\.\d+-(\d+)$/)
  if (!match || String(info.buildVersion) !== match[1])
    throw new Error('NapCat 的 QQ 版本清单不一致，请重新安装 NapCat')
  return { version: info.version as string, build: match[1]! }
}

/** 先校验完整程序再修正旧版遗留元数据；这里不读写账号、设备或登录凭据。 */
export function prepareNapCatNodeInstallation(directory: string): {
  version: string
  repaired: boolean
  runtimeRepaired: boolean
  runtimeRepairWarning?: string
  command: string
  entry: string
} {
  const entry = fs.existsSync(path.join(directory, 'index.js')) ? 'index.js' : 'napcat.mjs'
  const core = entry === 'index.js' ? path.join('napcat', 'napcat.mjs') : 'napcat.mjs'
  const root = fs.realpathSync(directory) + path.sep
  for (const name of ['node.exe', 'wrapper.node', 'QQNT.dll', 'package.json', entry, core]) {
    const file = path.join(directory, name)
    // 避免损坏安装或目录链接把发行文件指向安装范围之外。
    if (
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile() ||
      fs.statSync(file).size === 0 ||
      !fs.realpathSync(file).startsWith(root)
    )
      throw new Error(`NapCat 程序文件缺失或无效：${name}，请重新安装 NapCat`)
  }
  const { version, build } = readNapCatQQVersion(directory)
  const pluginProblem = getNapCatBuiltinProblem(directory)
  if (pluginProblem) throw new Error(pluginProblem)
  const coreFile = path.join(directory, core)
  const originalCore = fs.readFileSync(coreFile, 'utf8')
  let repairedCore = originalCore
  const repairWarnings: string[] = []
  for (const repair of [repairNapCatRuntimeSource, repairNapCatWebUiSource]) {
    try {
      repairedCore = repair(repairedCore)
    } catch (error) {
      // 附加修复独立处理；未识别的部分不修改，也不阻止其他修复和有效程序启动。
      repairWarnings.push(
        `未应用 NapCat 附加修复，保留对应原代码：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const runtimeRepairWarning = repairWarnings.length ? repairWarnings.join('；') : undefined
  const runtimeRepaired = repairedCore !== originalCore
  if (runtimeRepaired) {
    const temporary = path.join(directory, `.infos-napcat-runtime-${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, repairedCore, { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(temporary, coreFile)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  const configFile = path.join(directory, 'config.json')
  let config: Record<string, unknown> = {}
  try {
    config = readObject(configFile)
  } catch {
    // 缺失或损坏的版本元数据可以从同包 QQ 清单重建，不需要清除登录数据。
  }
  const repaired =
    config.baseVersion !== version || config.curVersion !== version || config.buildId !== build
  if (repaired) {
    const next = {
      ...config,
      baseVersion: version,
      curVersion: version,
      prevVersion: '',
      onErrorVersions: [],
      buildId: build,
      unzipRetryCount: 0,
    }
    const temporary = path.join(directory, `.infos-qq-version-${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(temporary, configFile)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  return {
    version,
    repaired,
    runtimeRepaired,
    runtimeRepairWarning,
    command: path.join(directory, 'node.exe'),
    entry,
  }
}

/** Node 发行包优先，防止旧安装残留的 Shell.exe 或 bat 抢占入口。 */
export function hasNapCatNodeInstallation(directory: string): boolean {
  return (
    fs.existsSync(path.join(directory, 'index.js')) ||
    fs.existsSync(path.join(directory, 'napcat.mjs'))
  )
}

/** 复制前同时检查源、目标路径，防止遗留目录链接导致写到安装范围之外。 */
export function copyNapCatProgramFiles(source: string, destination: string): void {
  const sourceRoot = fs.realpathSync(source) + path.sep
  const destinationRoot = fs.realpathSync(destination) + path.sep
  const copy = (directory: string, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name)
      if (isNapCatUserFile(name)) continue
      const original = path.join(source, name)
      const target = path.join(destination, name)
      if (entry.isSymbolicLink() || !fs.realpathSync(original).startsWith(sourceRoot))
        throw new Error('NapCat 安装包包含目录链接')
      if (fs.existsSync(target) && !fs.realpathSync(target).startsWith(destinationRoot))
        throw new Error('NapCat 安装目录包含越界链接，请检查安装目录')
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true })
        copy(original, name)
      } else if (entry.isFile()) {
        fs.copyFileSync(original, target)
      }
    }
  }
  copy(source)
}
