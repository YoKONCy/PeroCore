import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PromptFramework, PromptVariableCommit, PromptVariableState } from '@infos/shared'
import type { ConfigRepository } from '../../../../src/repositories/config.repo'
import { SillyTavernMacros } from '../../../../src/services/prompt/sillyTavernMacros'
import { SillyTavernVariableStore } from '../../../../src/services/prompt/sillyTavernVariables'
import {
  importSillyTavernPreset,
  exportSillyTavernPreset,
} from '../../../../src/services/prompt/sillyTavernPreset'
import { assembleSillyTavern } from '../../../../src/services/prompt/sillyTavernFramework'

function engine(state?: PromptVariableState) {
  return new SillyTavernMacros({ agent_name: 'Pero', owner_name: '用户' }, {}, 'seed', state)
}
function store() {
  const values = new Map<string, string>()
  let fail = false
  const repository = {
    get: async (key: string) => values.get(key),
    setJson: async (key: string, value: unknown) => {
      if (fail) throw new Error('模拟写盘失败')
      values.set(key, JSON.stringify(value))
    },
  }
  return {
    variables: new SillyTavernVariableStore(repository as ConfigRepository),
    failNext: () => {
      fail = true
    },
  }
}
const commit = (scope: string, macros: SillyTavernMacros, epoch = 0): PromptVariableCommit => ({
  id: randomUUID(),
  scope,
  epoch,
  effects: macros.effects(),
})

describe('酒馆条件块、作用域与变量简写', () => {
  it('条件只执行被选分支，嵌套比较与否定可组合', () => {
    const macros = engine()
    const source =
      '{{.score = 4}}{{if .score >= 3}}通过{{if !.missing}}！{{else}}错误{{/if}}{{else}}{{setglobalvar::污染::是}}{{/if}}'
    expect(macros.inspect(source)).toEqual([])
    expect(macros.render(source)).toBe('通过！')
    expect(macros.render('{{hasglobalvar::污染}}')).toBe('false')
  })
  it('默认值短路，未采用的默认表达式没有副作用', () => {
    const macros = engine()
    expect(
      macros.render('{{.name = 已有}}{{.name ||= {{setvar::bad::污染}}备用}}{{.missing ??= 备用}}'),
    ).toBe('已有备用')
    expect(macros.render('{{hasvar::bad}}/{{.missing}}')).toBe('false/备用')
    expect(macros.render('{{.empty = }}{{.empty ?? 默认}}/{{.empty || 默认}}')).toBe('/默认')
  })
  it('块式赋值支持去缩进与显式保留空白，递增递减不吞变量名', () => {
    const macros = engine()
    expect(macros.render('{{setvar::note}}\n  第一行\n  第二行\n{{/setvar}}{{getvar::note}}')).toBe(
      '第一行\n第二行',
    )
    expect(
      macros.render('{{#setglobalvar::code}}\n  保留缩进\n{{/setglobalvar}}{{getglobalvar::code}}'),
    ).toBe('\n  保留缩进\n')
    expect(macros.render('{{.n = 3}}{{.n--}}/{{.n++}}{{.n += 5}}{{.n -= 2}}/{{.n}}')).toBe('2/3/6')
    expect(macros.render('{{setvar::list::[]}}{{addvar::list::一}}{{.list}}')).toBe('["一"]')
  })
  it('不完整块明确失败，注释与数据不会执行内部宏', () => {
    expect(() => engine().inspect('{{if yes}}缺失结束')).toThrow('结束块')
    expect(() => engine().inspect('{{if yes}}甲{{else}}乙{{else}}丙{{/if}}')).toThrow('一个 else')
    expect(
      engine().render('{{//}}{{setglobalvar::secret::污染}}{{///}}{{hasglobalvar::secret}}'),
    ).toBe('false')
    expect(engine().render('{{if yes}}{{//}}{{/if}}{{///}}正文{{ / if }}')).toBe('正文')
    const macros = new SillyTavernMacros(
      { owner_name: '{{setglobalvar::secret::污染}}' },
      {},
      'seed',
    )
    expect(macros.render('<USER> \\{\\{literal\\}\\} {{hasglobalvar::secret}}')).toBe(
      '{{setglobalvar::secret::污染}} {{literal}} false',
    )
  })
})

describe('酒馆变量持久化边界', () => {
  it('未提交的预览不改存储，聊天隔离且全局共享，重复提交不叠加', async () => {
    const { variables } = store()
    const first = engine(await variables.snapshot('desktop:pero:a'))
    first.render('{{incvar::local}}{{incglobalvar::shared}}')
    expect((await variables.snapshot('desktop:pero:a')).local).toEqual({})
    const change = commit('desktop:pero:a', first)
    await variables.commit(change)
    await variables.commit(change)
    expect(await variables.snapshot('desktop:pero:a')).toMatchObject({
      local: { local: '1' },
      global: { shared: '1' },
    })
    expect(await variables.snapshot('desktop:pero:b')).toMatchObject({
      local: {},
      global: { shared: '1' },
    })
  })
  it('并发读取过期时整体拒绝，不局部写入聊天或全局变量', async () => {
    const { variables } = store()
    const a = engine(await variables.snapshot('a')),
      b = engine(await variables.snapshot('b'))
    a.render('{{incglobalvar::n}}')
    b.render('{{setvar::local::不能写入}}{{incglobalvar::n}}')
    await variables.commit(commit('a', a))
    await expect(variables.commit(commit('b', b))).rejects.toThrow('另一轮对话')
    expect(await variables.snapshot('b')).toMatchObject({ local: {}, global: { n: '1' } })
  })
  it('重置与删除会话后，旧回合不能恢复已清理变量', async () => {
    const { variables } = store()
    const first = engine(await variables.snapshot('desktop:pero:thread'))
    first.render('{{setvar::x::值}}{{setglobalvar::g::保留}}')
    await variables.commit(commit('desktop:pero:thread', first))
    const late = engine(await variables.snapshot('desktop:pero:thread'))
    late.render('{{incvar::x}}')
    await variables.removeThread('thread')
    await expect(variables.commit(commit('desktop:pero:thread', late))).rejects.toThrow(
      '会话已删除',
    )
    expect(await variables.snapshot('desktop:pero:thread')).toMatchObject({
      local: {},
      global: { g: '保留' },
    })
    const old = engine(await variables.snapshot('other'))
    old.render('{{setvar::stale::旧值}}')
    await variables.reset()
    await expect(variables.commit(commit('other', old))).rejects.toThrow('重置')
  })
  it('写盘失败不会推进状态', async () => {
    const { variables, failNext } = store()
    const macros = engine(await variables.snapshot('scope'))
    macros.render('{{setglobalvar::n::1}}')
    failNext()
    await expect(variables.commit(commit('scope', macros))).rejects.toThrow('模拟写盘失败')
    expect((await variables.snapshot('scope')).global).toEqual({})
  })
})

const input = {
  agent_id: 'pero',
  agent_name: 'Pero',
  owner_name: '用户',
  current_message: { role: 'user', content: '问题' },
  generation_type: 'normal',
}
function preset(): PromptFramework {
  return importSillyTavernPreset({
    new_chat_prompt: '新聊天',
    new_example_chat_prompt: '示例',
    personality_format: '性格：{{personality}}',
    prompts: [
      { identifier: 'main', content: '原提示词 {{char}}' },
      { identifier: 'charPersonality', marker: true },
      { identifier: 'dialogueExamples', marker: true },
      { identifier: 'chatHistory', marker: true },
      { identifier: 'jailbreak', content: '原历史后要求' },
    ],
  }).framework
}

describe('辅助提示词、示例与角色覆盖', () => {
  it('辅助字段导入后参与组装并可回写，示例分为独立角色消息', () => {
    const framework = preset()
    framework.sillyTavern!.characters = {
      pero: {
        personality: '活泼',
        examples: '<START>\n{{user}}: 示例问题\n{{char}}: 示例回答\n第二行',
      },
    }
    const result = assembleSillyTavern(framework, 'draft', input)
    expect(result.messages.map((message) => message.content)).toEqual([
      '原提示词 Pero',
      '性格：活泼',
      '示例',
      '示例问题',
      '示例回答\n第二行',
      '【系统指令】\n新聊天',
      '问题',
      '【系统指令】\n原历史后要求',
    ])
    expect(result.messages[3]?.role).toBe('user')
    expect(result.messages[4]?.role).toBe('assistant')
    framework.sillyTavern!.utility!.new_chat_prompt = '新版分隔'
    expect(exportSillyTavernPreset(framework).new_chat_prompt).toBe('新版分隔')
  })
  it('角色覆盖可引用原文，原文只展开一次；禁止覆盖仍保留预设正文', () => {
    const framework = preset()
    framework.blocks[0]!.template = '{{incvar::calls}} {{char}}'
    framework.sillyTavern!.characters = {
      pero: { main: '{{original}} / {{original}}', postHistory: '角色后置要求' },
    }
    const result = assembleSillyTavern(framework, 'draft', input)
    expect(result.messages[0]?.content).toBe('1 Pero / 1 Pero')
    expect(result.variableEffects.local.find((item) => item.name === 'calls')?.after).toBe('1')
    expect(result.messages.at(-1)?.content).toBe('【系统指令】\n角色后置要求')
    framework.blocks[0]!.forbidOverrides = true
    expect(assembleSillyTavern(framework, 'draft', input).messages[0]?.content).toBe('1 Pero')
  })
  it('空消息替代与显式续写提示生效，但不重复添加本次输入', () => {
    const framework = preset()
    framework.sillyTavern!.utility = {
      send_if_empty: '继续',
      continue_nudge_prompt: '不重复上一段',
    }
    const result = assembleSillyTavern(framework, 'draft', {
      ...input,
      generation_type: 'continue',
      current_message: { role: 'user', content: '' },
    })
    expect(
      result.messages.filter((message) => message.currentMessage).map((message) => message.content),
    ).toEqual(['继续'])
    expect(result.messages.at(-1)?.content).toBe('【系统指令】\n不重复上一段')
  })
})
