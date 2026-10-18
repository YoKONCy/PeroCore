import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PromptBundle } from '@infos/shared'
import type { ConfigRepository } from '../../../../src/repositories/config.repo'
import { MdpEngine } from '../../../../src/services/prompt/mdpEngine'
import { PromptWorkspace } from '../../../../src/services/prompt/promptWorkspace'
import { importSillyTavernPreset } from '../../../../src/services/prompt/sillyTavernPreset'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'infos-prompt-'))
  directories.push(directory)
  const values = new Map<string, string>()
  const repository = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => {
      values.set(key, value)
    },
    setJson: async (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value))
    },
  }
  mkdirSync(path.join(directory, 'components'), { recursive: true })
  writeFileSync(path.join(directory, 'components/a.md'), '内置 {{ data }}')
  const engine = new MdpEngine(directory, path.join(directory, 'agents'))
  const workspace = new PromptWorkspace(repository as unknown as ConfigRepository, engine)
  await workspace.initialize()
  const bundle: PromptBundle = {
    documents: [
      {
        id: 'components/a',
        name: '组件 A',
        kind: 'component',
        body: '旧版 {{ data }}',
        role: 'system',
        enabled: true,
        variables: ['data'],
      },
      {
        id: 'custom/b',
        name: '组件 B',
        kind: 'component',
        body: '替换 {{ data }}',
        role: 'system',
        enabled: true,
        variables: ['data'],
      },
    ],
    frameworks: [
      {
        id: 'custom.main',
        name: '自定义框架',
        bindings: [],
        blocks: [
          {
            id: 'a',
            name: '规则',
            kind: 'template',
            source: 'components/a',
            role: 'system',
            enabled: true,
          },
        ],
      },
    ],
    assignments: [{ agentId: '', channel: '', frameworkId: 'custom.main', overrides: {} }],
  }
  return { workspace, bundle, repository, values, engine }
}

describe('提示词工作区发布与装配边界', () => {
  it('随应用发布的台词更新模板语法有效', async () => {
    const { engine } = await setup()
    const body = readFileSync(
      new URL(
        '../../../../src/services/mdp/prompts/tasks/agent/waifu_text_updater.md',
        import.meta.url,
      ),
      'utf8',
    )
    expect(() => engine.validateTemplate(body)).not.toThrow()
  })

  it('原样保存的内置模板语法错误自动修正，历史发布记录与用户改写保持原样', async () => {
    const { engine, workspace, bundle, repository, values } = await setup()
    const directory = mkdtempSync(path.join(tmpdir(), 'infos-prompt-repair-'))
    directories.push(directory)
    const fixed = '{{ agent_name }}，你好。\n{{ persona_definition }}'
    const broken = '{{ agent_name }，你好。\n{{ persona_definition }}'
    writeFileSync(path.join(directory, 'waifu_text_updater.md'), fixed)
    engine.addTemplateRoot(directory, 'tasks/agent')
    const document = workspace
      .defaults()
      .documents.find((doc) => doc.id === 'tasks/agent/waifu_text_updater')!
    bundle.documents.push({ ...document, name: '我的台词任务', body: broken })
    values.set(
      'prompt.workspace.v1',
      JSON.stringify({
        revision: 4,
        draft: bundle,
        activeReleaseId: 'legacy',
        releases: [{ id: 'legacy', createdAt: new Date().toISOString(), note: '', bundle }],
      }),
    )
    const restored = new PromptWorkspace(repository as unknown as ConfigRepository, engine)
    await restored.initialize()
    const find = (source: PromptBundle) => source.documents.find((doc) => doc.id === document.id)!
    expect(find(restored.view().draft)).toMatchObject({ name: '我的台词任务', body: fixed })
    expect(find(restored.snapshot().bundle).body).toBe(fixed)
    expect(find(restored.release('legacy').bundle).body).toBe(broken)
    const saved = await restored.save(bundle, 4)
    expect(find(saved.draft).body).toBe(fixed)
    expect(restored.validate(saved.draft).filter((issue) => issue.level === 'error')).toEqual([])
    await restored.publish(5)
    expect(find(restored.snapshot().bundle).body).toBe(fixed)
    const custom = structuredClone(saved.draft)
    find(custom).body = broken + '\n用户自定义正文'
    const customized = await restored.save(custom, 6)
    expect(find(customized.draft).body).toBe(broken + '\n用户自定义正文')
    expect(
      restored
        .validate(customized.draft)
        .some((issue) => issue.source === document.id && issue.level === 'error'),
    ).toBe(true)
  })

  it('酒馆正文使用宏解析器，发布后仍保留自有编排与当前输入位置', async () => {
    const { workspace, bundle } = await setup()
    const imported = importSillyTavernPreset({
      prompts: [
        { identifier: 'main', content: '{{setvar::mood::开心}}{{char}}：{{getvar::mood}}' },
        { identifier: 'chatHistory', marker: true },
        { identifier: 'post', content: '后置要求', injection_position: 1, injection_depth: 0 },
      ],
    }).framework
    bundle.frameworks.push(imported)
    bundle.assignments[0]!.frameworkId = imported.id
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    const result = workspace.assemble(workspace.snapshot(), 'desktop', 'pero', {
      agent_name: 'Pero',
      current_message: { role: 'user', content: '本次问题' },
    })
    expect(result.format).toBe('sillytavern')
    expect(result.messages.map((message) => message.content)).toEqual([
      'Pero：开心',
      '本次问题',
      '【系统指令】\n后置要求',
    ])
    expect(result.messages[1]?.currentMessage).toBe(true)
    expect(result.preview.issues.some((issue) => issue.level === 'warning')).toBe(true)
  })

  it('未知酒馆宏与触发类型在保存后仍阻止发布', async () => {
    const { workspace, bundle } = await setup()
    const imported = importSillyTavernPreset({
      prompts: [
        { identifier: 'main', content: '{{hasExtension::custom}}', injection_trigger: ['future'] },
      ],
    }).framework
    bundle.frameworks.push(imported)
    await workspace.save(bundle, 0)
    await expect(workspace.publish(1)).rejects.toThrow('校验未通过')
    const issues = workspace.validate(workspace.view().draft)
    expect(issues.some((issue) => issue.message.includes('hasextension'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('future'))).toBe(true)
  })

  it('旧英文自动名称改为中文，保留用户改名、正文与历史发布原文', async () => {
    const { workspace, bundle, repository, values, engine } = await setup()
    const root = mkdtempSync(path.join(tmpdir(), 'infos-prompt-labels-'))
    directories.push(root)
    writeFileSync(path.join(root, 'environment_display.md'), '内置环境正文')
    writeFileSync(path.join(root, 'interaction_rules.md'), '内置交互正文')
    engine.addTemplateRoot(root, 'group')
    expect(
      workspace.defaults().documents.find((doc) => doc.id === 'group/environment_display')?.name,
    ).toBe('据点环境')
    bundle.documents.push(
      {
        id: 'group/environment_display',
        name: 'environment_display',
        kind: 'component',
        body: '用户修改后的环境正文',
        builtin: true,
        enabled: true,
        role: 'system',
        variables: [],
      },
      {
        id: 'group/interaction_rules',
        name: '我的据点约定',
        kind: 'component',
        body: '用户的交互正文',
        builtin: true,
        enabled: true,
        role: 'system',
        variables: [],
      },
    )
    values.set(
      'prompt.workspace.v1',
      JSON.stringify({
        revision: 3,
        draft: bundle,
        activeReleaseId: 'legacy',
        releases: [{ id: 'legacy', createdAt: new Date().toISOString(), note: '', bundle }],
      }),
    )
    const recovered = new PromptWorkspace(repository as unknown as ConfigRepository, engine)
    await recovered.initialize()
    expect(
      recovered.view().draft.documents.find((doc) => doc.id === 'group/environment_display'),
    ).toMatchObject({ name: '据点环境', body: '用户修改后的环境正文' })
    expect(
      recovered.snapshot().bundle.documents.find((doc) => doc.id === 'group/interaction_rules')
        ?.name,
    ).toBe('我的据点约定')
    expect(
      recovered
        .release('legacy')
        .bundle.documents.find((doc) => doc.id === 'group/environment_display')?.name,
    ).toBe('environment_display')
  })

  it('完整正文框架只输出声明的正文和原生历史，不附加内置提示词', async () => {
    const { workspace, bundle } = await setup()
    bundle.frameworks[0]!.bindings = []
    bundle.frameworks[0]!.blocks = [
      {
        id: 'prompt',
        name: '完整提示词',
        kind: 'template',
        template: '我的完整框架：{{ agent_name }}',
        role: 'system',
        enabled: true,
      },
      { id: 'history', name: '对话历史', kind: 'history', role: 'user', enabled: true },
    ]
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    const result = workspace.assemble(workspace.snapshot(), 'social', 'pero', {
      agent_name: 'Pero',
      persona_definition: '不应注入的人设',
      system_core: '不应注入的规则',
      capability_fragments: ['components/a'],
      native_history: [
        { role: 'user', content: '上一轮提问' },
        { role: 'assistant', content: '上一轮回复' },
      ],
    })
    expect(result.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'system', content: '我的完整框架：Pero' },
      { role: 'user', content: '上一轮提问' },
      { role: 'assistant', content: '上一轮回复' },
    ])
  })

  it('保存不生效；已捕获的版本不受新发布影响', async () => {
    const { workspace, bundle } = await setup()
    await workspace.save(bundle, 0)
    expect(workspace.snapshot().id).toBe('builtin')
    await workspace.publish(1)
    const old = workspace.snapshot()
    bundle.documents[0]!.body = '新版 {{ data }}'
    await workspace.save(bundle, 2)
    await workspace.publish(3)
    expect(workspace.assemble(old, 'desktop', 'pero', { data: '文本' }).messages[0]!.content).toBe(
      '旧版 文本',
    )
    expect(
      workspace.assemble(workspace.snapshot(), 'desktop', 'pero', { data: '文本' }).messages[0]!
        .content,
    ).toBe('新版 文本')
  })

  it('聊天数据中的模板语法不会再次执行', async () => {
    const { workspace, bundle } = await setup()
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    const result = workspace.assemble(workspace.snapshot(), 'desktop', 'pero', {
      data: '{{ secret }} {% if true %}原文{% endif %}',
      secret: '不能注入',
    })
    expect(result.messages[0]!.content).toBe('旧版 {{ secret }} {% if true %}原文{% endif %}')
  })

  it('空白框架不会自动追加内置人设或规则', async () => {
    const { workspace, bundle } = await setup()
    bundle.frameworks[0]!.blocks = []
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    expect(
      workspace.assemble(workspace.snapshot(), 'desktop', 'pero', {
        persona_definition: '不应出现',
      }).messages,
    ).toEqual([])
  })

  it('按角色与频道应用替换，预览指定框架也应用自身替换', async () => {
    const { workspace, bundle } = await setup()
    bundle.frameworks.push({
      id: 'custom.preview',
      name: '预览框架',
      overrides: { 'components/a': 'custom/b' },
      bindings: [],
      blocks: bundle.frameworks[0]!.blocks,
    })
    bundle.assignments.push({
      agentId: 'pero',
      channel: 'social',
      frameworkId: '',
      overrides: { 'components/a': 'custom/b' },
    })
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    const snapshot = workspace.snapshot()
    expect(
      workspace.assemble(snapshot, 'desktop', 'pero', { data: 'X' }).messages[0]!.content,
    ).toBe('旧版 X')
    expect(workspace.assemble(snapshot, 'social', 'pero', { data: 'X' }).messages[0]!.content).toBe(
      '替换 X',
    )
    expect(
      workspace.assemble(snapshot, 'desktop', 'pero', { data: 'X' }, 'custom.preview').messages[0]!
        .content,
    ).toBe('替换 X')
  })

  it('循环引用及 system 消息顺序错误阻止发布', async () => {
    const { workspace, bundle } = await setup()
    bundle.documents[0]!.body = '{{ component("custom/b") }}'
    bundle.documents[1]!.body = '{{ component("components/a") }}'
    await workspace.save(bundle, 0)
    await expect(workspace.publish(1)).rejects.toThrow('校验未通过')
    expect(workspace.snapshot().id).toBe('builtin')
    bundle.documents[0]!.body = 'A'
    bundle.documents[1]!.body = 'B'
    bundle.frameworks[0]!.blocks.unshift({
      id: 'history',
      name: '历史',
      kind: 'history',
      role: 'user',
      enabled: true,
    })
    expect(workspace.validate(bundle).some((issue) => issue.message.includes('system'))).toBe(true)
  })

  it('并发旧版本保存被拒绝；写盘失败不会替换当前状态', async () => {
    const { workspace, bundle, repository } = await setup()
    await workspace.save(bundle, 0)
    await expect(workspace.save(bundle, 0)).rejects.toThrow('其他页面')
    repository.setJson = async () => {
      throw new Error('模拟写盘失败')
    }
    await expect(workspace.publish(1)).rejects.toThrow('模拟写盘失败')
    expect(workspace.view().revision).toBe(1)
    expect(workspace.snapshot().id).toBe('builtin')
  })

  it('恢复版本只改变草稿，保留已发布版本', async () => {
    const { workspace, bundle } = await setup()
    await workspace.save(bundle, 0)
    await workspace.publish(1)
    const active = workspace.snapshot().id
    await workspace.restore('builtin', 2)
    expect(workspace.snapshot().id).toBe(active)
    expect(workspace.view().draft.frameworks[0]!.id).toBe('builtin.main')
  })

  it('原生图片历史保留图片输入，但预览不展开 base64', async () => {
    const { workspace, bundle } = await setup()
    bundle.frameworks[0]!.blocks.push({
      id: 'history',
      name: '历史',
      kind: 'history',
      role: 'user',
      enabled: true,
    })
    const parts = [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }]
    const result = workspace.assemble({ id: 'draft', bundle }, 'desktop', 'pero', {
      native_history: [{ role: 'user', content: parts }],
    })
    expect(result.messages[1]!.nativeContent).toEqual(parts)
    expect(result.preview.segments[1]!.content).toBe('[图片]')
  })

  it('损坏存储不静默回退，保存草稿后仍须发布才能恢复', async () => {
    const { repository, values, engine, bundle } = await setup()
    values.set('prompt.workspace.v1', '损坏的 JSON')
    const recovered = new PromptWorkspace(repository as unknown as ConfigRepository, engine)
    await recovered.initialize()
    expect(recovered.view().recoveryError).toBeTruthy()
    expect(() => recovered.snapshot()).toThrow('配置损坏')
    await recovered.save(bundle, 0)
    const restarted = new PromptWorkspace(repository as unknown as ConfigRepository, engine)
    await restarted.initialize()
    expect(() => restarted.snapshot()).toThrow('配置损坏')
    await restarted.publish(1)
    expect(restarted.snapshot().bundle.assignments[0]!.frameworkId).toBe('custom.main')
  })
})
