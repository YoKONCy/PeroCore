const fs = require('node:fs/promises')
const path = require('node:path')

async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

exports.default = async function afterPack(context) {
  if (process.env.PEROCORE_EDITION === 'steam') return

  const appOutDir = context.appOutDir
  const resourcesDir = path.join(appOutDir, 'resources')

  await Promise.all([
    removePath(path.join(appOutDir, 'steam_api64.dll')),
    removePath(path.join(appOutDir, 'steam_appid.txt')),
    removePath(path.join(resourcesDir, 'steam')),
    removePath(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'steamworks.js')),
  ])
}
