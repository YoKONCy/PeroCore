/**
 * 版本号同步脚本 (TypeScript)
 *
 * 唯一事实来源: 根 package.json 的 version 字段。
 * 本脚本将该版本号同步到所有子包 package.json、Cargo.toml、
 * 以及前后端源码中的硬编码版本号。
 *
 * 用法: pnpm version:sync
 * 执行: tsx scripts/sync-version.ts
 *
 * @module scripts/sync-version
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── 项目根目录 ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// ─── 唯一的版本事实来源: 根 package.json ──────────────────
const rootPkgPath = path.join(ROOT, 'package.json')
if (!fs.existsSync(rootPkgPath)) {
  console.error('[版本同步] ❌ 根 package.json 不存在！预期路径:', rootPkgPath)
  process.exit(1)
}

interface PackageJson {
  version: string
  [key: string]: unknown
}

const rootPkg: PackageJson = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))
const VERSION = rootPkg.version
const CARGO_VERSION = toCargoVersion(VERSION)
const BROWSER_VERSION = toBrowserVersion(VERSION)

console.log(`\n[版本同步] 🎯 唯一事实来源 → package.json: ${VERSION}`)
console.log('═'.repeat(55))

let updatedCount = 0
let checkedCount = 0

// ─── 工具函数 ──────────────────────────────────────────

function toCargoVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`[版本同步] 非法 SemVer 版本号: ${version}`)
  }
  return version
}

/** Chrome 扩展 version 仅允许 1-4 段数字；预发布序号映射到第四段。 */
function toBrowserVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z]+(\d+))?$/)
  if (!match) throw new Error(`[版本同步] 无法转换为浏览器扩展版本: ${version}`)
  const [, major, minor, patch, prerelease] = match
  return prerelease ? `${major}.${minor}.${patch}.${prerelease}` : `${major}.${minor}.${patch}`
}

/** 同步浏览器扩展清单：version 为 Chrome 数字格式，version_name 保留完整 SemVer。 */
function syncBrowserManifest(relPath: string): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) throw new Error(`[版本同步] 必需文件不存在: ${relPath}`)
  checkedCount++
  const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>
  if (typeof manifest.version !== 'string' || typeof manifest.version_name !== 'string') {
    throw new Error(`[版本同步] ${relPath} 缺少 version 或 version_name`)
  }
  if (manifest.version !== BROWSER_VERSION || manifest.version_name !== VERSION) {
    manifest.version = BROWSER_VERSION
    manifest.version_name = VERSION
    fs.writeFileSync(fullPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`[版本同步] ✅ ${relPath}: ${BROWSER_VERSION} / ${VERSION}`)
    updatedCount++
  }
}

/** 同步 JSON 文件中的 version 字段。仅本地私有嵌套仓库允许缺失。 */
function syncJsonVersion(relPath: string, required = true): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    if (required) throw new Error(`[版本同步] 必需文件不存在: ${relPath}`)
    console.log(`[版本同步] ⏭️  ${relPath} 本地私有嵌套仓库未检出，跳过`)
    return
  }
  checkedCount++
  const pkg: PackageJson = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  if (typeof pkg.version !== 'string' || !pkg.version) {
    throw new Error(`[版本同步] ${relPath} 缺少有效 version 字段`)
  }
  if (pkg.version !== VERSION) {
    const oldVersion = pkg.version
    pkg.version = VERSION
    fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`[版本同步] ✅ ${relPath}: ${oldVersion} → ${VERSION}`)
    updatedCount++
  }
}

/** 同步 Cargo.toml 中的 version 字段。仅本地私有嵌套仓库允许缺失。 */
function syncCargoVersion(relPath: string, required = true): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    if (required) throw new Error(`[版本同步] 必需文件不存在: ${relPath}`)
    console.log(`[版本同步] ⏭️  ${relPath} 本地私有嵌套仓库未检出，跳过`)
    return
  }
  checkedCount++
  const content = fs.readFileSync(fullPath, 'utf8')
  if (!/^version\s*=\s*".*"/m.test(content)) {
    throw new Error(`[版本同步] ${relPath} 未找到 package.version`)
  }
  const replaced = content.replace(/^version\s*=\s*".*"/m, `version = "${CARGO_VERSION}"`)
  if (content !== replaced) {
    fs.writeFileSync(fullPath, replaced)
    console.log(`[版本同步] ✅ ${relPath} → ${CARGO_VERSION}`)
    updatedCount++
  }
}

/** 同步 Cargo.lock 中指定本地 crate 的版本，避免误改第三方依赖。 */
function syncCargoLockVersion(relPath: string, crateName: string, required = true): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    if (required) throw new Error(`[版本同步] 必需文件不存在: ${relPath}`)
    console.log(`[版本同步] ⏭️  ${relPath} 本地私有嵌套仓库未检出，跳过`)
    return
  }
  checkedCount++
  const content = fs.readFileSync(fullPath, 'utf8')
  const pattern = new RegExp(`(name = "${crateName}"\\r?\\nversion = ")[^"]+(")`)
  if (!pattern.test(content)) {
    throw new Error(`[版本同步] ${relPath} 未找到本地 crate: ${crateName}`)
  }
  const replaced = content.replace(pattern, `$1${CARGO_VERSION}$2`)
  if (content !== replaced) {
    fs.writeFileSync(fullPath, replaced)
    console.log(`[版本同步] ✅ ${relPath} ${crateName} → ${CARGO_VERSION}`)
    updatedCount++
  }
}

/**
 * 同步 TypeScript 源码中的硬编码版本号
 * @param relPath - 相对于项目根的文件路径
 * @param pattern - 待替换的正则表达式
 * @param replacement - 替换内容（使用 VERSION 变量）
 * @param label - 日志标签
 */
function syncSourceVersion(
  relPath: string,
  pattern: RegExp,
  replacement: string,
  label: string,
  required = true,
): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`[版本同步] 必需文件不存在: ${relPath}`)
  }
  checkedCount++
  const content = fs.readFileSync(fullPath, 'utf8')
  if (!pattern.test(content)) {
    if (required) throw new Error(`[版本同步] ${relPath} 未匹配到 ${label}`)
    console.log(`[版本同步] ⏭️  ${relPath} 当前无 ${label}，跳过可选同步`)
    return
  }
  pattern.lastIndex = 0
  const replaced = content.replace(pattern, replacement)
  if (content !== replaced) {
    fs.writeFileSync(fullPath, replaced)
    console.log(`[版本同步] ✅ ${relPath} ${label} → ${VERSION}`)
    updatedCount++
  }
}

// ═══════════════════════════════════════════════════════
// 1. 同步所有子包 package.json
// ═══════════════════════════════════════════════════════
console.log('\n── 📦 子包 package.json ──')

const subPackagePaths = [
  'packages/shared/package.json',
  'packages/backend/package.json',
  'packages/frontend/package.json',
  'packages/daemon/package.json',
  'packages/browser-extension/package.json',
  'packages/apps/social/package.json',
  'packages/wiki/package.json',
  'packages/native/render-core-runtime/package.json',
  'packages/native/nit-runtime/package.json',
  'packages/native/auditor-wasm/package.json',
  'electron/package.json',
]

for (const relPath of subPackagePaths) {
  syncJsonVersion(relPath)
}
// render-core 是本机私有嵌套仓库：本地存在时严格同步，CI 未检出时允许跳过。
syncJsonVersion('packages/native/render-core/package.json', false)

console.log('\n── 🧩 应用与扩展清单 ──')
syncJsonVersion('packages/apps/social/app.manifest.json')
syncBrowserManifest('packages/browser-extension/manifest.json')

// ═══════════════════════════════════════════════════════
// 2. 同步 Cargo.toml (Rust 原生模块)
// ═══════════════════════════════════════════════════════
console.log('\n── 🦀 Cargo.toml ──')

const cargoTomlPaths = [
  'packages/native/nit-runtime/Cargo.toml',
  'packages/native/auditor-wasm/Cargo.toml',
]

for (const relPath of cargoTomlPaths) {
  syncCargoVersion(relPath)
}
// render-core 是本机私有嵌套仓库：本地存在时严格同步，CI 未检出时允许跳过。
syncCargoVersion('packages/native/render-core/Cargo.toml', false)

syncCargoLockVersion('packages/native/render-core/Cargo.lock', 'pero-render-core', false)
syncCargoLockVersion('packages/native/nit-runtime/Cargo.lock', 'nit-runtime')
syncCargoLockVersion('packages/native/auditor-wasm/Cargo.lock', 'infos-auditor-wasm')

// ═══════════════════════════════════════════════════════
// 3. 同步后端源码中的硬编码版本号
// ═══════════════════════════════════════════════════════
console.log('\n── 🖥️  后端源码 ──')

// 3a. system.router.ts — APP_VERSION 常量
syncSourceVersion(
  'packages/backend/src/routers/system.router.ts',
  /const APP_VERSION\s*=\s*'[^']*'/,
  `const APP_VERSION = '${VERSION}'`,
  'APP_VERSION',
)

// 3b. health.router.ts — 健康检查端点的 version 字段
syncSourceVersion(
  'packages/backend/src/routers/health.router.ts',
  /version:\s*'[^']*'/,
  `version: '${VERSION}'`,
  'health.version',
)

// 3c. mcpClientManager.ts — MCP 客户端版本标识
syncSourceVersion(
  'packages/backend/src/services/mcp/mcpClientManager.ts',
  /\{\s*name:\s*`infos-\$\{name\}`,\s*version:\s*'[^']*'\s*\}/,
  `{ name: \`infos-\${name}\`, version: '${VERSION}' }`,
  'MCP client version',
)

// ═══════════════════════════════════════════════════════
// 4. 同步 docker-compose.yml 镜像标签 (如果存在 image 字段)
// ═══════════════════════════════════════════════════════
console.log('\n── 🐳 Docker ──')

syncSourceVersion(
  'docker-compose.yml',
  /image:\s*infos-backend:[\w.-]+/g,
  `image: infos-backend:${VERSION}`,
  'image tag',
  false,
)

// ═══════════════════════════════════════════════════════
// 结果汇报
// ═══════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55))
if (updatedCount === 0) {
  console.log(`[版本同步] ✨ 全部 ${checkedCount} 个检查点已是最新 (${VERSION})，无需更新`)
} else {
  console.log(`[版本同步] 🎉 检查 ${checkedCount} 个点，已同步 ${updatedCount} 个文件到 ${VERSION}`)
}
console.log()
