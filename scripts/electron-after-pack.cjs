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
  const rgPath = path.join(
    resourcesDir,
    'bin',
    platformArch,
    process.platform === 'win32' ? 'rg.exe' : 'rg',
  )
  await assertFile(rgPath, '内置 ripgrep')

  const ptyDir = path.join(resourcesDir, 'node_modules', 'node-pty')
  const native = await findFile(
    ptyDir,
    (file) => path.extname(file).toLowerCase() === '.node',
  )
  if (!native) throw new Error(`发行产物 node-pty 缺少原生 .node: ${ptyDir}`)

  const sqliteDir = path.join(resourcesDir, 'node_modules', 'better-sqlite3')
  const sqliteNative = await findFile(
    sqliteDir,
    (file) => path.basename(file).toLowerCase() === 'better_sqlite3.node',
  )
  if (!sqliteNative) throw new Error(`发行产物 better-sqlite3 缺少原生模块: ${sqliteDir}`)

  if (process.platform === 'win32') {
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      const found = await findFile(
        ptyDir,
        (file) => path.basename(file).toLowerCase() === name.toLowerCase(),
      )
      if (!found) throw new Error(`发行产物 node-pty 缺少 ${name}: ${ptyDir}`)
    }
  }
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const resourcesDir = path.join(appOutDir, 'resources')

  // 所有桌面发行版都携带内置 Daemon；仅便携版在 exe 同级生成便携标记。
  if (process.env.INFOS_EDITION === 'portable') {
    await fs.writeFile(path.join(appOutDir, '.portable'), '')
  } else {
    await removePath(path.join(appOutDir, '.portable'))
  }

  // 标准版、Steam 版和便携版都必须具备完整的自包含运行时。
  await validatePortableRuntime(resourcesDir)

  if (process.env.INFOS_EDITION === 'steam') return

  await Promise.all([
    removePath(path.join(appOutDir, 'steam_api64.dll')),
    removePath(path.join(appOutDir, 'steam_appid.txt')),
    removePath(path.join(resourcesDir, 'steam')),
    removePath(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'steamworks.js')),
  ])
}
