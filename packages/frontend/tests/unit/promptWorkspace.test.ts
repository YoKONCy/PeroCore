// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptBundle, PromptWorkspaceView } from '@infos/shared'
import { usePromptWorkspace } from '../../src/composables/dashboard/usePromptWorkspace'
import { promptApi } from '../../src/api/modules/promptApi'
import { isPromptFramework } from '../../src/lib/promptDraft'

vi.mock('../../src/api/modules/promptApi', () => ({
  promptApi: {
    get: vi.fn(),
    publish: vi.fn(),
    save: vi.fn(),
    importSillyTavern: vi.fn(),
    exportSillyTavern: vi.fn(),
    validate: vi.fn(),
  },
}))
vi.mock('../../src/stores/useNotificationStore', () => ({
  useNotificationStore: () => ({ toast: vi.fn() }),
}))
const wrappers: Array<{ unmount(): void }> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function setup() {
  const bundle: PromptBundle = {
    documents: [],
    frameworks: [
      { id: 'builtin.main', name: '内置主框架', builtin: true, bindings: [], blocks: [] },
      { id: 'builtin.social', name: '内置社交框架', builtin: true, bindings: [], blocks: [] },
    ],
    assignments: [
      { agentId: '', channel: '', frameworkId: 'builtin.main', overrides: {} },
      {
        agentId: '',
        channel: 'social',
        frameworkId: 'builtin.social',
        overrides: { 'tasks/source': 'custom/task' },
      },
      { agentId: 'pero', channel: 'desktop', frameworkId: 'builtin.main', overrides: {} },
    ],
  }
  const view: PromptWorkspaceView = {
    revision: 0,
    activeReleaseId: 'builtin',
    draft: bundle,
    defaults: bundle,
    releases: [],
    variables: [],
  }
  vi.mocked(promptApi.get).mockResolvedValue({ code: 'OK', message: '', data: view })
  let workspace!: ReturnType<typeof usePromptWorkspace>
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          workspace = usePromptWorkspace()
          return () => h('div')
        },
      }),
    ),
  )
  await flushPromises()
  return workspace
}

const options = () => ({
  name: '我的框架',
  body: '直接写完整提示词 {{ agent_name }}',
  history: true,
  layout: 'text' as const,
  scope: 'all' as const,
  agentId: '',
  channel: '',
})

describe('独立提示词框架创建与指派', () => {
  it('酒馆扩展配置进入编辑器前检查结构，拒绝损坏的角色资料和原型名称', () => {
    const framework = {
      id: 'st',
      name: '酒馆',
      bindings: [],
      blocks: [],
      format: 'sillytavern',
      sillyTavern: {
        markerBindings: {},
        values: {},
        utility: { new_chat_prompt: '新会话' },
        characters: { pero: { main: '{{original}}', examples: '<START>' } },
      },
    }
    expect(isPromptFramework(framework)).toBe(true)
    expect(
      isPromptFramework({
        ...framework,
        sillyTavern: { ...framework.sillyTavern, characters: '错误格式' },
      }),
    ).toBe(false)
    expect(
      isPromptFramework({
        ...framework,
        sillyTavern: {
          ...framework.sillyTavern,
          characters: { constructor: { main: '不能修改原型' } },
        },
      }),
    ).toBe(false)
  })

  it('酒馆导入先审阅，再增量加入草稿，不替换已有框架或自动发布', async () => {
    const workspace = await setup()
    const framework = {
      id: 'custom.st.import',
      name: '酒馆预设',
      format: 'sillytavern' as const,
      bindings: [],
      blocks: [],
      sillyTavern: { markerBindings: {}, values: {}, sourcePreset: { temperature: 0.5 } },
    }
    vi.mocked(promptApi.importSillyTavern).mockResolvedValue({
      code: 'OK',
      message: '',
      data: { framework, issues: [], orderProfiles: [] },
    })
    await workspace.importBundle({
      name: '酒馆.json',
      size: 50,
      text: async () => JSON.stringify({ prompts: [{ identifier: 'main' }] }),
    } as File)
    expect(workspace.stImportOpen.value).toBe(true)
    expect(workspace.bundle.value.frameworks).toHaveLength(2)
    expect(workspace.commitStImport({ scope: 'later', agentId: '', channel: '' })).toBe(true)
    expect(workspace.bundle.value.frameworks).toHaveLength(3)
    expect(workspace.framework.value?.format).toBe('sillytavern')
    expect(workspace.bundle.value.assignments[0]!.frameworkId).toBe('builtin.main')
    expect(promptApi.save).not.toHaveBeenCalled()
    expect(promptApi.publish).not.toHaveBeenCalled()
  })

  it('三种框架格式分别创建，酒馆宏不进入原生数据装配', async () => {
    const workspace = await setup()
    workspace.createIndependent({
      ...options(),
      format: 'sillytavern',
      scope: 'later',
      body: '{{char}}',
    })
    expect(workspace.framework.value).toMatchObject({ format: 'sillytavern', bindings: [] })
    expect(workspace.framework.value?.blocks.map((block) => block.stIdentifier)).toEqual([
      'main',
      'chatHistory',
    ])
    workspace.createIndependent({ ...options(), format: 'infos', scope: 'later' })
    expect(workspace.framework.value?.format).toBe('infos')
    expect(workspace.framework.value?.blocks).toEqual(
      workspace.view.value!.defaults.frameworks[0]!.blocks,
    )
    workspace.setFormatFilter('sillytavern')
    expect(
      workspace.resources.value.every((item) => 'format' in item && item.format === 'sillytavern'),
    ).toBe(true)
  })

  it('完整正文不依赖内置组件，全部对话也更新社交及角色指派，保留任务替换', async () => {
    const workspace = await setup()
    expect(workspace.createIndependent(options())).toBe(true)
    const framework = workspace.framework.value!
    expect(framework.builtin).toBe(false)
    expect(framework.bindings).toEqual([])
    expect(framework.blocks.map((block) => block.kind)).toEqual(['template', 'history'])
    expect(framework.blocks[0]).toMatchObject({ template: options().body, role: 'system' })
    expect(framework.blocks.every((block) => !block.source)).toBe(true)
    expect(
      workspace.bundle.value.assignments.every((scope) => scope.frameworkId === framework.id),
    ).toBe(true)
    expect(workspace.bundle.value.assignments[1]!.overrides).toEqual({
      'tasks/source': 'custom/task',
    })
    expect(promptApi.publish).not.toHaveBeenCalled()
  })

  it('指定范围只修改目标指派，空白编排新增系统区块位于历史之前', async () => {
    const workspace = await setup()
    workspace.createIndependent({
      ...options(),
      layout: 'blocks',
      scope: 'range',
      agentId: 'nana',
      channel: 'desktop',
    })
    expect(workspace.bundle.value.assignments[0]!.frameworkId).toBe('builtin.main')
    expect(workspace.bundle.value.assignments[1]!.frameworkId).toBe('builtin.social')
    expect(
      workspace.bundle.value.assignments.find((scope) => scope.agentId === 'nana')?.frameworkId,
    ).toBe(workspace.framework.value!.id)
    workspace.addBlock()
    expect(workspace.framework.value!.blocks.map((block) => block.kind)).toEqual([
      'template',
      'history',
    ])
  })

  it('源码无效时创建与指派都不改变当前配置', async () => {
    const workspace = await setup()
    workspace.setMode('source')
    workspace.source.value = '尚未完成的 JSON'
    const original = JSON.stringify(workspace.bundle.value)
    expect(workspace.createIndependent(options())).toBe(false)
    expect(workspace.assignSelectedFramework('nana', 'social')).toBe(false)
    expect(JSON.stringify(workspace.bundle.value)).toBe(original)
    expect(workspace.error.value).toBeTruthy()
  })
})
