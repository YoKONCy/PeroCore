import { marked, type Token, type Tokens } from 'marked'
import type { DocumentInput, WorkbookInput } from './documentSchema'
import { workbookSchema } from './documentSchema'
import { DOCUMENT_MAX_OUTPUT_BYTES } from '@infos/shared'

export interface DocumentImage {
  bytes: Buffer
  type: 'png' | 'jpg'
  width: number
  height: number
}

export interface RenderContext {
  input: DocumentInput
  markdown: string
  fontPath: string
  signal: AbortSignal
  image: (source: string) => Promise<DocumentImage | undefined>
  warnings: string[]
}

interface Block {
  kind: 'heading' | 'paragraph' | 'code' | 'table' | 'rule' | 'image'
  text: string
  depth?: number
  prefix?: string
  tokens?: Token[]
  header?: string[]
  rows?: string[][]
  href?: string
}

function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'image') return `[${token.text || '图片'}]`
      if (token.type === 'br') return '\n'
      if ('tokens' in token && Array.isArray(token.tokens)) return inlineText(token.tokens)
      if ('text' in token) return String(token.text)
      return token.raw
    })
    .join('')
}

/** 统一解析 Markdown，导出器共用同一份标题、段落与表格语义。 */
export function documentBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const visit = (tokens: Token[], prefix = '', nesting = 0): void => {
    if (nesting > 20) throw new Error('文档嵌套过深，请简化列表结构')
    for (const token of tokens) {
      if (blocks.length >= 10000) throw new Error('文档段落过多，请分段导出')
      if (token.type === 'space' || token.type === 'def') continue
      if (token.type === 'list') {
        const list = token as Tokens.List
        list.items.forEach((item, index) =>
          visit(
            item.tokens,
            `${'  '.repeat(nesting)}${list.ordered ? `${Number(list.start) + index}.` : '•'} ${item.task ? (item.checked ? '☑ ' : '☐ ') : ''}`,
            nesting + 1,
          ),
        )
      } else if (token.type === 'blockquote') {
        visit((token as Tokens.Blockquote).tokens, `${prefix}│ `, nesting + 1)
      } else if (token.type === 'table') {
        const table = token as Tokens.Table
        blocks.push({
          kind: 'table',
          text: '',
          header: table.header.map((cell) => inlineText(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => inlineText(cell.tokens))),
        })
      } else if (token.type === 'hr') {
        blocks.push({ kind: 'rule', text: '' })
      } else if (token.type === 'code') {
        blocks.push({ kind: 'code', text: (token as Tokens.Code).text, prefix })
      } else if (token.type === 'heading' || token.type === 'paragraph' || token.type === 'text') {
        const inline = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
        const text = inline.length ? inlineText(inline) : 'text' in token ? String(token.text) : ''
        blocks.push({
          kind: token.type === 'heading' ? 'heading' : 'paragraph',
          text,
          depth: token.type === 'heading' ? (token as Tokens.Heading).depth : undefined,
          tokens: inline,
          prefix,
        })
        for (const image of collectImages(inline))
          blocks.push({ kind: 'image', text: image.text, href: image.href })
      } else if (token.type === 'html') {
        // 原始 HTML 不执行；按原文显示，避免从文稿加载脚本或外部页面。
        blocks.push({ kind: 'code', text: token.raw })
      }
    }
  }
  visit(marked.lexer(markdown, { gfm: true }))
  return blocks
}

function collectImages(tokens: Token[]): Tokens.Image[] {
  return tokens.flatMap((token) =>
    token.type === 'image'
      ? [token as Tokens.Image]
      : 'tokens' in token && Array.isArray(token.tokens)
        ? collectImages(token.tokens)
        : [],
  )
}

export function markdownWorkbook(markdown: string, tableIndex?: number): WorkbookInput {
  const tables = documentBlocks(markdown).filter((block) => block.kind === 'table')
  if (!tables.length) throw new Error('Markdown 中没有表格，请提供 workbook 或含表格的源文件')
  if (tables.length > 1 && tableIndex === undefined)
    throw new Error(`找到 ${tables.length} 张表格，请用 tableIndex 选择（从 1 开始）`)
  const table = tables[(tableIndex ?? 1) - 1]
  if (!table) throw new Error('tableIndex 超出表格数量')
  return workbookSchema.parse({
    sheets: [{ name: '数据', columns: table.header, rows: table.rows }],
  })
}

export async function renderWorkbook(book: WorkbookInput, signal: AbortSignal): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs')
  const validated = workbookSchema.parse(book)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'infOS'
  workbook.calcProperties.fullCalcOnLoad = true
  for (const source of validated.sheets) {
    signal.throwIfAborted()
    const sheet = workbook.addWorksheet(source.name)
    if (source.columns?.length) {
      sheet.addRow(source.columns)
      const header = sheet.getRow(1)
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF45658B' } }
      if (source.freezeHeader !== false) sheet.views = [{ state: 'frozen', ySplit: 1 }]
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: source.columns.length },
      }
    }
    for (const row of source.rows) {
      signal.throwIfAborted()
      // 字符串始终作为字符串，只有显式 formula 对象才写入公式。
      sheet.addRow(row.map((value) => (value === null ? null : value)))
    }
    sheet.columns.forEach((column) => {
      let width = 12
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        width = Math.max(width, Math.min(50, String(cell.text).length * 1.5 + 2))
        cell.alignment = { vertical: 'top', wrapText: true }
      })
      column.width = width
    })
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  signal.throwIfAborted()
  if (bytes.length > DOCUMENT_MAX_OUTPUT_BYTES) throw new Error('导出文件超过 20MB，请拆分工作簿')
  return bytes
}

export async function renderDocx(context: RenderContext): Promise<Buffer> {
  const lib = await import('docx')
  const inline = (
    tokens: Token[],
    style: { bold?: boolean; italics?: boolean; strike?: boolean } = {},
  ): Array<InstanceType<typeof lib.TextRun> | InstanceType<typeof lib.ExternalHyperlink>> =>
    tokens.flatMap(
      (
        token,
      ): Array<InstanceType<typeof lib.TextRun> | InstanceType<typeof lib.ExternalHyperlink>> => {
        if (token.type === 'image') return []
        if (token.type === 'br') return [new lib.TextRun({ break: 1 })]
        if (token.type === 'strong' || token.type === 'em' || token.type === 'del') {
          const children = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
          return inline(children, {
            ...style,
            ...(token.type === 'strong'
              ? { bold: true }
              : token.type === 'em'
                ? { italics: true }
                : { strike: true }),
          })
        }
        if (token.type === 'link') {
          const link = token as Tokens.Link
          const text = inlineText(link.tokens)
          return /^https?:\/\//i.test(link.href)
            ? [
                new lib.ExternalHyperlink({
                  link: link.href,
                  children: [new lib.TextRun({ text, style: 'Hyperlink', ...style })],
                }),
              ]
            : [new lib.TextRun({ text, ...style })]
        }
        return [
          new lib.TextRun({ text: 'text' in token ? String(token.text) : token.raw, ...style }),
        ]
      },
    )
  const children: Array<InstanceType<typeof lib.Paragraph> | InstanceType<typeof lib.Table>> = []
  for (const block of documentBlocks(context.markdown)) {
    context.signal.throwIfAborted()
    if (block.kind === 'table') {
      const rows = [block.header ?? [], ...(block.rows ?? [])]
      if (rows.some((row) => row.length > 100) || rows.length > 3000)
        throw new Error('文稿表格过大，请改用 XLSX 导出')
      children.push(
        new lib.Table({
          width: { size: 100, type: lib.WidthType.PERCENTAGE },
          rows: rows.map(
            (row, index) =>
              new lib.TableRow({
                tableHeader: index === 0,
                children: row.map(
                  (text) =>
                    new lib.TableCell({
                      shading: index === 0 ? { fill: 'EAF0F7' } : undefined,
                      children: [
                        new lib.Paragraph({
                          children: [new lib.TextRun({ text, bold: index === 0 })],
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      )
    } else if (block.kind === 'image' && block.href) {
      const image = await context.image(block.href)
      if (image) {
        const scale = Math.min(
          1,
          (context.input.landscape ? 600 : 440) / image.width,
          650 / image.height,
        )
        children.push(
          new lib.Paragraph({
            children: [
              new lib.ImageRun({
                type: image.type,
                data: image.bytes,
                transformation: {
                  width: Math.round(image.width * scale),
                  height: Math.round(image.height * scale),
                },
                altText: { title: block.text, description: block.text, name: block.text },
              }),
            ],
          }),
        )
      }
    } else {
      const headings = [
        lib.HeadingLevel.HEADING_1,
        lib.HeadingLevel.HEADING_2,
        lib.HeadingLevel.HEADING_3,
        lib.HeadingLevel.HEADING_4,
        lib.HeadingLevel.HEADING_5,
        lib.HeadingLevel.HEADING_6,
      ]
      children.push(
        new lib.Paragraph({
          heading: block.kind === 'heading' ? headings[(block.depth ?? 1) - 1] : undefined,
          spacing: { after: context.input.template === 'compact' ? 90 : 160 },
          children: [
            ...(block.prefix ? [new lib.TextRun(block.prefix)] : []),
            ...(block.tokens?.length
              ? inline(block.tokens)
              : [new lib.TextRun(block.kind === 'rule' ? '────────────────' : block.text)]),
          ],
        }),
      )
    }
  }
  const margin = Math.round((context.input.marginMm * 1440) / 25.4)
  const [width, height] = context.input.paper === 'A4' ? [11906, 16838] : [12240, 15840]
  const document = new lib.Document({
    creator: 'infOS',
    title: context.input.title,
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            margin: { top: margin, bottom: margin, left: margin, right: margin },
            size: {
              width,
              height,
              orientation: context.input.landscape
                ? lib.PageOrientation.LANDSCAPE
                : lib.PageOrientation.PORTRAIT,
            },
          },
        },
        children,
      },
    ],
  })
  const result = await lib.Packer.toBuffer(document)
  context.signal.throwIfAborted()
  return result
}

export async function renderPdf(context: RenderContext): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const margin = (context.input.marginMm * 72) / 25.4
  const doc = new PDFDocument({
    size: context.input.paper,
    layout: context.input.landscape ? 'landscape' : 'portrait',
    margin,
    info: { Title: context.input.title ?? '', Creator: 'infOS' },
  })
  const chunks: Buffer[] = []
  let size = 0
  const abort = () => doc.destroy(new Error('文档导出已取消'))
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > DOCUMENT_MAX_OUTPUT_BYTES) doc.destroy(new Error('PDF 超过 20MB，请拆分导出'))
      else chunks.push(chunk)
    })
    doc.once('error', reject)
    doc.once('end', () => resolve(Buffer.concat(chunks)))
  })
  // 生成期间也处理流错误，避免异步读图时出现未处理的拒绝。
  void result.catch(() => undefined)
  context.signal.addEventListener('abort', abort, { once: true })
  try {
    context.signal.throwIfAborted()
    doc.font(context.fontPath)
    const fontSize = context.input.template === 'compact' ? 10 : 11
    const width = () => doc.page.width - margin * 2
    const room = (height: number) => {
      if (doc.y + height > doc.page.height - margin) doc.addPage()
    }
    for (const block of documentBlocks(context.markdown)) {
      context.signal.throwIfAborted()
      if (doc.destroyed) throw new Error('PDF 生成已停止')
      doc.fontSize(fontSize).fillColor('#202938')
      if (block.kind === 'heading') {
        const point = Math.max(fontSize + 1, 23 - (block.depth ?? 1) * 2)
        doc.fontSize(point)
        room(doc.heightOfString(block.text, { width: width() }) + 35)
        doc.text(block.text, margin, doc.y, { width: width(), lineGap: 3 }).moveDown(0.5)
      } else if (block.kind === 'table') {
        const rows = [block.header ?? [], ...(block.rows ?? [])]
        if (rows.length > 3000) throw new Error('PDF 表格过大，请改用 XLSX 导出')
        const columns = Math.max(1, ...rows.map((row) => row.length))
        if (columns > 20) throw new Error('PDF 表格过大，请改用 XLSX 导出')
        const cellWidth = width() / columns
        const paintRow = (row: string[], header: boolean): void => {
          doc.fontSize(Math.max(8, fontSize - 1))
          const rowHeight = Math.max(
            24,
            ...row.map((text) => doc.heightOfString(text, { width: cellWidth - 10 }) + 12),
          )
          if (rowHeight > doc.page.height - margin * 2)
            throw new Error('表格单元格超过一页，请缩短内容或使用 DOCX')
          if (!header) {
            const headerHeight = Math.max(
              24,
              ...(block.header ?? []).map(
                (text) => doc.heightOfString(text, { width: cellWidth - 10 }) + 12,
              ),
            )
            if (rowHeight + headerHeight > doc.page.height - margin * 2)
              throw new Error('表格行与表头合计超过一页，请缩短内容或使用 DOCX')
          }
          if (doc.y + rowHeight > doc.page.height - margin) {
            doc.addPage()
            if (!header) paintRow(block.header ?? [], true)
          }
          const y = doc.y
          for (let column = 0; column < columns; column++) {
            const x = margin + column * cellWidth
            if (header) doc.rect(x, y, cellWidth, rowHeight).fill('#EAF0F7')
            doc.rect(x, y, cellWidth, rowHeight).lineWidth(0.4).stroke('#CCD5E2')
            doc.fillColor('#202938').text(row[column] ?? '', x + 5, y + 6, {
              width: cellWidth - 10,
              height: rowHeight - 10,
            })
          }
          doc.x = margin
          doc.y = y + rowHeight
        }
        rows.forEach((row, index) => paintRow(row, index === 0))
        doc.moveDown(0.6)
      } else if (block.kind === 'image' && block.href) {
        const image = await context.image(block.href)
        if (image) {
          const scale = Math.min(
            1,
            width() / image.width,
            (doc.page.height - margin * 2 - 20) / image.height,
          )
          room(image.height * scale + 12)
          const y = doc.y
          doc.image(image.bytes, margin, y, {
            width: image.width * scale,
            height: image.height * scale,
          })
          doc.y = y + image.height * scale + 12
        }
      } else if (block.kind === 'rule') {
        room(15)
        doc
          .moveTo(margin, doc.y)
          .lineTo(doc.page.width - margin, doc.y)
          .stroke('#CCD5E2')
          .moveDown()
      } else {
        const text = `${block.prefix ?? ''}${block.text}`
        room(Math.min(50, doc.heightOfString(text, { width: width() })))
        doc
          .text(text, margin, doc.y, { width: width(), lineGap: 3 })
          .moveDown(block.kind === 'code' ? 0.6 : 0.4)
      }
    }
    doc.end()
    return await result
  } catch (error) {
    doc.destroy()
    throw error
  } finally {
    context.signal.removeEventListener('abort', abort)
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

/** Chromium 只接收本服务构造的文档 HTML，图片预先转换为受控字节。 */
export async function renderDocumentHtml(context: RenderContext): Promise<string> {
  const body: string[] = []
  for (const block of documentBlocks(context.markdown)) {
    context.signal.throwIfAborted()
    if (block.kind === 'image' && block.href) {
      const image = await context.image(block.href)
      if (image)
        body.push(
          `<img alt="${escapeHtml(block.text)}" src="data:image/${image.type === 'jpg' ? 'jpeg' : 'png'};base64,${image.bytes.toString('base64')}">`,
        )
    } else if (block.kind === 'table') {
      body.push(
        `<table><thead><tr>${(block.header ?? []).map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${(block.rows ?? []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      )
    } else if (block.kind === 'heading') {
      body.push(`<h${block.depth}>${escapeHtml(block.text)}</h${block.depth}>`)
    } else if (block.kind === 'rule') body.push('<hr>')
    else
      body.push(
        `<${block.kind === 'code' ? 'pre' : 'p'}>${escapeHtml(`${block.prefix ?? ''}${block.text}`)}</${block.kind === 'code' ? 'pre' : 'p'}>`,
      )
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeHtml(context.input.title ?? '')}</title><style>body{font: ${context.input.template === 'compact' ? 10 : 11}pt/1.65 'Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#202938}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;font-size:10pt}td,th{border:1px solid #ccd5e2;padding:6px;overflow-wrap:anywhere}th{background:#eaf0f7}thead{display:table-header-group}tr,img{break-inside:avoid}img{display:block;max-width:100%;max-height:230mm;object-fit:contain}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#f2f5f8;padding:10px}</style><body>${body.join('\n')}</body></html>`
}
