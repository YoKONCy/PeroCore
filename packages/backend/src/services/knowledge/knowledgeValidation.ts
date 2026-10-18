import { z } from 'zod'

export const knowledgeSearchSchema = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    regex: z.string().trim().min(1).max(1000).optional(),
    limit: z.number().int().min(1).max(20).default(5),
    expand: z.boolean().default(false),
    partIds: z.array(z.string().regex(/^\d+$/)).min(1).max(20).optional(),
    documentId: z.string().uuid().optional(),
    offset: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 * 1024)
      .optional(),
  })
  .refine(
    (value) => Boolean(value.keywords?.length || value.regex || value.partIds?.length),
    '请输入关键词、正则或片段编号',
  )
  .refine(
    (value) => value.offset === undefined || (value.expand && value.partIds?.length === 1),
    '游标仅用于展开一个指定片段',
  )
