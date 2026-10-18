import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** 两种前端入口共用离线 PDF 字体、CMap 和解码资源；仅随用户启动或构建提供。 */
export function pdfAssetsPlugin(frontendRoot: string): Plugin {
  const root = resolve(frontendRoot, 'node_modules/pdfjs-dist')
  const directories = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'infos-pdf-assets',
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0] ?? ''
        if (!/^\/(cmaps|standard_fonts|wasm|iccs)\/[\w.-]+$/.test(pathname)) return next()
        const file = resolve(root, `.${pathname}`)
        response.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        )
        const stream = createReadStream(file)
        stream.on('error', () => {
          response.statusCode = 404
          response.end()
        })
        stream.pipe(response)
      })
    },
    generateBundle() {
      for (const directory of directories) {
        for (const name of readdirSync(resolve(root, directory))) {
          if (!/\.(?:bcmap|ttf|pfb|wasm|icc)$|^LICENSE/.test(name)) continue
          this.emitFile({
            type: 'asset',
            fileName: `pdf-assets/${directory}/${name}`,
            source: readFileSync(resolve(root, directory, name)),
          })
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'pdf-assets/LICENSE',
        source: readFileSync(resolve(root, 'LICENSE')),
      })
    },
  }
}
