import { describe, expect, it } from 'vitest'
import type { PromptBlock, PromptFramework } from '@infos/shared'
import {
  importSillyTavernPreset,
  exportSillyTavernPreset,
} from '@infos/backend/services/prompt/sillyTavernPreset'
import { SillyTavernMacros } from '@infos/backend/services/prompt/sillyTavernMacros'
import {
  assembleSillyTavern,
  sillyTavernIssues,
} from '@infos/backend/services/prompt/sillyTavernFramework'

const prompt = (id: string, content: string, extra: Partial<PromptBlock> = {}): PromptBlock => ({
  id,
  stIdentifier: id,
  name: id,
  kind: 'template',
  role: 'system',
  enabled: true,
  template: content,
  ...extra,
})
const history = (): PromptBlock => ({
  id: 'history',
  stIdentifier: 'chatHistory',
  name: '对话历史',
  kind: 'history',
  role: 'user',
  enabled: true,
})
const framework = (blocks: PromptBlock[]): PromptFramework => ({
  id: 'custom.st',
  name: '酒馆测试',
  format: 'sillytavern',
  bindings: [],
  blocks,
  sillyTavern: { markerBindings: {}, values: {} },
})
const context = () => ({
  agent_name: 'Pero',
  owner_name: '用户',
  prompt_seed: 'stable',
  generation_type: 'normal',
  native_history: [
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '旧回答' },
  ],
  current_message: { role: 'user', content: '新问题' },
})
const contents = (item: PromptFramework, input = context()) =>
  assembleSillyTavern(item, 'draft', input).messages.map((message) => message.content)

describe('酒馆预设导入导出', () => {
  it('选用当前排序方案，保留未知参数且未列入排序的条目保持停用', () => {
    const preset = {
      temperature: 0.7,
      custom_connection: { endpoint: 'https://example.test', unknown: 2 },
      prompts: [
        {
          identifier: 'main',
          name: '主提示词',
          role: 'system',
          content: '{{char}}',
          vendor_field: '保留',
          system_prompt: false,
        },
        { identifier: 'chatHistory', marker: true },
        { identifier: 'extra', content: '暂不用' },
      ],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: 'extra', enabled: true }] },
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
        },
      ],
    }
    const imported = importSillyTavernPreset(preset)
    expect(imported.framework.blocks.map((block) => [block.stIdentifier, block.enabled])).toEqual([
      ['main', true],
      ['chatHistory', true],
      ['extra', false],
    ])
    imported.framework.blocks[0]!.template = '新版 {{char}}'
    const exported = exportSillyTavernPreset(imported.framework)
    expect(exported).toMatchObject({
      temperature: 0.7,
      custom_connection: preset.custom_connection,
    })
    expect((exported.prompts as object[])[0]).toMatchObject({
      content: '新版 {{char}}',
      vendor_field: '保留',
      system_prompt: false,
    })
    expect((exported.prompt_order as Array<{ order: unknown[] }>)[0]!.order).toEqual(
      preset.prompt_order[0]!.order,
    )
    expect(preset.prompts[0]!.content).toBe('{{char}}')
  })
  it('拒绝缺失的排序引用和重复标识，不导入半份结构', () => {
    expect(() =>
      importSillyTavernPreset({
        prompts: [{ identifier: 'a' }],
        prompt_order: [{ order: [{ identifier: 'missing' }] }],
      }),
    ).toThrow('不存在')
    expect(() =>
      importSillyTavernPreset({ prompts: [{ identifier: 'a' }, { identifier: 'a' }] }),
    ).toThrow('重复')
  })
  it('未知触发类型保留在草稿，启用时阻止发布，停用时仍保留警告', () => {
    const imported = importSillyTavernPreset({
      prompts: [{ identifier: 'main', content: '正文', injection_trigger: ['future-mode'] }],
    })
    expect(imported.framework.blocks[0]!.triggers).toEqual(['future-mode'])
    expect(sillyTavernIssues(imported.framework, []).some((issue) => issue.level === 'error')).toBe(
      true,
    )
    imported.framework.blocks[0]!.enabled = false
    expect(sillyTavernIssues(imported.framework, []).some((issue) => issue.level === 'error')).toBe(
      false,
    )
    expect(
      sillyTavernIssues(imported.framework, []).some((issue) => issue.level === 'warning'),
    ).toBe(true)
  })
  it('旧版主提示词转换后可编辑，Text Completion 格式明确拒绝', () => {
    expect(
      importSillyTavernPreset({
        main_prompt: '主提示词',
        jailbreak_prompt: '历史后指令',
      }).framework.blocks.map((block) => block.kind),
    ).toEqual(['template', 'template', 'history', 'template'])
    expect(() => importSillyTavernPreset({ system_sequence: '指令模板' })).toThrow(
      'Text Completion',
    )
  })
  it('标识保留名称无法进入数据映射', () => {
    expect(() =>
      importSillyTavernPreset({ prompts: [{ identifier: '__proto__', marker: true }] }),
    ).toThrow('保留名称')
  })
})

describe('酒馆宏边界', () => {
  it('嵌套和本轮变量按原文展开，用户数据不会再次执行宏', () => {
    const macros = new SillyTavernMacros(
      { agent_name: 'Pero', owner_name: '{{setvar::secret::污染}}' },
      {},
      'seed',
    )
    expect(
      macros.render(
        '{{ setvar :: {{char}}_mood :: 开心 }}{{getvar::Pero_mood}} / {{user}} / {{getvar::secret}}',
      ),
    ).toBe('开心 / {{setvar::secret::污染}} / ')
    expect(new SillyTavernMacros({}, {}, 'seed').render('{{getvar::Pero_mood}}')).toBe('')
  })
  it('数值与字符串变量、存在性检查及删除具有确定结果', () => {
    const macros = new SillyTavernMacros({}, {}, 'seed')
    expect(macros.render('{{incvar::n}}{{addvar::n::2}}{{decvar::n}}')).toBe('12')
    expect(
      macros.render('{{addvar::s::文字}}{{getvar::s}}/{{hasvar::s}}{{deletevar::s}}/{{hasvar::s}}'),
    ).toBe('文字/true/false')
  })
  it('种子固定时随机结果可复现；不运行全局变量与扩展语法', () => {
    const source = '{{random::a::b::c}} {{pick::一::二}} {{roll::2d20}}'
    expect(new SillyTavernMacros({}, {}, 'seed').render(source)).toBe(
      new SillyTavernMacros({}, {}, 'seed').render(source),
    )
    expect(
      new SillyTavernMacros({}, {}, 'seed').inspect('{{hasExtension::未知扩展}} {{instructStop}}'),
    ).toEqual(['hasextension', 'instructstop'])
    expect(() => new SillyTavernMacros({}, {}, 'seed').render('{{setvar::__proto__::x}}')).toThrow(
      '变量名无效',
    )
  })
  it('评论不执行内部宏；残缺宏和超量宏明确失败', () => {
    const macros = new SillyTavernMacros({}, {}, 'seed')
    expect(macros.render('{{// {{setvar::x::污染}}}}{{getvar::x}}')).toBe('')
    expect(() => macros.render('{{char')).toThrow('结束符')
    expect(() => macros.render('{{space::1000}}')).toThrow('数量')
    expect(() => macros.inspect('{{time::UTC+8}}')).toThrow('暂不支持参数')
    expect(() => macros.render('{{space}}'.repeat(20_001))).toThrow('次数')
  })
})

describe('酒馆历史插入与多模态消息', () => {
  it('深度包含当前输入，深度零在当前输入之后，晚系统消息有明确适配标记', () => {
    const item = framework([
      prompt('main', '主提示词'),
      history(),
      prompt('at-one', '深度一', { position: 'in_chat', depth: 1, role: 'assistant' }),
      prompt('at-zero', '深度零', { position: 'in_chat', depth: 0 }),
      prompt('post', '历史后指令'),
    ])
    const assembled = assembleSillyTavern(item, 'draft', context())
    expect(assembled.messages.map((message) => message.content)).toEqual([
      '主提示词',
      '旧问题',
      '旧回答',
      '深度一',
      '新问题',
      '【系统指令】\n深度零',
      '【系统指令】\n历史后指令',
    ])
    expect(assembled.messages.findIndex((message) => message.currentMessage)).toBe(4)
    expect(assembled.preview.segments.at(-1)).toMatchObject({
      role: 'user',
      originalRole: 'system',
    })
  })
  it('同深度先按顺序再按助手、用户、系统排序，同组内容合并', () => {
    const item = framework([
      history(),
      prompt('s', '系统', { position: 'in_chat', depth: 1 }),
      prompt('u', '用户', { position: 'in_chat', depth: 1, role: 'user' }),
      prompt('a', '助手', { position: 'in_chat', depth: 1, role: 'assistant' }),
      prompt('a2', '助手二', { position: 'in_chat', depth: 1, role: 'assistant' }),
      prompt('first', '更早', { position: 'in_chat', depth: 1, order: 1, role: 'user' }),
    ])
    expect(contents(item)).toEqual([
      '旧问题',
      '旧回答',
      '更早',
      '助手\n助手二',
      '用户',
      '【系统指令】\n系统',
      '新问题',
    ])
  })
  it('关闭历史也保留当前输入；触发过滤不会重新追加两次当前消息', () => {
    const item = framework([
      prompt('main', '普通', { triggers: ['normal'] }),
      history(),
      prompt('quiet', '后台', { triggers: ['quiet'], role: 'user' }),
    ])
    item.blocks[1]!.enabled = false
    expect(contents(item)).toEqual(['普通', '新问题'])
    expect(contents(item, { ...context(), generation_type: 'quiet' })).toEqual(['新问题', '后台'])
    expect(contents(framework([]))).toEqual(['新问题'])
  })
  it('原生图片部分仍送入模型，预览只展示占位文本', () => {
    const parts = [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }]
    const result = assembleSillyTavern(framework([history()]), 'draft', {
      ...context(),
      current_message: { role: 'user', content: parts },
    })
    expect(result.messages.at(-1)?.nativeContent).toEqual(parts)
    expect(result.messages.at(-1)?.currentMessage).toBe(true)
    expect(result.preview.segments.at(-1)?.content).toBe('[图片]')
    expect(JSON.stringify(result.preview)).not.toContain('base64')
  })
  it('未映射的数据标记留空并报告，手动文本不会解释为宏', () => {
    const item = framework([
      prompt('world', '', { kind: 'marker', marker: 'worldInfoBefore' }),
      history(),
    ])
    expect(sillyTavernIssues(item, []).some((issue) => issue.message.includes('未绑定'))).toBe(true)
    item.sillyTavern!.markerBindings.worldInfoBefore = '$text'
    item.sillyTavern!.values.worldInfoBefore = '{{char}} 原文'
    expect(contents(item)[0]).toBe('{{char}} 原文')
  })
})
