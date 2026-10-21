/** 不依赖 Vue、Electron 或服务端的共用翻译运行时。 */
export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en-US'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]
export const LANGUAGE_CONFIG_KEY = 'user.language'
export const LANGUAGE_OPTIONS = [
  { label: '简体中文', value: 'zh-CN' },
  { label: '繁體中文', value: 'zh-TW' },
  { label: 'English', value: 'en-US' },
] as const

type Messages = Readonly<Record<string, string>>
const catalogs = new Map<string, Partial<Record<AppLocale, Messages>>>()
const listeners = new Set<(locale: AppLocale) => void>()
let diagnosticPatterns: Array<{
  scope: string
  source: string
  pattern: RegExp
  indices: number[]
}> | null = null
let locale: AppLocale = 'zh-CN'

export function normalizeLocale(value: unknown): AppLocale {
  const language = String(value ?? '')
    .split(',')[0]!
    .split(';')[0]!
    .trim()
    .replaceAll('_', '-')
    .toLowerCase()
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(language)) return 'zh-TW'
  if (/^en(?:-|$)/.test(language)) return 'en-US'
  return 'zh-CN'
}

export function getLocale(): AppLocale {
  return locale
}

export function setLocale(value: unknown): AppLocale {
  const next = normalizeLocale(value)
  if (next === locale) return locale
  locale = next
  for (const listener of listeners) listener(next)
  return locale
}

export function onLocaleChange(listener: (locale: AppLocale) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerCatalog(scope: string, language: AppLocale, messages: Messages): void {
  const entry = catalogs.get(scope) ?? {}
  entry[language] = messages
  catalogs.set(scope, entry)
  if (scope.startsWith('errors.')) diagnosticPatterns = null
}

/** 只在日志/错误展示边界使用；内部异常原文与错误码保持不变。 */
export function translateDiagnostic(source: string, language: AppLocale = locale): string {
  if (language === 'zh-CN' || !source || source.length > 20_000) return source
  const scopes = [...catalogs.keys()].filter((scope) => scope.startsWith('errors.'))
  for (const scope of scopes)
    if (catalogs.get(scope)?.['zh-CN']?.[source] !== undefined)
      return translate(scope, source, [], language)
  diagnosticPatterns ??= scopes.flatMap((scope) =>
    Object.keys(catalogs.get(scope)?.['zh-CN'] ?? {})
      .filter((text) => /\{\d+\}/.test(text))
      .map((text) => {
        const indices: number[] = []
        const pattern = text
          .split(/(\{\d+\})/g)
          .map((part) => {
            const match = /^\{(\d+)\}$/.exec(part)
            if (match) {
              indices.push(Number(match[1]))
              return '([\\s\\S]*?)'
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('')
        return { scope, source: text, pattern: new RegExp(`^${pattern}$`), indices }
      }),
  )
  for (const entry of diagnosticPatterns) {
    const match = entry.pattern.exec(source)
    if (!match) continue
    const parameters: unknown[] = []
    entry.indices.forEach((index, position) => {
      parameters[index] = match[position + 1]
    })
    return translate(entry.scope, entry.source, parameters, language)
  }
  return source
}

/** 原文只作稳定查询键；参数最后插入，绝不翻译用户数据或重新解释其中的占位符。 */
export function translate(
  scope: string,
  source: string,
  parameters: readonly unknown[] = [],
  language: AppLocale = locale,
): string {
  const entry = catalogs.get(scope)
  const text = entry?.[language]?.[source] ?? entry?.['zh-CN']?.[source] ?? source
  return text.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < parameters.length ? String(parameters[Number(index)] ?? '') : token,
  )
}
