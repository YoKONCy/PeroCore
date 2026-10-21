import { afterEach, describe, expect, it } from 'vitest'
import {
  getLocale,
  normalizeLocale,
  onLocaleChange,
  registerCatalog,
  setLocale,
  translate,
  translateDiagnostic,
} from '../src/i18n'

afterEach(() => setLocale('zh-CN'))

describe('分类翻译运行时', () => {
  it('只选择简中、繁中与英文，并兼容浏览器语言标记', () => {
    expect(normalizeLocale('zh-HK')).toBe('zh-TW')
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-TW')
    expect(normalizeLocale('zh-TW,zh;q=0.8')).toBe('zh-TW')
    expect(normalizeLocale('en_GB')).toBe('en-US')
    expect(normalizeLocale('ja-JP')).toBe('zh-CN')
  })

  it('分类词库彼此隔离，缺少译文回退简中原文', () => {
    registerCatalog('test.actions', 'zh-CN', { 打开: '打开', 未译: '缺省文案' })
    registerCatalog('test.actions', 'en-US', { 打开: 'Open' })
    registerCatalog('test.status', 'en-US', { 打开: 'On' })
    setLocale('en-US')
    expect(translate('test.actions', '打开')).toBe('Open')
    expect(translate('test.status', '打开')).toBe('On')
    expect(translate('test.actions', '未译')).toBe('缺省文案')
    expect(translate('unknown', '未知原文')).toBe('未知原文')
  })

  it('插值参数保持原样，不二次解释用户文本、HTML、路径或占位符', () => {
    registerCatalog('test.parameters', 'en-US', { '文件 {0}：{1}': 'File {0}: {1}' })
    setLocale('en-US')
    expect(translate('test.parameters', '文件 {0}：{1}', ['工作区/主人.txt', '<b>{0}</b>'])).toBe(
      'File 工作区/主人.txt: <b>{0}</b>',
    )
  })

  it('只广播实际语言变化，取消订阅后不再调用', () => {
    const updates: string[] = []
    const stop = onLocaleChange((value) => updates.push(value))
    setLocale('en-US')
    setLocale('en-US')
    stop()
    setLocale('zh-TW')
    expect(updates).toEqual(['en-US'])
    expect(getLocale()).toBe('zh-TW')
  })

  it('异常仅在展示边界翻译，不修改异常原文、参数或业务错误码', () => {
    registerCatalog('errors.test', 'zh-CN', { '文件 {0} 无法读取': '文件 {0} 无法读取' })
    registerCatalog('errors.test', 'en-US', { '文件 {0} 无法读取': 'Cannot read file {0}' })
    const error = new Error('文件 主人的笔记.md 无法读取')
    expect(translateDiagnostic(error.message, 'en-US')).toBe('Cannot read file 主人的笔记.md')
    expect(error.message).toBe('文件 主人的笔记.md 无法读取')
    expect(translateDiagnostic('用户自己写的一段话', 'en-US')).toBe('用户自己写的一段话')
  })
})
