/**
 * ContextCompiler 上下文拼装链路测试
 *
 * 本测试覆盖 9 个模拟情景，纯拼装链路验证（不调 LLM、不访问真实数据库）：
 *  1. 基础场景：desktop channel 正常拼装
 *  2. 社交场景：social channel 工具集受限验证
 *  3. 陪伴场景：companion channel 极简上下文
 *  4. 带记忆的场景：记忆注入正确性
 *  5. 带历史消息的场景：截断逻辑
 *  6. 多模态场景：截图能力片段注入
 *  7. fail-closed 场景：未配置 channel 返回空能力集
 *  8. 权限隔离场景：不同 agentId 同一 channel 能力不同
 *  9. 提示词评价场景：记忆候选的评分与筛选（MemoryGate）
 *
 * 设计要点：
 * - MdpEngine 与 CapabilityGate 使用真实实例（基于临时目录的模板/yaml），
 *   以验证完整渲染链路；ThreadService / AgentManager / ConfigRepository /
 *   MemoryProvider 使用 mock，隔离数据库与外部依赖。
 * - 临时目录结构模拟生产 mdp/prompts 布局：slots/ + components/ + agents/。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextCompiler, DEFAULT_POLICIES } from '@perocore/backend/services/context/contextCompiler'
import { MdpEngine } from '@perocore/backend/services/prompt/mdpEngine'
import { CapabilityGate } from '@perocore/backend/capabilities/capabilityGate'
import type { SkillManifest } from '@perocore/backend/capabilities/types'
import type { ThreadChannel } from '@perocore/backend/repositories/thread.repo'
import type { MemorySearchResultItem } from '@perocore/backend/services/memory/memoryProvider'
import { MemoryGate } from '@perocore/backend/services/memory/memoryGate'

// 屏蔽日志噪音
vi.mock('@perocore/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ─────────────────────────────────────────────
// 槽位模板（简化版，保留关键变量引用以验证注入）
// ─────────────────────────────────────────────

const SLOT_TEMPLATES: Record<string, string> = {
  '100_system_persona.md': `---
role: system
position: 100
enabled: true
slotId: system_persona
label: 核心人设
group: identity
builtin: true
---
<System_Context>
{{ system_core }}

{{ persona_definition }}
</System_Context>`,
  '200_abilities.md': `---
role: system
position: 200
enabled: true
slotId: abilities
label: 能力描述
group: capability
builtin: true
---
{% if ability_fragments %}
<Abilities>
{{ ability_fragments }}
</Abilities>
{% endif %}`,
  '250_draft_flow.md': `---
role: system
position: 250
enabled: false
slotId: draft_flow
label: 草稿心流
group: cognition
builtin: true
---
{{ draft_flow_instructions }}`,
  '400_rules.md': `---
role: system
position: 400
enabled: true
slotId: rules
label: 硬规则
group: constraint
builtin: true
---
<System_Core_Setting>
# 安全协议
保持角色一致性。
</System_Core_Setting>`,
  '500_knowledge.md': `---
role: system
position: 500
enabled: true
slotId: knowledge
label: 知识与技能
group: knowledge
builtin: true
---
{% if skill_menu %}
<Available_Skills>
{{ skill_menu }}
</Available_Skills>
{% endif %}`,
  '600_channel_patch.md': `---
role: system
position: 600
enabled: true
slotId: channel_patch
label: Channel 补丁
group: channel
builtin: true
---
{{ channel_patch }}`,
  '700_memory_context.md': `---
role: system
position: 700
enabled: true
slotId: memory_context
label: 记忆上下文
group: context
builtin: true
---
{% if memory_context or graph_context %}
<Long_Term_Memory>
{{ memory_context }}
</Long_Term_Memory>

{% if graph_context %}
<Graph_Context>
{{ graph_context }}
</Graph_Context>
{% endif %}
{% endif %}`,
  '800_pet_state.md': `---
role: system
position: 800
enabled: true
slotId: pet_state
label: 宠物状态
group: state
builtin: true
---
<Current_Status>
- 当前时间: {{ current_time }}
- 心情: {{ mood }}
- 氛围: {{ vibe }}
- 心理活动: {{ mind }}
</Current_Status>
<Environment>
{{ environment_info }}
</Environment>`,
  '900_user_persona.md': `---
role: system
position: 900
enabled: true
slotId: user_persona
label: 用户画像
group: context
builtin: true
---
{% if owner_name or user_persona %}
<Owner_Setting>
- 姓名: {{ owner_name }}
- 设定: {{ user_persona }}
</Owner_Setting>
{% endif %}`,
  '5000_history.md': `---
role: system
position: 5000
enabled: false
slotId: history
label: 对话历史（已废弃）
group: context
builtin: true
---
<!-- 已废弃：历史消息由 ContextCompiler 以原生角色追加 -->`,
  '9100_output_format.md': `---
role: system
position: 9100
enabled: true
slotId: output_format
label: 输出格式
group: constraint
builtin: true
---
{% if output_format %}
{{ output_format }}
{% endif %}`,
  '9500_footer.md': `---
role: system
position: 9500
enabled: true
slotId: footer
label: 尾部注入
group: safety
builtin: true
---
<Reminder>
当前时间: {{ current_time }}。请务必保持角色一致性。
</Reminder>`,
}

// 组件模板
const SYSTEM_CORE_TEMPLATE = `<System_Core_Framework>
# 核心系统框架
你是一个运行在用户设备上的 AI 助手系统。
</System_Core_Framework>`

const OUTPUT_CONSTRAINT_TEMPLATE = `<Output_Constraint>
### 表达风格控制
两段式回复结构：Thinking + 对{{ owner_name }}的对话内容。
内容极简：2-3 句话。
</Output_Constraint>`

const VISION_TEMPLATE = `- **视觉能力**: 你具有视觉模态能力，可直接看到屏幕截图。当{{ owner_name }}请求"看看"时，必须调用 take_screenshot 工具。`

const WORKSPACE_TEMPLATE = `- **工作区能力**: 你可读写 Principal Workspace 内的文件。`

// ─────────────────────────────────────────────
// 环境构建辅助
// ─────────────────────────────────────────────

interface AgentSetup {
  id: string
  systemPrompt?: string
  channelPatches?: Record<string, string>
  /** capabilities.yaml 内容（不含 agent: 行，由 helper 自动补） */
  capabilities: string
}

interface SetupOptions {
  agents: AgentSetup[]
  tools?: Array<{ name: string; description: string }>
  skills?: Record<string, SkillManifest>
}

interface SetupResult {
  rootDir: string
  mdpEngine: MdpEngine
  capabilityGate: CapabilityGate
  /** 各 agent 的 promptPath 与 channelPatches（供 mock AgentManager 使用） */
  agentProfiles: Record<string, { promptPath: string; channelPatches: Record<string, string> }>
  cleanup: () => void
}

/**
 * 构建临时 mdp 目录结构 + 真实 MdpEngine / CapabilityGate 实例
 *
 * 目录布局：
 *   <rootDir>/prompts/slots/*.md
 *   <rootDir>/prompts/components/rules/system_core.md
 *   <rootDir>/prompts/components/output/output_constraint.md
 *   <rootDir>/prompts/components/abilities/{vision,workspace}.md
 *   <rootDir>/agents/<agentId>/{system_prompt.md, capabilities.yaml}
 */
function setupEnvironment(opts: SetupOptions): SetupResult {
  const rootDir = join(tmpdir(), `perocore-ctx-${Date.now()}-${Math.random()}`)
  const promptDir = join(rootDir, 'prompts')
  const agentsDir = join(rootDir, 'agents')

  // 写入 slots 模板
  mkdirSync(join(promptDir, 'slots'), { recursive: true })
  for (const [file, content] of Object.entries(SLOT_TEMPLATES)) {
    writeFileSync(join(promptDir, 'slots', file), content, 'utf-8')
  }

  // 写入组件模板
  mkdirSync(join(promptDir, 'components', 'rules'), { recursive: true })
  mkdirSync(join(promptDir, 'components', 'output'), { recursive: true })
  mkdirSync(join(promptDir, 'components', 'abilities'), { recursive: true })
  writeFileSync(join(promptDir, 'components', 'rules', 'system_core.md'), SYSTEM_CORE_TEMPLATE, 'utf-8')
  writeFileSync(join(promptDir, 'components', 'output', 'output_constraint.md'), OUTPUT_CONSTRAINT_TEMPLATE, 'utf-8')
  writeFileSync(join(promptDir, 'components', 'abilities', 'vision.md'), VISION_TEMPLATE, 'utf-8')
  writeFileSync(join(promptDir, 'components', 'abilities', 'workspace.md'), WORKSPACE_TEMPLATE, 'utf-8')

  // 写入 agent 目录
  const agentProfiles: SetupResult['agentProfiles'] = {}
  for (const agent of opts.agents) {
    const agentDir = join(agentsDir, agent.id)
    mkdirSync(agentDir, { recursive: true })
    const promptPath = join(agentDir, 'system_prompt.md')
    writeFileSync(promptPath, agent.systemPrompt ?? `我是 ${agent.id} 人格定义`, 'utf-8')
    // capabilities.yaml 必须以 agent: <id> 开头
    writeFileSync(join(agentDir, 'capabilities.yaml'), `agent: ${agent.id}\n${agent.capabilities}`, 'utf-8')
    agentProfiles[agent.id] = {
      promptPath,
      channelPatches: agent.channelPatches ?? {},
    }
  }

  // 真实 MdpEngine（agentsDir = path.join(path.dirname(promptDir), 'agents')）
  const mdpEngine = new MdpEngine(promptDir)

  // mock SkillLoader / ToolRegistry，构造真实 CapabilityGate
  const skillLoaderMock = {
    getManifest: vi.fn((skillId: string) => opts.skills?.[skillId]),
  }
  const toolRegistryMock = {
    getDefinitions: vi.fn(() => opts.tools ?? []),
  }
  const capabilityGate = new CapabilityGate(
    [agentsDir],
    skillLoaderMock as never,
    toolRegistryMock as never,
  )

  const cleanup = () => rmSync(rootDir, { recursive: true, force: true })

  return { rootDir, mdpEngine, capabilityGate, agentProfiles, cleanup }
}

// ─────────────────────────────────────────────
// Mock 依赖工厂
// ─────────────────────────────────────────────

interface ThreadSetup {
  id: string
  agentId: string
  channel: ThreadChannel
  contextPolicy?: string | null
}

interface MessageSetup {
  role: 'user' | 'assistant'
  content: string
}

interface DepsOptions {
  thread: ThreadSetup
  messages: MessageSetup[]
  agentProfiles: SetupResult['agentProfiles']
  config?: Record<string, string>
  memoryResults?: MemorySearchResultItem[]
}

/** 构造 ContextCompiler 的 mock 依赖（ThreadService/AgentManager/ConfigRepo/MemoryProvider） */
function createMockDeps(opts: DepsOptions) {
  const threadService = {
    getThread: vi.fn(async () => ({
      id: opts.thread.id,
      agentId: opts.thread.agentId,
      channel: opts.thread.channel,
      platform: undefined,
      platformIdentifier: undefined,
      title: '测试 Thread',
      messageCount: opts.messages.length,
      pairCount: 0,
      lastMessageAt: null,
      status: 'active',
      contextPolicy: opts.thread.contextPolicy ?? null,
      createdAt: '',
      updatedAt: '',
    })),
    getActiveMessages: vi.fn(async (_threadId: string, limit: number) =>
      // 截断逻辑由 mock 模拟：只返回最近 limit 条
      opts.messages.slice(-limit).map((m, i) => ({
        id: i + 1,
        threadId: opts.thread.id,
        role: m.role,
        content: m.content,
        rawContent: null,
        pairId: null,
        senderId: null,
        agentId: opts.thread.agentId,
        revision: 1,
        metadataJson: '{}',
        timestamp: '',
        status: 'active',
      })),
    ),
  }

  const agentManager = {
    getAgent: vi.fn((id: string) => opts.agentProfiles[id]),
  }

  const configRepo = {
    get: vi.fn(async (key: string) => opts.config?.[key]),
  }

  const memoryProvider = {
    search: vi.fn(async () => opts.memoryResults ?? []),
  }

  return { threadService, agentManager, configRepo, memoryProvider }
}

/** 构造 ContextCompiler 实例 */
function createCompiler(env: SetupResult, deps: ReturnType<typeof createMockDeps>) {
  return new ContextCompiler(
    deps.threadService as never,
    deps.agentManager as never,
    deps.configRepo as never,
    deps.memoryProvider as never,
    env.mdpEngine,
    env.capabilityGate,
  )
}

/** 构造记忆检索结果测试桩 */
function makeMemoryResult(id: string, content: string, score = 0.9): MemorySearchResultItem {
  return {
    id,
    content,
    summary: '',
    importance: 8,
    type: 'event',
    score,
  }
}

// ─────────────────────────────────────────────
// 测试用例
// ─────────────────────────────────────────────

describe('ContextCompiler 上下文拼装链路', () => {
  let env: SetupResult
  let cleanup: () => void

  afterEach(() => {
    if (cleanup) cleanup()
  })

  // ── 场景 1：基础场景 desktop channel 正常拼装 ──
  describe('场景 1：desktop channel 正常拼装', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero，一只可爱的看板娘。',
            channelPatches: { desktop: '' },
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - read_file
      - write_file
      - take_screenshot
    skills:
      - memory_management
    prompt_fragments:
      - components/abilities/vision
      - components/abilities/workspace`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'read_file', description: '读取文件' },
          { name: 'write_file', description: '写入文件' },
          { name: 'take_screenshot', description: '截取屏幕' },
        ],
        skills: {
          memory_management: {
            id: 'memory_management',
            name: '记忆管理',
            description: '管理长期记忆',
            requiredTools: [],
            category: 'productivity',
            tags: [],
            parameters: {},
            dependsOnSkills: [],
          },
        },
      })
      cleanup = env.cleanup
    })

    it('应当拼装出 system 消息 + 活跃消息，并包含人格/状态/工具/能力片段', async () => {
      const deps = createMockDeps({
        thread: { id: 't1', agentId: 'pero', channel: 'desktop' },
        messages: [
          { role: 'user', content: '你好 Pero' },
          { role: 'assistant', content: '主人你好呀~' },
          { role: 'user', content: '今天天气怎么样' },
        ],
        agentProfiles: env.agentProfiles,
        config: {
          'owner.name': '小明',
          'agent.pero.mood': 'happy',
          'agent.pero.vibe': 'active',
          'agent.pero.mind': '想陪主人聊天',
        },
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t1', 'pero')

      // 首条必须是 system 消息
      expect(result.messages[0]?.role).toBe('system')
      const systemContent = result.messages[0]!.content

      // 包含核心组件：人格定义、系统框架、状态、能力片段
      expect(systemContent).toContain('我是 Pero，一只可爱的看板娘。')
      expect(systemContent).toContain('核心系统框架')
      expect(systemContent).toContain('小明') // owner_name 注入
      expect(systemContent).toContain('happy') // mood 注入
      // 300_tools slot 已删除：工具定义通过原生 tools 字段注入，不再出现在 System Prompt
      expect(systemContent).not.toContain('<Available_Tools>')
      expect(systemContent).toContain('<Abilities>')
      expect(systemContent).toContain('视觉能力') // vision 片段渲染

      // 末尾应为活跃消息（user/assistant 原生角色）
      const lastMessages = result.messages.slice(-3)
      expect(lastMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
      expect(lastMessages[2]?.content).toBe('今天天气怎么样')

      // 清单字段正确
      expect(result.manifest).toMatchObject({
        agentId: 'pero',
        threadId: 't1',
        channel: 'desktop',
        messageWindow: 20,
        loadedMessageCount: 3,
        hasMemoryRetrieval: true,
        hasStateInjection: true,
        toolCount: 4,
      })
    })
  })

  // ── 场景 2：社交场景 social channel 工具集受限 ──
  describe('场景 2：social channel 工具集受限验证', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            // social channel 只配置最小工具集（不含危险工具）
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - read_file
      - write_file
      - terminal_execute
    skills: []
    prompt_fragments: []
  social:
    tools:
      - finish_task
      - web_fetch
      - search_diary
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'read_file', description: '读取文件' },
          { name: 'write_file', description: '写入文件' },
          { name: 'terminal_execute', description: '执行终端命令' },
          { name: 'web_fetch', description: '抓取网页' },
          { name: 'search_diary', description: '搜索日记' },
        ],
      })
      cleanup = env.cleanup
    })

    it('social channel 应禁用工具描述/记忆/状态注入（fallback 策略），且不含危险工具', async () => {
      const deps = createMockDeps({
        thread: { id: 't2', agentId: 'pero', channel: 'social' },
        messages: [{ role: 'user', content: '在吗' }],
        agentProfiles: env.agentProfiles,
        // 配置 mood/owner，验证状态注入关闭时这些值不应出现
        config: {
          'owner.name': '小明',
          'agent.pero.mood': 'happy',
          'agent.pero.vibe': 'active',
          'agent.pero.mind': '想聊天',
        },
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t2', 'pero')

      const systemContent = result.messages[0]?.content ?? ''

      // social 的 DEFAULT_POLICIES：工具描述/记忆/状态全部关闭
      expect(DEFAULT_POLICIES.social.enableToolDescriptions).toBe(false)
      expect(DEFAULT_POLICIES.social.enableMemoryRetrieval).toBe(false)
      expect(DEFAULT_POLICIES.social.enableStateInjection).toBe(false)

      // 拼装结果不应包含工具列表与危险工具名
      expect(systemContent).not.toContain('<Available_Tools>')
      expect(systemContent).not.toContain('terminal_execute')
      expect(systemContent).not.toContain('write_file')
      // 状态注入关闭：buildStateSection 未调用，mood/owner 配置值不应渲染进上下文
      expect(systemContent).not.toContain('happy')
      expect(systemContent).not.toContain('小明')

      // 清单：工具数为 0（策略关闭工具描述），无记忆检索，无状态注入
      expect(result.manifest.toolCount).toBe(0)
      expect(result.manifest.hasMemoryRetrieval).toBe(false)
      expect(result.manifest.hasStateInjection).toBe(false)
    })

    it('CapabilityGate 层应确保 social channel 只暴露最小工具白名单', () => {
      // 直接验证能力门控：social 不含危险工具
      const socialCap = env.capabilityGate.resolve('pero', 'social')
      expect([...socialCap.allowedTools]).toEqual(
        expect.arrayContaining(['finish_task', 'web_fetch', 'search_diary']),
      )
      expect(socialCap.allowedTools.has('terminal_execute')).toBe(false)
      expect(socialCap.allowedTools.has('write_file')).toBe(false)
      expect(socialCap.allowedTools.has('read_file')).toBe(false)

      // 对比 desktop channel 拥有危险工具
      const desktopCap = env.capabilityGate.resolve('pero', 'desktop')
      expect(desktopCap.allowedTools.has('terminal_execute')).toBe(true)
      expect(desktopCap.allowedTools.has('write_file')).toBe(true)
    })
  })

  // ── 场景 3：陪伴场景 companion channel 极简上下文 ──
  describe('场景 3：companion channel 极简上下文', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero 看板娘。',
            channelPatches: {
              companion: '在陪伴场景下，你应更活泼可爱，多用语气词，主动陪伴主人。',
            },
            capabilities: `channels:
  companion:
    tools:
      - finish_task
      - take_screenshot
      - set_reminder
    skills: []
    prompt_fragments:
      - components/abilities/vision`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'take_screenshot', description: '截屏' },
          { name: 'set_reminder', description: '设置提醒' },
        ],
      })
      cleanup = env.cleanup
    })

    it('companion channel 应使用小窗口(8)、禁用工具描述、注入陪伴补丁与状态', async () => {
      const deps = createMockDeps({
        thread: { id: 't3', agentId: 'pero', channel: 'companion' },
        messages: [{ role: 'user', content: '陪我聊聊天嘛' }],
        agentProfiles: env.agentProfiles,
        config: { 'owner.name': '主人' },
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t3', 'pero')

      // companion 策略：窗口 8、禁用工具描述、启用状态注入
      expect(DEFAULT_POLICIES.companion.messageWindow).toBe(8)
      expect(DEFAULT_POLICIES.companion.enableToolDescriptions).toBe(false)
      expect(DEFAULT_POLICIES.companion.enableStateInjection).toBe(true)

      expect(result.manifest.messageWindow).toBe(8)
      expect(result.manifest.toolCount).toBe(0)

      const systemContent = result.messages[0]!.content
      // 不含工具列表（极简）
      expect(systemContent).not.toContain('<Available_Tools>')
      // 含陪伴补丁
      expect(systemContent).toContain('活泼可爱')
      // 含状态注入
      expect(systemContent).toContain('<Current_Status>')
      // 含视觉能力片段（companion 配置了 vision）
      expect(systemContent).toContain('视觉能力')
    })
  })

  // ── 场景 4：带记忆的场景：记忆注入正确性 ──
  describe('场景 4：记忆注入正确性', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [{ name: 'finish_task', description: '完成任务' }],
      })
      cleanup = env.cleanup
    })

    it('应当将 RAG 检索结果格式化为 memory_context 并注入 system 消息', async () => {
      const memoryResults = [
        makeMemoryResult('m1', '主人喜欢猫，养了两只', 0.92),
        makeMemoryResult('m2', '主人的工作是程序员', 0.85),
      ]
      const deps = createMockDeps({
        thread: { id: 't4', agentId: 'pero', channel: 'desktop' },
        messages: [{ role: 'user', content: '我的宠物是什么' }],
        agentProfiles: env.agentProfiles,
        memoryResults,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t4', 'pero')

      const systemContent = result.messages[0]!.content

      // 包含 memory_context XML 包裹
      expect(systemContent).toContain('<Long_Term_Memory>')
      expect(systemContent).toContain('<memory_context>')
      expect(systemContent).toContain('主人喜欢猫，养了两只')
      expect(systemContent).toContain('主人的工作是程序员')
      // 包含 id/type/importance/score 属性
      expect(systemContent).toContain('id="m1"')
      expect(systemContent).toContain('type="event"')
      expect(systemContent).toContain('score="0.920"')

      // 清单：记忆命中数正确
      expect(result.manifest.hasMemoryRetrieval).toBe(true)
      expect(result.manifest.memoryHitCount).toBe(2)

      // memoryProvider.search 被正确调用（含 channel）
      expect(deps.memoryProvider.search).toHaveBeenCalledWith({
        query: '我的宠物是什么',
        agentId: 'pero',
        channel: 'desktop',
        limit: 10,
      })
    })

    it('无 user 消息时不应检索记忆', async () => {
      const deps = createMockDeps({
        thread: { id: 't4b', agentId: 'pero', channel: 'desktop' },
        messages: [{ role: 'assistant', content: '你好' }], // 仅 assistant，无 user
        agentProfiles: env.agentProfiles,
        memoryResults: [makeMemoryResult('m1', '不该出现')],
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t4b', 'pero')

      // 无 user 消息 → 不检索记忆
      expect(deps.memoryProvider.search).not.toHaveBeenCalled()
      expect(result.manifest.hasMemoryRetrieval).toBe(false)
      expect(result.manifest.memoryHitCount).toBe(0)
    })
  })

  // ── 场景 5：带历史消息的场景：截断逻辑 ──
  describe('场景 5：历史消息截断逻辑', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [{ name: 'finish_task', description: '完成任务' }],
      })
      cleanup = env.cleanup
    })

    it('desktop 默认窗口 20：超过 20 条只保留最近 20 条', async () => {
      // 生成 25 条消息
      const messages: MessageSetup[] = []
      for (let i = 1; i <= 25; i++) {
        messages.push({ role: 'user', content: `第${i}条用户消息` })
        messages.push({ role: 'assistant', content: `第${i}条回复` })
      }
      // 共 50 条，超过 desktop 窗口 20
      const deps = createMockDeps({
        thread: { id: 't5', agentId: 'pero', channel: 'desktop' },
        messages,
        agentProfiles: env.agentProfiles,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t5', 'pero')

      // mock 的 getActiveMessages 按 limit 截断
      expect(result.manifest.loadedMessageCount).toBe(20)
      // 验证只保留最近 20 条（mock 实现为 slice(-20)）
      // 末尾消息应为最后一条
      const lastMsg = result.messages[result.messages.length - 1]
      expect(lastMsg?.content).toBe('第25条回复')
      // 第 1 条消息不应出现（已被截断）
      const allContent = result.messages.map((m) => m.content).join('\n')
      expect(allContent).not.toContain('第1条用户消息')
    })

    it('Thread 自定义 contextPolicy 应覆盖默认窗口', async () => {
      // 自定义窗口为 3
      const customPolicy = JSON.stringify({
        messageWindow: 3,
        enableMemoryRetrieval: false,
        enableToolDescriptions: false,
        enableStateInjection: false,
        tokenBudget: 0,
      })
      const messages: MessageSetup[] = [
        { role: 'user', content: '消息A' },
        { role: 'assistant', content: '回复A' },
        { role: 'user', content: '消息B' },
        { role: 'assistant', content: '回复B' },
        { role: 'user', content: '消息C' },
      ]
      const deps = createMockDeps({
        thread: { id: 't5b', agentId: 'pero', channel: 'desktop', contextPolicy: customPolicy },
        messages,
        agentProfiles: env.agentProfiles,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t5b', 'pero')

      // 自定义窗口 3
      expect(result.manifest.messageWindow).toBe(3)
      expect(result.manifest.loadedMessageCount).toBe(3)
      // 只保留最近 3 条：slice(-3) = [消息B, 回复B, 消息C]，其中 user 消息为 消息B/消息C
      const userMessages = result.messages.filter((m) => m.role === 'user').map((m) => m.content)
      expect(userMessages).toEqual(['消息B', '消息C'])
      // 最早的消息A已被截断，不应出现
      expect(result.messages.some((m) => m.content === '消息A')).toBe(false)
    })
  })

  // ── 场景 6：多模态场景：截图能力片段注入 ──
  describe('场景 6：多模态场景（视觉能力片段注入）', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - take_screenshot
    skills: []
    prompt_fragments:
      - components/abilities/vision`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'take_screenshot', description: '截取屏幕截图' },
        ],
      })
      cleanup = env.cleanup
    })

    it('应当渲染 vision 能力片段并注入 owner_name 变量', async () => {
      const deps = createMockDeps({
        thread: { id: 't6', agentId: 'pero', channel: 'desktop' },
        messages: [{ role: 'user', content: '帮我看看屏幕' }],
        agentProfiles: env.agentProfiles,
        config: { 'owner.name': '小明' },
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t6', 'pero')

      const systemContent = result.messages[0]!.content

      // vision 片段被渲染进 <Abilities>
      expect(systemContent).toContain('<Abilities>')
      expect(systemContent).toContain('视觉能力')
      // owner_name 变量在片段内被正确替换
      expect(systemContent).toContain('当小明请求')
      // take_screenshot 工具出现在工具列表
      expect(systemContent).toContain('take_screenshot')
    })

    it('未配置 vision 片段的 channel 不应注入视觉能力', async () => {
      // 重新构建：companion 不配置 vision
      env.cleanup()
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            capabilities: `channels:
  companion:
    tools:
      - finish_task
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [{ name: 'finish_task', description: '完成任务' }],
      })
      cleanup = env.cleanup

      const deps = createMockDeps({
        thread: { id: 't6b', agentId: 'pero', channel: 'companion' },
        messages: [{ role: 'user', content: '看看屏幕' }],
        agentProfiles: env.agentProfiles,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t6b', 'pero')

      const systemContent = result.messages[0]!.content
      expect(systemContent).not.toContain('<Abilities>')
      expect(systemContent).not.toContain('视觉能力')
    })
  })

  // ── 场景 7：fail-closed 场景：未配置 channel 返回空能力集 ──
  describe('场景 7：fail-closed 未配置 channel 返回空能力集', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            // 只配置 desktop，不配置 mobile/unknown
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - read_file
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'read_file', description: '读取文件' },
        ],
      })
      cleanup = env.cleanup
    })

    it('CapabilityGate 对未配置的 channel 应返回空能力集（fail-closed）', () => {
      const resolved = env.capabilityGate.resolve('pero', 'unknown_channel')
      expect(resolved.allowedTools.size).toBe(0)
      expect(resolved.enabledSkills).toEqual([])
      expect(resolved.promptFragments).toEqual([])
      expect(resolved.toolsDescription).toBe('')
    })

    it('ContextCompiler 拼装未配置 channel 时 toolCount 应为 0 且无工具描述', async () => {
      // 使用自定义 contextPolicy 启用工具描述，但 channel 未配置 → 仍 fail-closed
      const customPolicy = JSON.stringify({
        messageWindow: 5,
        enableMemoryRetrieval: false,
        enableToolDescriptions: true, // 即使启用，未配置 channel 也无工具
        enableStateInjection: false,
        tokenBudget: 0,
      })
      const deps = createMockDeps({
        // channel='mobile' 未在 capabilities.yaml 配置
        thread: { id: 't7', agentId: 'pero', channel: 'mobile' as ThreadChannel, contextPolicy: customPolicy },
        messages: [{ role: 'user', content: '测试' }],
        agentProfiles: env.agentProfiles,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t7', 'pero')

      // fail-closed：无工具可用
      expect(result.manifest.toolCount).toBe(0)
      const systemContent = result.messages[0]!.content
      expect(systemContent).not.toContain('<Available_Tools>')
      expect(systemContent).not.toContain('read_file')
    })
  })

  // ── 场景 8：权限隔离场景：不同 agentId 同一 channel 能力不同 ──
  describe('场景 8：权限隔离（不同 agentId 同一 channel 能力不同）', () => {
    beforeEach(() => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            // pero 在 desktop 拥有完整工具集（含危险工具）
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - read_file
      - write_file
      - terminal_execute
    skills: []
    prompt_fragments: []`,
          },
          {
            id: 'nana',
            systemPrompt: '我是 Nana。',
            // nana 在 desktop 只有只读工具（最小权限）
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
      - read_file
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [
          { name: 'finish_task', description: '完成任务' },
          { name: 'read_file', description: '读取文件' },
          { name: 'write_file', description: '写入文件' },
          { name: 'terminal_execute', description: '执行终端命令' },
        ],
      })
      cleanup = env.cleanup
    })

    it('同一 desktop channel 下 pero 有 4 个工具，nana 只有 2 个', async () => {
      // pero：4 个工具
      const depsPero = createMockDeps({
        thread: { id: 't8a', agentId: 'pero', channel: 'desktop' },
        messages: [{ role: 'user', content: '帮我执行命令' }],
        agentProfiles: env.agentProfiles,
      })
      const compilerPero = createCompiler(env, depsPero)
      const resultPero = await compilerPero.compile('t8a', 'pero')

      expect(resultPero.manifest.toolCount).toBe(4)
      expect(resultPero.messages[0]!.content).toContain('terminal_execute')
      expect(resultPero.messages[0]!.content).toContain('write_file')

      // nana：2 个工具，无危险工具
      const depsNana = createMockDeps({
        thread: { id: 't8b', agentId: 'nana', channel: 'desktop' },
        messages: [{ role: 'user', content: '帮我执行命令' }],
        agentProfiles: env.agentProfiles,
      })
      const compilerNana = createCompiler(env, depsNana)
      const resultNana = await compilerNana.compile('t8b', 'nana')

      expect(resultNana.manifest.toolCount).toBe(2)
      expect(resultNana.messages[0]!.content).not.toContain('terminal_execute')
      expect(resultNana.messages[0]!.content).not.toContain('write_file')
      // nana 仍可读文件
      expect(resultNana.messages[0]!.content).toContain('read_file')
    })

    it('CapabilityGate 层应体现 (agentId, channel) 二维隔离', () => {
      const peroCap = env.capabilityGate.resolve('pero', 'desktop')
      const nanaCap = env.capabilityGate.resolve('nana', 'desktop')

      expect(peroCap.allowedTools.size).toBe(4)
      expect(nanaCap.allowedTools.size).toBe(2)
      expect(peroCap.allowedTools.has('terminal_execute')).toBe(true)
      expect(nanaCap.allowedTools.has('terminal_execute')).toBe(false)
    })
  })

  // ── 场景 9：提示词评价场景：记忆候选的评分与筛选（MemoryGate）──
  describe('场景 9：提示词评价（MemoryGate 记忆候选评分与筛选）', () => {
    it('MemoryGate 应接受无重复的新候选', () => {
      const gate = new MemoryGate()
      const candidate = {
        id: 'c1',
        agentId: 'pero',
        source: 'thread' as const,
        originThreadId: 't1',
        originMessageIds: ['1', '2'],
        summary: '主人今天学会了做螺蛳粉',
        evidenceRefs: [],
        importance: 7,
        confidence: 0.6,
        suggestedType: 'event' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }
      const existing = [
        {
          id: 'm1',
          agentId: 'pero',
          type: 'event' as const,
          content: '主人喜欢猫',
          summary: '',
          importance: 5,
          confidence: 0.5,
          status: 'active' as const,
          provenance: {
            originThreadId: 'old',
            originMessageIds: [],
            originChannel: 'desktop',
            createdFrom: 'scorer' as const,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]

      const result = gate.review(candidate, existing)

      expect(result.decision).toBe('accept')
    })

    it('MemoryGate 应拒绝与已有记忆高度重复的候选（包含关系）', () => {
      const gate = new MemoryGate()
      const candidate = {
        id: 'c2',
        agentId: 'pero',
        source: 'thread' as const,
        originThreadId: 't1',
        originMessageIds: [],
        summary: '主人喜欢猫',
        evidenceRefs: [],
        importance: 5,
        confidence: 0.5,
        suggestedType: 'event' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }
      const existing = [
        {
          id: 'm1',
          agentId: 'pero',
          type: 'event' as const,
          content: '今天发现主人喜欢猫，还养了两只',
          summary: '',
          importance: 5,
          confidence: 0.5,
          status: 'active' as const,
          provenance: {
            originThreadId: 'old',
            originMessageIds: [],
            originChannel: 'desktop',
            createdFrom: 'scorer' as const,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]

      const result = gate.review(candidate, existing)

      expect(result.decision).toBe('reject')
      expect(result.reason).toContain('包含')
    })

    it('MemoryGate 应拒绝与已有记忆高度相似的候选（Jaccard 相似度）', () => {
      const gate = new MemoryGate()
      // 字符集相同但顺序不同：contains 不触发，Jaccard=1.0 触发
      const candidate = {
        id: 'c3',
        agentId: 'pero',
        source: 'thread' as const,
        originThreadId: 't1',
        originMessageIds: [],
        summary: '主人喜欢猫狗',
        evidenceRefs: [],
        importance: 5,
        confidence: 0.5,
        suggestedType: 'event' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }
      const existing = [
        {
          id: 'm1',
          agentId: 'pero',
          type: 'event' as const,
          content: '喜欢猫狗主人',
          summary: '',
          importance: 5,
          confidence: 0.5,
          status: 'active' as const,
          provenance: {
            originThreadId: 'old',
            originMessageIds: [],
            originChannel: 'desktop',
            createdFrom: 'scorer' as const,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]

      const result = gate.review(candidate, existing)

      expect(result.decision).toBe('reject')
      expect(result.reason).toContain('相似')
    })

    it('MemoryGate 应跳过空摘要候选', () => {
      const gate = new MemoryGate()
      const candidate = {
        id: 'c4',
        agentId: 'pero',
        source: 'thread' as const,
        originThreadId: 't1',
        originMessageIds: [],
        summary: '   ',
        evidenceRefs: [],
        importance: 5,
        confidence: 0.5,
        suggestedType: 'event' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }

      const result = gate.review(candidate, [])

      expect(result.decision).toBe('skip')
    })

    it('ContextCompiler 记忆注入只消费已确认记忆（MemoryProvider.search 结果），不直接消费候选', async () => {
      env = setupEnvironment({
        agents: [
          {
            id: 'pero',
            systemPrompt: '我是 Pero。',
            capabilities: `channels:
  desktop:
    tools:
      - finish_task
    skills: []
    prompt_fragments: []`,
          },
        ],
        tools: [{ name: 'finish_task', description: '完成任务' }],
      })
      cleanup = env.cleanup

      // 模拟场景：MemoryGate 已 reject 一条候选，MemoryProvider 只返回已确认记忆
      const gate = new MemoryGate()
      const rejectedCandidate = {
        id: 'cand-rejected',
        agentId: 'pero',
        source: 'thread' as const,
        originThreadId: 't1',
        originMessageIds: [],
        summary: '主人喜欢猫',
        evidenceRefs: [],
        importance: 5,
        confidence: 0.5,
        suggestedType: 'event' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }
      const existingConfirmed = [
        {
          id: 'mem-confirmed',
          agentId: 'pero',
          type: 'event' as const,
          content: '今天发现主人喜欢猫，还养了两只',
          summary: '',
          importance: 8,
          confidence: 0.9,
          status: 'active' as const,
          provenance: {
            originThreadId: 'old',
            originMessageIds: [],
            originChannel: 'desktop',
            createdFrom: 'scorer' as const,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]

      // Gate 审核结果：候选被 reject（与已有记忆重复）
      const gateResult = gate.review(rejectedCandidate, existingConfirmed)
      expect(gateResult.decision).toBe('reject')

      // MemoryProvider.search 只返回已确认记忆（不返回被 reject 的候选）
      const confirmedMemories: MemorySearchResultItem[] = [
        {
          id: 'mem-confirmed',
          content: '今天发现主人喜欢猫，还养了两只',
          summary: '',
          importance: 8,
          type: 'event',
          score: 0.9,
        },
      ]
      const deps = createMockDeps({
        thread: { id: 't9', agentId: 'pero', channel: 'desktop' },
        messages: [{ role: 'user', content: '我喜欢什么动物' }],
        agentProfiles: env.agentProfiles,
        memoryResults: confirmedMemories,
      })
      const compiler = createCompiler(env, deps)

      const result = await compiler.compile('t9', 'pero')

      const systemContent = result.messages[0]!.content
      // 已确认记忆被注入
      expect(systemContent).toContain('今天发现主人喜欢猫，还养了两只')
      // 被 reject 的候选摘要不应出现（它从未进入 MemoryProvider.search 结果）
      expect(systemContent).not.toContain('cand-rejected')
      expect(result.manifest.memoryHitCount).toBe(1)
    })
  })
})
