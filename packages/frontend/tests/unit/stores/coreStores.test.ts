import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentListItem } from '@perocore/frontend/api/modules/agentApi'
import type { Notification } from '@perocore/frontend/stores/useNotificationStore'
import type { ChatMessage, GenerationState } from '@perocore/frontend/stores/useThreadStore'

type RefValue<T> = { value: T }

type NotificationTestStore = {
  toasts: RefValue<Notification[]>
  modal: RefValue<Notification | null>
  toast: (message: string, opts?: { type?: string; title?: string; duration?: number }) => void
  showModal: (message: string, title?: string, type?: string) => void
  closeModal: () => void
  notifyByCode: (code: string, message: string) => void
}

type ConfigTestStore = {
  cache: RefValue<Record<string, unknown>>
  isLoading: RefValue<boolean>
  getConfig: <T = unknown>(key: string, forceRefresh?: boolean) => Promise<T | undefined>
  setConfig: (key: string, value: unknown) => Promise<boolean>
  loadBatch: (keys: string[]) => Promise<void>
  clearCache: () => void
}

type AgentTestStore = {
  agents: RefValue<AgentListItem[]>
  activeAgentId: RefValue<string>
  isLoading: RefValue<boolean>
  error: RefValue<string | null>
  currentAgent: RefValue<AgentListItem | null>
  enabledAgents: RefValue<AgentListItem[]>
  fetchAgents: () => Promise<void>
  switchAgent: (agentId: string) => Promise<void>
}

type ThreadTestStore = {
  threadId: RefValue<string>
  channel: RefValue<string>
  messages: RefValue<ChatMessage[]>
  generationState: RefValue<GenerationState>
  isGenerating: RefValue<boolean>
  streamingMessageId: RefValue<string | null>
  addMessage: (msg: ChatMessage) => void
  appendToLast: (content: string) => void
  finishStreaming: () => void
  editMessage: (id: string, newContent: string) => void
  deleteMessage: (id: string) => void
  startThread: (newThreadId: string, newChannel?: string) => void
}

const vueState = vi.hoisted(() => ({
  stores: new Map<string, unknown>(),
}))

const apiMocks = vi.hoisted(() => ({
  agentList: vi.fn(),
  // 第七阶段修复（批次 C）：agentApi.setActive 已删除，改用 runtimeApi.setWindowAgent
  runtimeSetWindowAgent: vi.fn(),
  configGet: vi.fn(),
  configSet: vi.fn(),
  configBatch: vi.fn(),
  chatEditMessage: vi.fn(),
  chatDeleteMessage: vi.fn(),
  loggerError: vi.fn(),
}))

// 第七阶段修复（批次 C）：useAgentStore.getWindowId 依赖 localStorage
// 测试环境（node）无 localStorage，需要提供最小 mock
const localStorageMock = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
  }
})
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

vi.mock('vue', () => ({
  ref: <T>(value: T) => ({ value }),
  shallowRef: <T>(value: T) => ({ value }),
  computed: <T>(getter: () => T) => ({
    get value() {
      return getter()
    },
  }),
}))

vi.mock('pinia', () => ({
  defineStore: (id: string, setup: () => unknown) => () => {
    if (!vueState.stores.has(id)) {
      vueState.stores.set(id, setup())
    }
    return vueState.stores.get(id)
  },
}))

vi.mock('@perocore/frontend/api/modules/agentApi', () => ({
  agentApi: {
    list: apiMocks.agentList,
    // 第七阶段修复（批次 C）：setActive 已删除，不再 mock
  },
}))

// 第七阶段修复（批次 C）：新增 runtimeApi mock
vi.mock('@perocore/frontend/api/modules/runtimeApi', () => ({
  runtimeApi: {
    setWindowAgent: apiMocks.runtimeSetWindowAgent,
  },
}))

vi.mock('@perocore/frontend/api/modules/configApi', () => ({
  configApi: {
    get: apiMocks.configGet,
    set: apiMocks.configSet,
    batch: apiMocks.configBatch,
  },
}))

vi.mock('@perocore/frontend/api/modules/chatApi', () => ({
  chatApi: {
    editMessage: apiMocks.chatEditMessage,
    deleteMessage: apiMocks.chatDeleteMessage,
  },
}))

// 屏蔽 threadsApi 以避免 transport.ts 在 node 测试环境引用 window
vi.mock('@perocore/frontend/api/modules/threadsApi', () => ({
  threadsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    getLatest: vi.fn(),
  },
}))

vi.mock('@perocore/frontend/lib/logger', () => ({
  logger: {
    error: apiMocks.loggerError,
  },
}))

import { useAgentStore } from '@perocore/frontend/stores/useAgentStore'
import { useConfigStore } from '@perocore/frontend/stores/useConfigStore'
import { useNotificationStore } from '@perocore/frontend/stores/useNotificationStore'
import { useThreadStore } from '@perocore/frontend/stores/useThreadStore'

describe('useNotificationStore', () => {
  beforeEach(() => {
    vueState.stores.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-27T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当添加 toast 并在延迟后自动移除', () => {
    const store = useNotificationStore() as unknown as NotificationTestStore

    store.toast('保存成功', { type: 'success', title: '完成', duration: 100 })

    expect(store.toasts.value).toHaveLength(1)
    expect(store.toasts.value[0]).toMatchObject({
      type: 'success',
      severity: 'toast',
      title: '完成',
      message: '保存成功',
      duration: 100,
    })

    vi.advanceTimersByTime(100)

    expect(store.toasts.value).toHaveLength(0)
  })

  it('应当显示和关闭模态通知', () => {
    const store = useNotificationStore() as unknown as NotificationTestStore

    store.showModal('数据库异常', '系统错误', 'error')
    expect(store.modal.value).toMatchObject({
      type: 'error',
      severity: 'modal',
      title: '系统错误',
      message: '数据库异常',
      duration: 0,
    })

    store.closeModal()

    expect(store.modal.value).toBeNull()
  })

  it('应当按错误码分级显示通知', () => {
    const store = useNotificationStore() as unknown as NotificationTestStore

    store.notifyByCode('UNAUTHORIZED', '需要登录')
    store.notifyByCode('VALIDATION_ERROR', '参数错误')
    store.notifyByCode('UNKNOWN_CODE', '未知错误')

    expect(store.modal.value?.title).toBe('错误: UNAUTHORIZED')
    expect(store.toasts.value.map((toast) => toast.message)).toEqual(['参数错误', '未知错误'])
  })
})

describe('useConfigStore', () => {
  beforeEach(() => {
    vueState.stores.clear()
    vi.clearAllMocks()
  })

  it('应当优先返回缓存配置并支持强制刷新', async () => {
    const store = useConfigStore() as unknown as ConfigTestStore
    store.cache.value.theme = 'dark'
    apiMocks.configGet.mockResolvedValue({ data: 'light' })

    await expect(store.getConfig('theme')).resolves.toBe('dark')
    await expect(store.getConfig('theme', true)).resolves.toBe('light')

    expect(apiMocks.configGet).toHaveBeenCalledTimes(1)
    expect(store.cache.value.theme).toBe('light')
  })

  it('应当在设置配置成功时更新缓存，失败时返回 false', async () => {
    const store = useConfigStore() as unknown as ConfigTestStore
    apiMocks.configSet
      .mockResolvedValueOnce({ code: 'OK' })
      .mockRejectedValueOnce(new Error('失败'))

    await expect(store.setConfig('volume', 80)).resolves.toBe(true)
    await expect(store.setConfig('volume', 20)).resolves.toBe(false)

    expect(apiMocks.configSet).toHaveBeenCalledWith('volume', 80)
    expect(store.cache.value.volume).toBe(80)
  })

  it('应当批量加载配置并在结束后关闭加载状态', async () => {
    const store = useConfigStore() as unknown as ConfigTestStore
    apiMocks.configBatch.mockResolvedValue({ data: { theme: 'dark', language: 'zh-CN' } })

    await store.loadBatch(['theme', 'language'])

    expect(store.isLoading.value).toBe(false)
    expect(store.cache.value).toMatchObject({ theme: 'dark', language: 'zh-CN' })

    store.clearCache()
    expect(store.cache.value).toEqual({})
  })
})

describe('useAgentStore', () => {
  beforeEach(() => {
    vueState.stores.clear()
    vi.clearAllMocks()
  })

  it('应当拉取 Agent 列表并同步活跃 Agent', async () => {
    const store = useAgentStore() as unknown as AgentTestStore
    apiMocks.agentList.mockResolvedValue({
      data: [
        { id: 'pero', name: 'Pero', isEnabled: true, isActive: false },
        { id: 'assistant', name: 'Assistant', isEnabled: false, isActive: true },
      ],
    })

    await store.fetchAgents()

    expect(store.isLoading.value).toBe(false)
    expect(store.activeAgentId.value).toBe('assistant')
    expect(store.currentAgent.value?.id).toBe('assistant')
    expect(store.enabledAgents.value.map((agent) => agent.id)).toEqual(['pero'])
  })

  it('应当在拉取失败时记录错误并关闭加载状态', async () => {
    const store = useAgentStore() as unknown as AgentTestStore
    apiMocks.agentList.mockRejectedValue(new Error('网络异常'))

    await store.fetchAgents()

    expect(store.isLoading.value).toBe(false)
    expect(store.error.value).toBe('网络异常')
  })

  it('应当切换活跃 Agent 并刷新列表', async () => {
    const store = useAgentStore() as unknown as AgentTestStore
    // 第七阶段修复（批次 C）：改用 runtimeApi.setWindowAgent 而非 agentApi.setActive
    apiMocks.runtimeSetWindowAgent.mockResolvedValue({ code: 'OK' })
    apiMocks.agentList.mockResolvedValue({
      data: [{ id: 'assistant', name: 'Assistant', isEnabled: true, isActive: true }],
    })

    await store.switchAgent('assistant')

    // 断言调用了 runtimeApi.setWindowAgent，参数为 (windowId, 'assistant')
    expect(apiMocks.runtimeSetWindowAgent).toHaveBeenCalledWith(
      expect.stringMatching(/^win-/),
      'assistant',
    )
    expect(store.activeAgentId.value).toBe('assistant')
    expect(store.agents.value).toHaveLength(1)
  })
})

describe('useThreadStore', () => {
  beforeEach(() => {
    vueState.stores.clear()
    vi.clearAllMocks()
  })

  it('应当添加消息、追加内容并完成流式生成', () => {
    const store = useThreadStore() as unknown as ThreadTestStore

    store.addMessage({
      id: '1',
      role: 'assistant',
      content: '你好',
      timestamp: 'now',
      isStreaming: true,
    })
    store.appendToLast('主人')
    store.generationState.value = 'generating'
    store.streamingMessageId.value = '1'
    store.finishStreaming()

    expect(store.messages.value[0]).toMatchObject({ content: '你好主人', isStreaming: false })
    expect(store.generationState.value).toBe('idle')
    expect(store.streamingMessageId.value).toBeNull()
  })

  it('应当在 threadId 就绪后编辑和删除消息并同步后端', async () => {
    const store = useThreadStore() as unknown as ThreadTestStore
    apiMocks.chatEditMessage.mockResolvedValue({ code: 'OK' })
    apiMocks.chatDeleteMessage.mockResolvedValue({ code: 'OK' })

    store.startThread('thread-1', 'desktop')
    store.addMessage({ id: '12', role: 'user', content: '旧内容', timestamp: 'now' })
    store.addMessage({ id: 'draft', role: 'assistant', content: '草稿', timestamp: 'now' })

    store.editMessage('12', '新内容')
    store.deleteMessage('12')
    store.editMessage('draft', '新草稿')
    await Promise.resolve()

    expect(apiMocks.chatEditMessage).toHaveBeenCalledWith('thread-1', '12', '新内容')
    expect(apiMocks.chatEditMessage).toHaveBeenCalledWith('thread-1', 'draft', '新草稿')
    expect(apiMocks.chatDeleteMessage).toHaveBeenCalledWith('thread-1', '12')
    expect(store.messages.value).toEqual([
      { id: 'draft', role: 'assistant', content: '新草稿', timestamp: 'now' },
    ])
  })

  it('应当重置 Thread 并维护生成状态 getter', () => {
    const store = useThreadStore() as unknown as ThreadTestStore

    store.generationState.value = 'thinking'
    expect(store.isGenerating.value).toBe(true)

    store.startThread('thread-1', 'desktop')

    expect(store.threadId.value).toBe('thread-1')
    expect(store.channel.value).toBe('desktop')
    expect(store.messages.value).toEqual([])
    expect(store.isGenerating.value).toBe(false)
  })
})
