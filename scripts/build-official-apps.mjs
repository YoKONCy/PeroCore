/**
 * 官方应用发行资源构建脚本
 *
 * 将Arca Host打包为独立Node入口，将Arca Client静态资源收集到稳定目录，
 * 并生成带SHA-256的应用清单。Electron Builder只消费该目录，不读取源码树。
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(root, 'dist-applications')
const arcaOutput = path.join(outputRoot, 'arca')
const arcaUiOutput = path.join(arcaOutput, 'ui')
const arcaRoot = path.join(root, 'packages', 'apps', 'arca')
const arcaClientDist = path.join(arcaRoot, 'client', 'dist')
const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function resolveEsbuildEntry() {
  const pnpmDir = path.join(root, 'node_modules', '.pnpm')
  const candidates = fs
    .readdirSync(pnpmDir)
    .filter((name) => /^esbuild@/.test(name))
    .sort()
  const latest = candidates[candidates.length - 1]
  if (!latest) throw new Error('未找到esbuild，请先执行pnpm install')
  return path.join(pnpmDir, latest, 'node_modules', 'esbuild', 'lib', 'main.js')
}

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) throw new Error(`发行资源不存在: ${source}`)
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath)
    else fs.copyFileSync(sourcePath, targetPath)
  }
}

function listFiles(directory, base = directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(absolute, base))
    else files.push(path.relative(base, absolute).replaceAll(path.sep, '/'))
  }
  return files.sort()
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

if (fs.existsSync(outputRoot)) fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(arcaOutput, { recursive: true })

const esbuild = require(resolveEsbuildEntry())
const hostBuild = await esbuild.build({
  entryPoints: [path.join(arcaRoot, 'src', 'main.ts')],
  outfile: path.join(arcaOutput, 'host.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  tsconfig: path.join(arcaRoot, 'tsconfig.host.json'),
  packages: 'external',
  absWorkingDir: root,
  logLevel: 'info',
  metafile: true,
  external: ['better-sqlite3'],
})
const externalDependencies = Array.from(
  new Set(
    Object.values(hostBuild.metafile.outputs)
      .flatMap((output) => output.imports)
      .filter((entry) => entry.external && !entry.path.startsWith('node:'))
      .map((entry) =>
        entry.path.startsWith('@')
          ? entry.path.split('/').slice(0, 2).join('/')
          : entry.path.split('/')[0],
      ),
  ),
).sort()
const allowedExternalDependencies = ['better-sqlite3', 'tiktoken', 'ws']
const undeclaredExternal = externalDependencies.filter(
  (dependency) => !allowedExternalDependencies.includes(dependency),
)
if (undeclaredExternal.length > 0) {
  throw new Error(`Arca Host包含未声明的发行依赖: ${undeclaredExternal.join(', ')}`)
}

execFileSync('pnpm', ['--filter', '@infos/arca', 'build:client'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
copyDirectory(arcaClientDist, arcaUiOutput)

const runtimeFiles = listFiles(arcaOutput)
const manifest = {
  schemaVersion: 1,
  applicationId: 'infos.arca',
  displayName: 'Arca',
  version: rootManifest.version,
  trust: 'official',
  runtime: {
    host: 'host.mjs',
    ui: 'ui/index.html',
    externalDependencies,
  },
  files: Object.fromEntries(
    runtimeFiles.map((file) => [
      file,
      {
        size: fs.statSync(path.join(arcaOutput, file)).size,
        sha256: sha256(path.join(arcaOutput, file)),
      },
    ]),
  ),
}
fs.writeFileSync(path.join(arcaOutput, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

if (!fs.existsSync(path.join(arcaUiOutput, 'index.html'))) throw new Error('Arca UI缺少index.html')
if (!fs.existsSync(path.join(arcaOutput, 'host.mjs'))) throw new Error('Arca Host构建失败')
console.log(`\n官方应用发行资源已生成: ${arcaOutput}`)
console.log(`Arca文件数量: ${runtimeFiles.length + 1}`)
