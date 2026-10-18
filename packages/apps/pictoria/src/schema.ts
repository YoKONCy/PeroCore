import Ajv, { type ValidateFunction } from 'ajv'

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  validateFormats: false,
  ownProperties: true,
  coerceTypes: false,
  useDefaults: false,
})
const cache = new Map<string, ValidateFunction>()

export function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  if (JSON.stringify(schema).length > 64000) throw new Error('schema 超过大小限制')
  const inspect = (value: unknown, depth = 0): void => {
    if (depth > 32) throw new Error('schema 嵌套过深')
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (
        key === '$async' ||
        key === '$id' ||
        (key === '$ref' && (typeof item !== 'string' || !item.startsWith('#/')))
      )
        throw new Error('schema 不支持异步、全局标识或外部引用')
      inspect(item, depth + 1)
    }
  }
  inspect(schema)
  const key = JSON.stringify(schema)
  let compiled = cache.get(key)
  if (!compiled) {
    compiled = ajv.compile(schema)
    if (cache.size >= 256) cache.delete(cache.keys().next().value!)
    cache.set(key, compiled)
  }
  return compiled
}

export function validate(schema: Record<string, unknown>, value: unknown): void {
  const compiled = compileSchema(schema)
  if (!compiled(value)) {
    const details = compiled.errors?.map((e) => ({
      path: e.instancePath,
      rule: e.keyword,
      details: e.params,
    }))
    throw new Error(`字段校验失败：${JSON.stringify(details)}`)
  }
}
