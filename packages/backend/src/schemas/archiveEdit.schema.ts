import { z } from 'zod'

const tags = z.array(z.string().trim().min(1).max(200)).max(100)
const score = z.number().int().min(0).max(10)

export const memoryEditSchema = z
  .object({
    narrative: z.string().trim().min(1).max(20_000),
    importance: score,
    affect: z.object({ tones: tags, valence: score, arousal: score }).strict(),
    participants: tags,
    places: tags,
    objects: tags,
    topics: tags,
    expectedStatus: z.enum(['active', 'archived']),
    regenerateVector: z.boolean().default(false),
    operationId: z.string().uuid(),
  })
  .strict()

export const factEditSchema = z
  .object({
    statement: z.string().trim().min(1).max(20_000),
    source: z.string().trim().max(2000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    operationId: z.string().uuid(),
  })
  .strict()
