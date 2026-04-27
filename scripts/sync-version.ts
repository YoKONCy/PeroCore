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

console.log(`\n[版本同步] 🎯 唯一事实来源 → package.json: ${VERSION}`)
console.log('═'.repeat(55))

let updatedCount = 0
let checkedCount = 0

// ─── 工具函数 ──────────────────────────────────────────

function toCargoVersion(version: string): string {
  const prereleaseMatch = version.match(/^(\d+)\.(\d+)-(.+)$/)
  if (prereleaseMatch) {
    const [, major, minor, prerelease] = prereleaseMatch
    return `${major}.${minor}.0-${prerelease}`
  }

  return version
}

/** 同步 JSON 文件中的 version 字段 */
function syncJsonVersion(relPath: string): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    console.log(`[版本同步] ⏭️  ${relPath} (文件不存在，跳过)`)
    return
  }
  checkedCount++
  const pkg: PackageJson = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  if (pkg.version !== VERSION) {
    const oldVersion = pkg.version
    pkg.version = VERSION
    fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`[版本同步] ✅ ${relPath}: ${oldVersion} → ${VERSION}`)
    updatedCount++
  }
}

/** 同步 Cargo.toml 中的 version 字段 */
function syncCargoVersion(relPath: string): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    console.log(`[版本同步] ⏭️  ${relPath} (文件不存在，跳过)`)
    return
  }
  checkedCount++
  const content = fs.readFileSync(fullPath, 'utf8')
  const replaced = content.replace(/^version\s*=\s*".*"/m, `version = "${CARGO_VERSION}"`)
  if (content !== replaced) {
    fs.writeFileSync(fullPath, replaced)
    console.log(`[版本同步] ✅ ${relPath} → ${CARGO_VERSION}`)
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
): void {
  const fullPath = path.join(ROOT, relPath)
  if (!fs.existsSync(fullPath)) {
    console.log(`[版本同步] ⏭️  ${relPath} (文件不存在，跳过)`)
    return
  }
  checkedCount++
  const content = fs.readFileSync(fullPath, 'utf8')
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
  'packages/wiki/package.json',
  'packages/native/render-core-runtime/package.json',
  'packages/native/render-core/package.json',
  'packages/native/nit-runtime/package.json',
  'packages/native/auditor-wasm/package.json',
  'electron/package.json',
]

for (const relPath of subPackagePaths) {
  syncJsonVersion(relPath)
}

// ═══════════════════════════════════════════════════════
// 2. 同步 Cargo.toml (Rust 原生模块)
// ═══════════════════════════════════════════════════════
console.log('\n── 🦀 Cargo.toml ──')

const cargoTomlPaths = [
  'packages/native/render-core/Cargo.toml',
  'packages/native/nit-runtime/Cargo.toml',
]

for (const relPath of cargoTomlPaths) {
  syncCargoVersion(relPath)
}

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
  /\{\s*name:\s*`perocore-\$\{name\}`,\s*version:\s*'[^']*'\s*\}/,
  `{ name: \`perocore-\${name}\`, version: '${VERSION}' }`,
  'MCP client version',
)

// ═══════════════════════════════════════════════════════
// 4. 同步 docker-compose.yml 镜像标签 (如果存在 image 字段)
// ═══════════════════════════════════════════════════════
console.log('\n── 🐳 Docker ──')

syncSourceVersion(
  'docker-compose.yml',
  /image:\s*perocore-backend:[\w.-]+/g,
  `image: perocore-backend:${VERSION}`,
  'image tag',
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
