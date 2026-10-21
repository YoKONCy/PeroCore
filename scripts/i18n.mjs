import fs from 'node:fs'

const language = String(process.env.INFOS_LANGUAGE ?? process.env.LANG ?? 'zh-CN')
  .replaceAll('_', '-')
  .toLowerCase()
const locale = /^zh-(tw|hk|mo|hant)(-|$)/.test(language)
  ? 'zh-TW'
  : /^en(-|$)/.test(language)
    ? 'en-US'
    : 'zh-CN'
const catalogs = new Map()

/** 开发脚本直接读取分类资源，无需先构建应用。 */
export function t(scope, source, parameters = []) {
  if (!/^scripts\.[a-z0-9-]+$/.test(scope)) return source
  if (!catalogs.has(scope)) {
    let messages = {}
    try {
      const resource = new URL(
        `../packages/shared/src/i18n/locales/${locale}/${scope.replaceAll('.', '/')}.json`,
        import.meta.url,
      )
      messages = JSON.parse(fs.readFileSync(resource, 'utf8'))
    } catch {
      /* 源码资源未准备好时使用中文原文 */
    }
    catalogs.set(scope, messages)
  }
  return (catalogs.get(scope)[source] ?? source).replace(/\{(\d+)\}/g, (token, index) =>
    Number(index) < parameters.length ? String(parameters[Number(index)] ?? '') : token,
  )
}
