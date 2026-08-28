import { CODE_MESSAGES } from '@infos/shared'
import { zValidator } from '@hono/zod-validator'
import type { ZodTypeAny } from 'zod'

export type ValidationTarget = 'json' | 'query' | 'form' | 'param' | 'header' | 'cookie'

/** 将Zod校验错误统一转换为项目API信封。 */
export function validate<Target extends ValidationTarget, Schema extends ZodTypeAny>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return
    const fields = Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join('.') || '_root', issue.message]),
    )
    return c.json(
      {
        code: 'VALIDATION_ERROR',
        message: CODE_MESSAGES.VALIDATION_ERROR,
        data: { fields },
      },
      400,
    )
  })
}
