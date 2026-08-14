const fs = require('node:fs/promises')
const path = require('node:path')

async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

async function assertFile(targetPath, label) {
  try {
    await fs.access(targetPath)
  } catch {
    throw new Error(`发行产物缺少 ${label}: ${targetPath}`)
  }
}

async function findFile(directory, predicate) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(absolute, predicate)
      if (nested) return nested
    } else if (predicate(absolute)) return absolute
  }
  return null
}

async function validatePortableRuntime(resourcesDir) {
  const platformArch = `${process.platform}-${process.arch}`
  const rgPath = path.join(resourcesDir, 'bin', platformArch, process.platform === 'win32' ? 'rg.exe' : 'rg')
  await assertFile(rgPath, '内置 ripgrep')

  const ptyDir = path.join(resourcesDir, 'node_modules', 'node-pty')
  const native = await findFile(ptyDir, (file) => path.extname(file).toLowerCase() === '.node')
  if (!native) throw new Error(`发行产物 node-pty 缺少原生 .node: ${ptyDir}`)
  if (process.platform === 'win32') {
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      const found = await findFile(ptyDir, (file) => path.basename(file).toLowerCase() === name.toLowerCase())
      if (!found) throw new Error(`发行产物 node-pty 缺少 ${name}: ${ptyDir}`)
    }
  }
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const resourcesDir = path.join(appOutDir, 'resources')

  // 仅 portable 构建在 exe 同级生成标记；标准版与 Steam 版不生成。
  if (process.env.INFOS_EDITION === 'portable') {
    await fs.writeFile(path.join(appOutDir, '.portable'), '')
    await validatePortableRuntime(resourcesDir)
  } else {
    await removePath(path.join(appOutDir, '.portable'))
    // 非便携版：内置 Daemon 自包含运行时无用（Daemon 独立部署），裁剪避免体积膨胀
    await Promise.all([
      removePath(path.join(resourcesDir, 'daemon')),
      removePath(path.join(resourcesDir, 'node_modules')),
      removePath(path.join(resourcesDir, 'bin')),
      removePath(path.join(resourcesDir, 'backend', 'apps', 'social')),
      removePath(path.join(resourcesDir, 'backend', 'backend', 'src', 'database', 'migrations')),
    ])
  }

  if (process.env.INFOS_EDITION === 'steam') return

  await Promise.all([
    removePath(path.join(appOutDir, 'steam_api64.dll')),
    removePath(path.join(appOutDir, 'steam_appid.txt')),
    removePath(path.join(resourcesDir, 'steam')),
    removePath(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'steamworks.js')),
  ])
}
