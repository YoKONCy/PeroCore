/**
 * 便携包运行依赖收集脚本
 *
 * daemon bundle（daemon.mjs / social-runtime.mjs）将第三方依赖 external，
 * 便携包内没有 node_modules，本脚本把这些包（含原生二进制）从 pnpm 虚拟
 * 存储中收集到 dist-daemon/node_modules/，随包携带，运行时由 Node 原生解析。
 *
 * 布局约定：
 *   便携包根/
 *     ├─ resources/daemon/daemon.mjs        （主 Daemon bundle）
 *     └─ resources/node_modules/            （本脚本产物，所有 external 依赖）
 *
 * 收集范围：packages/backend + packages/apps/social 的生产依赖（含可选依赖），
 * 基于 pnpm 的 symlink 定位真实目录后递归复制依赖树，避免硬编码版本 hash。
 *
 * @module scripts/collect-daemon-deps
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** 仓库根目录（脚本位于 <root>/scripts/） */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 输出目录：便携包 resources/node_modules 的内容来源 */
const OUT_NODE_MODULES = path.join(root, 'dist-daemon', 'node_modules')

/** 候选查找基目录（pnpm 会把 workspace 包依赖链接在包自身 node_modules 下） */
const LOOKUP_BASES = [
  path.join(root, 'packages', 'backend', 'node_modules'),
  path.join(root, 'packages', 'apps', 'social', 'node_modules'),
  path.join(root, 'node_modules'),
]

/** 需要收集依赖的入口包清单（仓库内固定路径） */
const ENTRY_MANIFESTS = [
  path.join(root, 'packages', 'backend', 'package.json'),
  path.join(root, 'packages', 'apps', 'social', 'package.json'),
]

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────

/** 在候选基目录中定位包的真实目录（解析 pnpm symlink，含嵌套基目录） */
function resolvePackageDir(pkgName) {
  const bases = [...LOOKUP_BASES, ...nestedBases]
  for (const base of bases) {
    const candidate = path.join(base, ...pkgName.split('/'))
    if (!fs.existsSync(candidate)) continue
    try {
      // realpath 解析 pnpm symlink → .pnpm/<pkg>@<ver>/node_modules/<pkg>
      return fs.realpathSync(candidate)
    } catch {
      return candidate
    }
  }
  return null
}

/** 记录某个包自己的 node_modules 目录（pnpm 嵌套依赖链接所在） */
const nestedBases = new Set()

/** 向上查找最近的 node_modules 祖先（pnpm 把依赖链接在包的父级 node_modules） */
function findNodeModulesAncestor(pkgDir) {
  let current = pkgDir
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
    if (path.basename(current) === 'node_modules') return current
  }
  return null
}

function registerNestedNodeModules(pkgDir) {
  const nested = findNodeModulesAncestor(pkgDir)
  if (nested && fs.existsSync(nested)) nestedBases.add(nested)
}

/**
 * 默认忽略 Rust/C++ 构建中间产物；node-pty 的 ConPTY 运行时 DLL/EXE 例外保留。
 * 不再全局丢弃所有 DLL/EXE，避免把原生模块实际运行所需的旁路文件删掉。
 */
const IGNORED_EXTENSIONS = new Set([
  '.rlib',
  '.rmeta',
  '.pdb',
  '.o',
  '.d',
  '.exp',
  '.lib',
  '.timestamp',
  '.cargo-lock',
  '.TAG',
  '.lock',
])

function shouldIgnoreRuntimeFile(sourcePath, packageName) {
  const extension = path.extname(sourcePath).toLowerCase()
  if (IGNORED_EXTENSIONS.has(extension)) return true
  if (extension !== '.dll' && extension !== '.exe') return false
  // node-pty 在 Windows/ConPTY 下必须携带 conpty.dll 和 OpenConsole.exe。
  return packageName !== 'node-pty'
}

/** 递归复制目录（跳过已存在的目标，避免重复覆盖） */
function copyDir(source, target, packageName) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name)
    const dstPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      // 跳过包内部的 node_modules（pnpm 嵌套链接，顶层已扁平收集）
      if (entry.name === 'node_modules') continue
      copyDir(srcPath, dstPath, packageName)
    } else if (entry.isSymbolicLink()) {
      // 保留符号链接语义 → 复制其真实目标
      const real = fs.realpathSync(srcPath)
      if (fs.statSync(real).isDirectory()) copyDir(real, dstPath)
      else {
        if (shouldIgnoreRuntimeFile(real, packageName)) continue
        fs.mkdirSync(path.dirname(dstPath), { recursive: true })
        fs.copyFileSync(real, dstPath)
      }
    } else {
      if (shouldIgnoreRuntimeFile(srcPath, packageName)) continue
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

/** 收集单个包及其依赖树到输出 node_modules */
function collectPackage(pkgName, visited, optional = false) {
  if (visited.has(pkgName)) return
  // ripgrep 仅提取当前平台二进制到 dist-daemon/bin，避免把平台包和重复二进制塞入 node_modules。
  if (pkgName === '@vscode/ripgrep' || pkgName.startsWith('@vscode/ripgrep-')) return

  const source = resolvePackageDir(pkgName)
  if (!source) {
    if (optional) {
      console.warn(`⚠️  未找到当前平台可选依赖: ${pkgName}（跳过）`)
      return
    }
    throw new Error(`未找到必需运行依赖: ${pkgName}`)
  }
  visited.add(pkgName)

  const target = path.join(OUT_NODE_MODULES, ...pkgName.split('/'))
  if (fs.existsSync(target)) return // 已收集

  copyDir(source, target, pkgName)
  // 该包自身的 node_modules 可能含嵌套依赖链接，加入候选基目录
  registerNestedNodeModules(source)
  console.log(`✅ 已收集: ${pkgName}`)

  // 必需依赖缺失时直接终止发行构建；仅允许平台不匹配的可选依赖跳过。
  const pkgJsonPath = path.join(source, 'package.json')
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
      for (const dep of Object.keys(pkgJson.dependencies ?? {})) {
        collectPackage(dep, visited)
      }
      for (const dep of Object.keys(pkgJson.optionalDependencies ?? {})) {
        collectPackage(dep, visited, true)
      }
    } catch (err) {
      throw new Error(`收集 ${pkgName} 依赖失败: ${err}`)
    }
  }
}

// ─────────────────────────────────────────────
// 收集
// ─────────────────────────────────────────────

/** 将清单依赖拆分为必需与可选入口；同名项按 npm 语义由 optionalDependencies 覆盖。 */
export function classifyManifestDependencies(pkgJson) {
  const optionalNames = new Set(Object.keys(pkgJson.optionalDependencies ?? {}))
  return [
    ...Object.keys(pkgJson.dependencies ?? {})
      .filter((name) => !optionalNames.has(name))
      .map((name) => ({ name, optional: false })),
    ...Array.from(optionalNames, (name) => ({ name, optional: true })),
  ]
}

function findFileRecursive(directory, predicate) {
  if (!fs.existsSync(directory)) return null
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findFileRecursive(absolute, predicate)
      if (nested) return nested
    } else if (predicate(absolute)) return absolute
  }
  return null
}

/** 将当前构建平台的 ripgrep 复制到稳定的发行资源路径。 */
function collectBundledRipgrep() {
  const packageDir = resolvePackageDir('@vscode/ripgrep')
  if (!packageDir) throw new Error('未安装 @vscode/ripgrep，无法生成自包含发行版')
  registerNestedNodeModules(packageDir)
  let rgPath = null
  try {
    const entry = require.resolve('@vscode/ripgrep', { paths: LOOKUP_BASES })
    const module = require(entry)
    rgPath = module.rgPath
  } catch {
    // 部分 pnpm 布局无法从根 require，下面继续扫描当前平台包。
  }
  if (!rgPath || !fs.existsSync(rgPath)) {
    const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'
    rgPath = findFileRecursive(packageDir, (candidate) => path.basename(candidate) === executable)
    if (!rgPath) {
      const platformPackage = resolvePackageDir(
        `@vscode/ripgrep-${process.platform}-${process.arch}`,
      )
      rgPath = platformPackage
        ? findFileRecursive(platformPackage, (candidate) => path.basename(candidate) === executable)
        : null
    }
  }
  if (!rgPath || !fs.existsSync(rgPath)) {
    throw new Error(`未找到当前平台 ripgrep 二进制: ${process.platform}-${process.arch}`)
  }
  const targetDir = path.join(root, 'dist-daemon', 'bin', `${process.platform}-${process.arch}`)
  fs.mkdirSync(targetDir, { recursive: true })
  const target = path.join(targetDir, process.platform === 'win32' ? 'rg.exe' : 'rg')
  fs.copyFileSync(rgPath, target)
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755)
  console.log(`✅ 已收集内置 ripgrep: ${target}`)
}

/** 对关键原生运行文件做强校验，避免发行包静默降级。 */
function validateNativeRuntime() {
  const ptyDir = path.join(OUT_NODE_MODULES, 'node-pty')
  if (!fs.existsSync(ptyDir)) throw new Error('发行依赖缺少 node-pty')
  if (!findFileRecursive(ptyDir, (file) => path.extname(file).toLowerCase() === '.node')) {
    throw new Error('node-pty 缺少原生 .node 模块')
  }
  if (process.platform === 'win32') {
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      if (
        !findFileRecursive(
          ptyDir,
          (file) => path.basename(file).toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error(`node-pty 缺少 Windows ConPTY 运行文件: ${name}`)
      }
    }
  }
}

function main() {
  // 清空旧产物，避免残留
  if (fs.existsSync(OUT_NODE_MODULES)) {
    fs.rmSync(OUT_NODE_MODULES, { recursive: true, force: true })
  }
  fs.mkdirSync(OUT_NODE_MODULES, { recursive: true })

  const visited = new Set()
  for (const manifestPath of ENTRY_MANIFESTS) {
    const pkgJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    for (const dependency of classifyManifestDependencies(pkgJson)) {
      collectPackage(dependency.name, visited, dependency.optional)
    }
  }

  collectBundledRipgrep()
  validateNativeRuntime()

  const count = fs
    .readdirSync(OUT_NODE_MODULES, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length
  const sizeMB = (fs.statSync(OUT_NODE_MODULES).size / 1024 / 1024).toFixed(2)
  console.log(`\n🎉 运行依赖收集完成: ${count} 个文件, ${sizeMB} MB → ${OUT_NODE_MODULES}`)
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false
if (isDirectExecution) main()
