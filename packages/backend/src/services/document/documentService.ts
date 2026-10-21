import path from 'node:path'
import { access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  DOCUMENT_MAX_INPUT_BYTES,
  DOCUMENT_MAX_OUTPUT_BYTES,
  type DocumentPdfRequest,
} from '@infos/shared'
import type { ToolContext } from '../agent/toolRegistry'
import type { ResourceService } from '../attachment/resourceService'
import type { WorkspaceCheckpointService } from '../workspace/workspaceCheckpointService'
import type { DocumentPdfCapabilityRuntime } from '../../capabilities/documentPdfCapabilityRuntime'
import {
  getProductivityRuntime,
  resolveExecutionSession,
} from '../../tools/productivityRuntimeHolder'
import { documentInputSchema, workbookSchema, type WorkbookInput } from './documentSchema'
import {
  documentBlocks,
  markdownWorkbook,
  renderDocx,
  renderDocumentHtml,
  renderPdf,
  renderWorkbook,
  type DocumentImage,
  type RenderContext,
} from './documentRenderers'
import { parseOfficeDocument } from './documentParser'

type Anydoc = typeof import('@firecrawl/anydoc')
interface ParsedDocument {
  markdown: string
  assets: Array<{ id: number; mediaType: string; data: Buffer }>
}

/** 文档领域服务：受控读取、按需解析、可取消导出；不自动发送成果。 */
export class DocumentService {
  private active = 0
  private native?: Promise<Anydoc | undefined>
  private readonly cache = new Map<string, { value: ParsedDocument; expires: number }>()

  constructor(
    private readonly resources: ResourceService,
    private readonly checkpoints: WorkspaceCheckpointService,
    private readonly chromium: DocumentPdfCapabilityRuntime,
    private readonly fontPath: string,
  ) {}

  private anydoc(): Promise<Anydoc | undefined> {
    return (this.native ??= import('@firecrawl/anydoc').catch(() => undefined))
  }

  async capabilities() {
    const parser = await this.anydoc()
    const pdf = await access(this.fontPath).then(
      () => true,
      () => false,
    )
    return {
      actions: ['capabilities', 'inspect', 'read', 'export'],
      read: {
        text: ['md', 'txt', 'json'],
        office: parser
          ? [
              'doc',
              'docx',
              'docm',
              'ppt',
              'pptx',
              'pptm',
              'xls',
              'xlsx',
              'xlsm',
              'xlsb',
              'odt',
              'ods',
              'odp',
              'rtf',
              'epub',
              'csv',
              'pdf',
            ]
          : [],
        ...(parser ? {} : { unavailable: '文档解析模块未就绪，请检查当前平台的 anydoc 原生依赖' }),
        ocr: false,
      },
      export: ['md', 'docx', 'xlsx', ...(pdf || this.chromium.available() ? ['pdf'] : [])],
      pdfEngines: [...(pdf ? ['pdfkit'] : []), ...(this.chromium.available() ? ['chromium'] : [])],
      limits: {
        inputBytes: DOCUMENT_MAX_INPUT_BYTES,
        outputBytes: DOCUMENT_MAX_OUTPUT_BYTES,
        cells: 50000,
        readCharacters: 32000,
      },
      templates: ['standard', 'compact'],
      workbook: {
        sheets: [
          {
            name: '预算',
            columns: ['项目', '金额'],
            rows: [
              ['交通', 120],
              ['住宿', 300],
              ['合计', { formula: 'SUM(B2:B3)', result: 420 }],
            ],
          },
        ],
      },
      note: '文稿用 Markdown；XLSX 使用明确的表格或 workbook。导出后用 send_file 交付；不覆盖已有文件。',
    }
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    if (context.interactionMode !== 'work') throw new Error('文档工具仅在工作模式开放')
    const input = documentInputSchema.parse(args)
    if (input.action === 'capabilities') return this.capabilities()
    if (this.active >= 2) throw new Error('正在处理的文档较多，请稍后重试')
    this.active++
    const signal = AbortSignal.any([
      ...(context.signal ? [context.signal] : []),
      AbortSignal.timeout(60000),
    ])
    try {
      signal.throwIfAborted()
      const source = input.source
        ? await this.resources.readDocumentSource(
            { ...context, signal },
            input.source,
            DOCUMENT_MAX_INPUT_BYTES,
          )
        : undefined
      signal.throwIfAborted()
      if (input.action === 'read' || input.action === 'inspect') {
        const parsed = await this.parse(source!.bytes, source!.name, signal)
        if (input.action === 'inspect') {
          const blocks = documentBlocks(parsed.markdown)
          return {
            name: source!.name,
            mimeType: source!.mimeType,
            sizeBytes: source!.bytes.length,
            sha256: createHash('sha256').update(source!.bytes).digest('hex'),
            characters: parsed.markdown.length,
            tables: blocks.filter((block) => block.kind === 'table').length,
            headings: blocks
              .filter((block) => block.kind === 'heading')
              .slice(0, 30)
              .map((block) => block.text),
            assets: parsed.assets.map((asset) => ({
              index: asset.id,
              mimeType: asset.mediaType,
              sizeBytes: asset.data.length,
            })),
          }
        }
        const images: Array<{
          imagePreview: Awaited<ReturnType<ResourceService['captureImagePreview']>>
        }> = []
        const warnings: string[] = []
        for (const asset of parsed.assets
          .filter((item) =>
            ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mediaType),
          )
          .slice(0, 8)) {
          signal.throwIfAborted()
          if (asset.data.length > 5 * 1024 * 1024) {
            warnings.push(`图片 ${asset.id} 超过 5MB，保留在原文件中`)
            continue
          }
          const hash = createHash('sha256').update(asset.data).digest('hex')
          const imagePreview = await this.resources.captureImagePreview(
            { ...context, signal },
            {
              bytes: asset.data,
              name: `${path.parse(source!.name).name}-图片${asset.id}.${asset.mediaType.split('/')[1]}`,
              mimeType: asset.mediaType,
              sizeBytes: asset.data.length,
              hash,
              sourceRef: `document:${hash}`,
            },
          )
          images.push({ imagePreview })
        }
        return {
          name: source!.name,
          markdown: parsed.markdown.slice(input.offset, input.offset + input.limit),
          offset: input.offset,
          totalCharacters: parsed.markdown.length,
          nextOffset:
            input.offset + input.limit < parsed.markdown.length ? input.offset + input.limit : null,
          images,
          warnings: [
            ...warnings,
            ...(parsed.assets.length > images.length ? ['其余内嵌资源保留在原文件中'] : []),
          ],
          source: input.source,
        }
      }

      const warnings: string[] = []
      const parsedSource =
        source && input.format !== 'xlsx'
          ? await this.parse(source.bytes, source.name, signal)
          : undefined
      let markdown = input.content ?? parsedSource?.markdown ?? ''
      const sourceImages =
        parsedSource?.assets.filter((asset) =>
          ['image/png', 'image/jpeg'].includes(asset.mediaType),
        ) ?? []
      if (input.format !== 'md' && sourceImages.length) {
        markdown +=
          '\n\n## 文档内图片\n\n' +
          sourceImages
            .slice(0, 32)
            .map((asset) => `![图片 ${asset.id}](document-asset:${asset.id})`)
            .join('\n\n')
        warnings.push('原文档内嵌图片集中附在文末；转换不保留原始分页与版式')
      } else if (input.format === 'md' && parsedSource?.assets.length)
        warnings.push('Markdown 仅提取文字；内嵌资源保留在原文档中，可用 read 获取图片引用')
      let bytes: Buffer
      if (input.format === 'xlsx') {
        let book: WorkbookInput
        if (input.workbook) book = input.workbook
        else if (source && path.extname(source.name).toLowerCase() === '.json')
          book = workbookSchema.parse(JSON.parse(source.bytes.toString('utf8')))
        else
          book = markdownWorkbook(
            input.content ?? (await this.parse(source!.bytes, source!.name, signal)).markdown,
            input.tableIndex,
          )
        if (
          book.sheets.some((sheet) =>
            sheet.rows.some((row) =>
              row.some((cell) => cell && typeof cell === 'object' && 'formula' in cell),
            ),
          )
        )
          warnings.push('公式已写入；未提供 result 的公式需要在 Excel 等应用中重新计算')
        if (!input.workbook && path.extname(source?.name ?? '').toLowerCase() !== '.json')
          warnings.push('Markdown 表格按文本导出；需要数字、布尔值或公式时请使用 workbook')
        bytes = await renderWorkbook(book, signal)
      } else if (input.format === 'md') bytes = Buffer.from(markdown, 'utf8')
      else {
        const imageCache = new Map<string, DocumentImage | undefined>()
        let imageBytes = 0
        const render: RenderContext = {
          input,
          markdown,
          fontPath: this.fontPath,
          signal,
          warnings,
          image: async (href) => {
            if (imageCache.has(href)) return imageCache.get(href)
            let image: DocumentImage | undefined
            try {
              if (imageCache.size >= 32) throw new Error('单次最多导出 32 张图片')
              const embedded = /^document-asset:(\d+)$/.exec(href)
              if (embedded) {
                const asset = sourceImages.find((item) => item.id === Number(embedded[1]))
                if (!asset) throw new Error('文档内图片不存在')
                image = documentImage(asset.data)
              } else {
                if (/^(?:https?:|data:|file:)/i.test(href))
                  throw new Error('请先将在线图片保存到任务目录，再使用相对路径')
                const reference = href.startsWith('attachment:')
                  ? href
                  : input.source && !input.source.startsWith('attachment:')
                    ? path.join(path.dirname(input.source), decodeURIComponent(href))
                    : href
                const resource = await this.resources.readDocumentSource(
                  { ...context, signal },
                  reference,
                  5 * 1024 * 1024,
                )
                image = documentImage(resource.bytes)
              }
              if (imageBytes + image.bytes.length > DOCUMENT_MAX_INPUT_BYTES)
                throw new Error('本次导出的图片总量超过 20MB，请拆分文稿')
              imageBytes += image.bytes.length
            } catch (error) {
              signal.throwIfAborted()
              image = undefined
              warnings.push(
                `图片 ${href.slice(0, 150)} 未嵌入：${error instanceof Error ? error.message : '读取失败'}`,
              )
            }
            imageCache.set(href, image)
            return image
          },
        }
        if (input.format === 'docx') bytes = await renderDocx(render)
        else if (input.engine === 'chromium') {
          const request: DocumentPdfRequest = {
            html: await renderDocumentHtml(render),
            paper: input.paper,
            landscape: input.landscape,
            marginMm: input.marginMm,
          }
          bytes = await this.chromium.render(
            request,
            {
              principalId: context.agentId,
              correlationId: context.toolCallId ?? `document:${Date.now()}`,
              executionId: context.executionId,
              processId: context.processId,
              deadline: new Date(Date.now() + 30000).toISOString(),
            },
            signal,
          )
        } else {
          await access(this.fontPath).catch(() => {
            throw new Error('PDF 中文字体不可用，请检查字体资源或设置 INFOS_DOCUMENT_FONT')
          })
          bytes = await renderPdf(render)
        }
      }
      signal.throwIfAborted()
      if (bytes.length > DOCUMENT_MAX_OUTPUT_BYTES) throw new Error('导出文件超过 20MB，请拆分文档')
      const session = await resolveExecutionSession(context)
      const base =
        path
          .parse(source?.name ?? input.title ?? '文档')
          .name.replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\p{Cc}/gu, '_')
          .slice(0, 80) || '文档'
      const owner = (context.taskId ?? context.threadId).replace(/[^\w-]/g, '_').slice(0, 80)
      const fingerprint = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
      const output = input.output ?? `documents/${owner}/${base}-${fingerprint}.${input.format}`
      const resolved = path.resolve(session.workspaceRoot, output)
      const relative = path.relative(session.workspaceRoot, resolved)
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error('输出必须位于当前任务工作区内')
      if (!relative.includes(path.sep))
        throw new Error('请将文档保存到任务子目录，勿直接写入工作区根目录')
      if (path.extname(output).toLowerCase() !== `.${input.format}`)
        throw new Error('输出文件后缀与导出格式不一致')
      const written = await getProductivityRuntime().virtualWorkspace.createBinary(session, {
        path: output,
        bytes,
        signal,
        beforeWrite: () => this.checkpoints.captureToolMutation(context, output),
        afterWrite: (captured, content) =>
          this.checkpoints.commit(
            captured as Awaited<ReturnType<WorkspaceCheckpointService['captureBefore']>>,
            content,
          ),
      })
      if (written.checkpointWarning) warnings.push(written.checkpointWarning)
      return {
        success: true,
        path: output.replaceAll('\\', '/'),
        format: input.format,
        engine: input.format === 'pdf' ? input.engine : undefined,
        sizeBytes: bytes.length,
        sha256: written.newHash,
        created: written.created,
        warnings: [...new Set(warnings)],
        next: '使用 send_file 发送此文件',
      }
    } finally {
      this.active--
    }
  }

  /** 界面按需读取文档摘要，不调用 Agent 工具、不导出文件或创建交付记录。 */
  async preview(bytes: Buffer, name: string, cancellation?: AbortSignal) {
    if (bytes.length > DOCUMENT_MAX_INPUT_BYTES) throw new Error('文档超过预览大小限制')
    if (this.active >= 2) throw new Error('正在处理的文档较多，请稍后重试')
    this.active++
    const signal = AbortSignal.any([
      ...(cancellation ? [cancellation] : []),
      AbortSignal.timeout(15000),
    ])
    try {
      signal.throwIfAborted()
      const parsed = await this.parse(bytes, name, signal)
      return { text: parsed.markdown.slice(0, 8000), truncated: parsed.markdown.length > 8000 }
    } finally {
      this.active--
    }
  }

  private async parse(bytes: Buffer, name: string, signal: AbortSignal): Promise<ParsedDocument> {
    const extension = path.extname(name).slice(1).toLowerCase()
    const hash = createHash('sha256').update(bytes).update(extension).digest('hex')
    const cached = this.cache.get(hash)
    if (cached && cached.expires > Date.now()) return cached.value
    let value: ParsedDocument
    if (['md', 'markdown', 'txt', 'json'].includes(extension))
      value = { markdown: new TextDecoder('utf-8', { fatal: true }).decode(bytes), assets: [] }
    else {
      const parser = await this.anydoc()
      if (!parser) throw new Error('文档解析模块不可用，请检查 anydoc 平台依赖')
      try {
        value = await parseOfficeDocument(bytes, name, signal)
      } catch (error) {
        signal.throwIfAborted()
        const code = (error as { code?: string }).code
        const reasons: Record<string, string> = {
          needsOcr: '文档包含扫描页，需要 OCR；请使用已配置的 PDF 解析功能',
          encrypted: '文档已加密，请先解密',
          unsupported: '文档格式不受支持',
          malformed: '文档已损坏或没有可读取内容',
          resourceLimit: '文档结构超过解析限制，请拆分文件',
          missingPart: '文档缺少必要内容，请重新导出源文件',
        }
        throw new Error(reasons[code ?? ''] ?? '文档解析失败，请检查源文件')
      }
    }
    signal.throwIfAborted()
    if (
      value.markdown.length > 2000000 ||
      value.assets.reduce((total, asset) => total + asset.data.length, 0) > DOCUMENT_MAX_INPUT_BYTES
    )
      throw new Error('解析内容过多，请拆分文档后读取')
    for (const [key, entry] of this.cache) if (entry.expires <= Date.now()) this.cache.delete(key)
    if (this.cache.size >= 2) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(hash, { value, expires: Date.now() + 60000 })
    return value
  }
}

/** 只嵌入 PNG/JPEG，尺寸在读取后检查，避免把外部路径交给导出库。 */
export function documentImage(bytes: Buffer): DocumentImage {
  let width = 0,
    height = 0
  let type: 'png' | 'jpg'
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    type = 'png'
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    type = 'jpg'
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]!
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        height = bytes.readUInt16BE(offset + 5)
        width = bytes.readUInt16BE(offset + 7)
        break
      }
      offset += 2 + length
    }
  } else throw new Error('导出图片支持 PNG 和 JPEG，请先转换格式')
  if (!width || !height || width * height > 40000000)
    throw new Error('图片尺寸无效或超过 4000 万像素')
  return { bytes, type, width, height }
}
