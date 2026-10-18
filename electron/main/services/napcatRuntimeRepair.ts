/** 仅修正已核对的 4.18.38 发行代码，不把补丁应用到其他版本或未知布局。 */
export function repairNapCatRuntimeSource(source: string): string {
  if (!/typeof\s+[\w$]+\s*<\s*["']u["']\s*&&\s*["']4\.18\.38["']/.test(source)) return source

  let result = source
  const identifier = '[A-Za-z_$][\\w$]*'
  for (const action of ['GoCQHTTP_GetGroupMsgHistory', 'GetFriendMsgHistory']) {
    // 接口名称属于协议，枚举命名空间与局部变量属于打包细节，不能写死。
    const markers = [
      ...result.matchAll(new RegExp(`\\bactionName\\s*=\\s*${identifier}\\.${action}\\s*;`, 'g')),
    ]
    if (markers.length !== 1) throw new Error(`NapCat 历史接口布局不匹配：${action}`)
    const start = markers[0]!.index!
    const nextClass = result.indexOf('\nclass ', start)
    const end = nextClass < 0 ? result.length : nextClass
    const section = result.slice(start, end)
    const branches = [
      ...section.matchAll(
        new RegExp(
          `if\\s*\\(\\s*(${identifier})\\.length\\s*===\\s*0(?:\\s*&&\\s*(${identifier}))?\\s*\\)\\s*throw\\s+new\\s+Error\\(\x60消息\\$\\{(${identifier})\\.message_seq\\}不存在\x60\\);`,
          'g',
        ),
      ),
    ]
    if (branches.length !== 1) throw new Error(`NapCat 历史接口分支不匹配：${action}`)
    const branch = branches[0]!
    const payload = branch[3]!
    const escapedPayload = payload.replace(/\$/g, '\\$')
    const cursors = [
      ...section.matchAll(
        new RegExp(
          `(?:^|[,;\\s])(${identifier})\\s*=\\s*${escapedPayload}\\.message_seq\\s*\\?`,
          'g',
        ),
      ),
    ]
    if (cursors.length !== 1) throw new Error(`NapCat 历史接口游标不匹配：${action}`)
    const cursor = cursors[0]![1]!
    if (branch[2] && branch[2] !== cursor) throw new Error(`NapCat 历史接口条件不匹配：${action}`)
    // 未指定游标时，空历史是正常结果；明确查询不存在的游标仍保留原错误。
    if (!branch[2]) {
      const repaired = `if (${branch[1]}.length === 0 && ${cursor}) throw new Error(\`消息\${${payload}.message_seq}不存在\`);`
      result = result.slice(0, start) + section.replace(branch[0], repaired) + result.slice(end)
    }
  }

  const originals = [
    ...result.matchAll(
      new RegExp(
        `this\\.core\\.context\\.logger\\.logWarn\\("似乎是旧版客户端，尝试仅通过序号获取引用消息",\\s*(${identifier})\\.replayMsgSeq\\);`,
        'g',
      ),
    ),
  ]
  if (originals.length === 1) {
    return result.replace(
      originals[0]![0],
      `this.core.context.logger.logDebug("引用消息元数据不完整，尝试通过序号查询", ${originals[0]![1]}.replayMsgSeq);`,
    )
  }
  if (
    originals.length > 1 ||
    !result.includes('logDebug("引用消息元数据不完整，尝试通过序号查询",')
  )
    throw new Error('NapCat 引用消息接口布局不匹配')
  return result
}
