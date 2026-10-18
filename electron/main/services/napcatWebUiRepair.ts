/** 修正 4.18.38 在 .infos 等隐藏安装目录下的 SPA 页面回退，不开放隐藏文件访问。 */
export function repairNapCatWebUiSource(source: string): string {
  if (!/typeof\s+[\w$]+\s*<\s*["']u["']\s*&&\s*["']4\.18\.38["']/.test(source)) return source
  const identifier = '[A-Za-z_$][\\w$]*'
  const entries = [
    ...source.matchAll(
      new RegExp(
        `\\bconst\\s+(${identifier})\\s*=\\s*${identifier}\\((${identifier})\\.staticPath,\\s*"index\\.html"\\);`,
        'g',
      ),
    ),
  ]
  if (entries.length !== 1) throw new Error('NapCat 管理页入口布局不匹配')
  const entry = entries[0]!
  const start = entry.index!
  // 只处理紧随入口声明的 WebUI 回退路由，插件文件与 API 不参与替换。
  const end = Math.min(start + 600, source.length)
  const section = source.slice(start, end)
  if (!section.includes('.all(/\\/webui\\/(.*)/,'))
    throw new Error('NapCat 管理页回退路由布局不匹配')
  const indexVariable = entry[1]!.replace(/\$/g, '\\$')
  const original = new RegExp(`\\.sendFile\\(\\s*${indexVariable}\\s*\\);`, 'g')
  const matches = [...section.matchAll(original)]
  const repaired = `.sendFile("index.html", { root: ${entry[2]}.staticPath, cacheControl: false, headers: { "Cache-Control": "no-store" } });`
  if (matches.length === 0 && section.includes(repaired)) return source
  if (matches.length !== 1) throw new Error('NapCat 管理页文件响应布局不匹配')
  return source.slice(0, start) + section.replace(original, repaired) + source.slice(end)
}
