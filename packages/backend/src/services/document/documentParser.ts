import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)

export interface ParsedOfficeDocument {
  markdown: string
  assets: Array<{ id: number; mediaType: string; data: Buffer }>
}

/** 原生转换隔离在 Worker 中；取消或超时会终止整个解析任务，而非只丢弃结果。 */
export async function parseOfficeDocument(
  bytes: Buffer,
  name: string,
  signal: AbortSignal,
): Promise<ParsedOfficeDocument> {
  signal.throwIfAborted()
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const parser = require(workerData.entry);
      const bytes = Buffer.from(workerData.bytes);
      const format = parser.formatFromBytes(bytes) || parser.formatFromPath(workerData.name);
      if (!format) throw Object.assign(new Error('文档格式不受支持'), { code: 'unsupported' });
      const markdown = await parser.toMarkdownBytes(bytes, format, { ocr: 'reject' });
      const assets = format === 'pdf' ? [] : (await parser.toDocument(bytes, format)).assets;
      if (markdown.length > 2000000 || assets.reduce((total, asset) => total + asset.data.length, 0) > 20 * 1024 * 1024)
        throw Object.assign(new Error('解析内容超过限制，请拆分文档'), { code: 'resourceLimit' });
      parentPort.postMessage({ markdown, assets });
    })().catch(error => parentPort.postMessage({ error: { code: error.code, message: '文档解析失败' } }));
  `,
    {
      eval: true,
      workerData: { entry: require.resolve('@firecrawl/anydoc'), bytes, name },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    },
  )
  try {
    return await new Promise<ParsedOfficeDocument>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error('文档解析已取消'))
      const cleanup = () => signal.removeEventListener('abort', abort)
      signal.addEventListener('abort', abort, { once: true })
      worker.once(
        'message',
        (message: ParsedOfficeDocument & { error?: { code?: string; message: string } }) => {
          cleanup()
          if (message.error)
            reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
          else
            resolve({
              markdown: message.markdown,
              assets: message.assets.map((asset) => ({ ...asset, data: Buffer.from(asset.data) })),
            })
        },
      )
      worker.once('error', (error) => {
        cleanup()
        reject(error)
      })
      worker.once('exit', () => {
        cleanup()
        reject(new Error('文档解析进程已退出'))
      })
      if (signal.aborted) abort()
    })
  } finally {
    await worker.terminate()
  }
}
