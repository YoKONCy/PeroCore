import { describe, expect, it } from 'vitest'
import { repairNapCatRuntimeSource } from './napcatRuntimeRepair'

// 使用发行包的真实接口枚举；历史读取简化为可注入函数，独立检查空历史语义。
const source = [
  'const Vu = typeof sQ < "u" && "4.18.38" || "1.0.0-dev";',
  'class GroupHistory {',
  '  actionName = re.GoCQHTTP_GetGroupMsgHistory;',
  '  async _handle(e) {',
  '    const o = e.message_seq ? !(e.message_seq.toString() === "0") : !!e.message_seq;',
  '    const a = await this.history(e);',
  '    if (a.length === 0) throw new Error(`消息${e.message_seq}不存在`);',
  '    return { messages: a };',
  '  }',
  '}',
  'class FriendHistory {',
  '  actionName = re.GetFriendMsgHistory;',
  '  async _handle(e) {',
  '    const a = e.message_seq ? !(e.message_seq.toString() === "0") : !!e.message_seq;',
  '    const u = await this.history(e);',
  '    if (u.length === 0) throw new Error(`消息${e.message_seq}不存在`);',
  '    return { messages: u };',
  '  }',
  '}',
  'class QuoteParser {',
  '  parse(e) {',
  '    this.core.context.logger.logWarn("似乎是旧版客户端，尝试仅通过序号获取引用消息", e.replayMsgSeq);',
  '    this.core.context.logger.logError("所有查找方法均失败，获取不到旧客户端的引用消息", e.replayMsgSeq);',
  '  }',
  '}',
].join('\n')

describe('NapCat 4.18.38 运行修复', () => {
  it.each(['GroupHistory', 'FriendHistory'])(
    '%s 的空历史正常返回，明确游标仍报错',
    async (name) => {
      const repaired = repairNapCatRuntimeSource(source)
      const Handler = new Function('re', `${repaired}\nreturn ${name};`)({}) as new () => {
        history: () => Promise<unknown[]>
        _handle: (params: { message_seq?: string }) => Promise<{ messages: unknown[] }>
      }
      const handler = new Handler()
      handler.history = async () => []
      await expect(handler._handle({})).resolves.toEqual({ messages: [] })
      await expect(handler._handle({ message_seq: '0' })).resolves.toEqual({ messages: [] })
      await expect(handler._handle({ message_seq: '123' })).rejects.toThrow('消息123不存在')
      handler.history = async () => [{ message_id: 123 }]
      await expect(handler._handle({ message_seq: '123' })).resolves.toEqual({
        messages: [{ message_id: 123 }],
      })
    },
  )

  it('重复启动不重复改写，并保留真正的引用查询失败日志', () => {
    const repaired = repairNapCatRuntimeSource(source)
    expect(repairNapCatRuntimeSource(repaired)).toBe(repaired)
    expect(repaired).toContain('logDebug("引用消息元数据不完整，尝试通过序号查询"')
    expect(repaired).toContain('logError("所有查找方法均失败，获取不到旧客户端的引用消息"')
  })

  it.each(['GroupHistory', 'FriendHistory'])(
    '打包变量改名及 CRLF 不影响 %s 的识别',
    async (name) => {
      const renamed = source
        .replace(/\bre\b/g, 'actions$')
        .replace(/\be\b/g, 'event$')
        .replace(/\ba\b/g, 'messages$')
        .replace(/\bo\b/g, 'hasCursor$')
        .replace(/\n/g, '\r\n')
      const repaired = repairNapCatRuntimeSource(renamed)
      expect(repairNapCatRuntimeSource(repaired)).toBe(repaired)
      const Handler = new Function('actions$', `${repaired}\nreturn ${name};`)({}) as new () => {
        history: () => Promise<unknown[]>
        _handle: (params: { message_seq?: string }) => Promise<{ messages: unknown[] }>
      }
      const handler = new Handler()
      handler.history = async () => []
      await expect(handler._handle({})).resolves.toEqual({ messages: [] })
      await expect(handler._handle({ message_seq: '123' })).rejects.toThrow('消息123不存在')
    },
  )

  it('不修改其他版本，已知版本的未知布局明确报错', () => {
    const newer = source.replace('4.18.38', '4.19.0')
    expect(repairNapCatRuntimeSource(newer)).toBe(newer)
    expect(() =>
      repairNapCatRuntimeSource(source.replace('actionName = re.GetFriendMsgHistory;', '')),
    ).toThrow('历史接口布局不匹配')
    expect(() =>
      repairNapCatRuntimeSource(source.replace('if (u.length === 0)', 'if (!u.length)')),
    ).toThrow('历史接口分支不匹配')
  })
})
