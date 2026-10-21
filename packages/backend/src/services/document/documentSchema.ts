import { t as __t } from '../../lib/i18n'
import { z } from 'zod'

const cell = z.union([
  z.string().max(32767),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z
    .object({
      formula: z.string().min(1).max(4096),
      result: z.union([z.number().finite(), z.string().max(32767), z.boolean()]).optional(),
    })
    .strict(),
])

export const workbookSchema = z
  .object({
    sheets: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(31)
              .refine(
                (name) => ![...name].some((character) => '\\/*?:[]'.includes(character)),
                '工作表名称不能包含 \\ / * ? : [ ]',
              ),
            columns: z.array(z.string().max(200)).max(256).optional(),
            rows: z.array(z.array(cell).max(256)).max(10000),
            freezeHeader: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((book, ctx) => {
    const names = book.sheets.map((sheet) => sheet.name.toLowerCase())
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: __t('server.document', '工作表名称不能重复'),
      })
    const count = book.sheets.reduce(
      (sum, sheet) => sum + sheet.rows.reduce((total, row) => total + row.length, 0),
      0,
    )
    if (count > 50000)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: __t('server.document', '单次最多导出 50000 个单元格'),
      })
    for (const sheet of book.sheets) {
      if (sheet.name.startsWith("'") || sheet.name.endsWith("'"))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __t('server.document', '工作表名称不能以单引号开头或结尾'),
        })
    }
  })

export const documentInputSchema = z
  .object({
    action: z.enum(['capabilities', 'inspect', 'read', 'export']),
    source: z.string().trim().min(1).max(2048).optional(),
    content: z.string().max(500000).optional(),
    format: z.enum(['md', 'pdf', 'docx', 'xlsx']).optional(),
    output: z.string().trim().min(1).max(2048).optional(),
    engine: z.enum(['pdfkit', 'chromium']).default('pdfkit'),
    template: z.enum(['standard', 'compact']).default('standard'),
    paper: z.enum(['A4', 'Letter']).default('A4'),
    landscape: z.boolean().default(false),
    marginMm: z.number().min(8).max(40).default(18),
    title: z.string().max(200).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(32000).default(12000),
    tableIndex: z.number().int().min(1).optional(),
    workbook: workbookSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.action === 'capabilities') return
    if (input.action !== 'export' && !input.source)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: __t('server.document', '请提供 source'),
      })
    if (input.action === 'export') {
      if (!input.format)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __t('server.document', '请提供导出格式'),
        })
      if (
        [input.source, input.content, input.workbook].filter((value) => value !== undefined)
          .length !== 1
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __t('server.document', 'source、content 和 workbook 必须且只能提供一个'),
        })
      if (input.workbook && input.format !== 'xlsx')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __t('server.document', 'workbook 仅用于 XLSX 导出'),
        })
      if (input.engine === 'chromium' && input.format !== 'pdf')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __t('server.document', 'Chromium 仅用于 PDF 导出'),
        })
    }
  })

export type DocumentInput = z.infer<typeof documentInputSchema>
export type WorkbookInput = z.infer<typeof workbookSchema>
