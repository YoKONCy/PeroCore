# 16. Capability Gate — 能力门控与 Skill 系统 (D51)

> 本文档定义 PeroCore-TS 的统一能力门控架构。取代现有散布在多处的 if-else 工具过滤逻辑，
> 引入声明式 Capability Gate 矩阵 + 模块化 Skill 系统，
> 实现"Agent × Mode → 可用能力"的单一权威来源。

---

## 1. 问题诊断

### 1.1 现有门控机制

当前 PeroCore 的 NIT 工具过滤逻辑**散布在三处**：

```
PromptService._enrich_variables()     # 400+ 行 if-else
├─ is_social_mode → 不加载 workspace ability
├─ is_lightweight → 清空 chain_logic
├─ is_work_mode  → 用 work_custom_persona
├─ is_group      → 加载据点上下文
└─ dynamic_tools → 由 AgentService 预计算

NITDispatcher.dispatch()              # 白名单过滤
├─ allowed_tools → 硬编码 normalize 比对
└─ 轻量模式 → 只允许 2 个插件

NITDispatcher._execute_plugin()       # 运行时拦截
├─ lightweight_mode → 硬编码只放行 ScreenVision + TaskLifecycle
├─ category_enabled → NIT Manager 类别开关
└─ plugin_enabled  → NIT Manager 插件开关
```

### 1.2 问题

| # | 问题 | 影响 |
|---|---|---|
| 1 | **无单一权威来源** | 3 个文件的过滤可能不一致（prompt 注入了但 dispatcher 拦截了） |
| 2 | **新增模式 = 到处加 if-else** | 每次加模式要改 prompt_service + dispatcher + agent_config |
| 3 | **新增 Agent = 修改多处代码** | nana 和 pero 的工具差异靠代码分支控制 |
| 4 | **不可审计** | 没有人能快速回答"pero 在社交模式下能用哪些工具" |
| 5 | **无 Skill 概念** | 所有工具描述一次性塞入 system prompt，token 浪费 |

---

## 2. 架构：Capability Gate

### 2.1 核心概念

```
Capability = Tool ∪ Skill

  Tool (NIT): 原子操作（web_search, diary_query, ...）
  Skill:      任务级知识（如何组合工具完成特定任务的指南）

  CapabilityGate: (Agent, Mode, Context) → ResolvedCapability
                  单一权威来源，一次性决策
```

### 2.2 解析流程

```
                   ┌── Agent ──┐  ┌── Mode ──────────┐
                   │pero│nana│…│  │desktop│social│work│
                   └────┴────┴─┘  └───────┴──────┴────┘
                         │               │
                         ▼               ▼
              ┌── Capability Gate (单一权威) ──┐
              │                                │
              │  读取: agents/{id}/cap.yaml     │
              │  解析: modes[mode]              │
              │                                │
              │  输出 ResolvedCapability:       │
              │  ├─ allowedTools: Set<string>   │
              │  ├─ enabledSkills: Manifest[]   │
              │  ├─ promptFragments: string[]   │
              │  └─ toolsDescription: string    │
              └────────────────────────────────┘
                     │               │
           ┌─────────┘               └──────────┐
           ▼                                    ▼
   System Prompt 组装                    Dispatcher 白名单
   (仅注入 enabled 的                    (运行时拦截 disabled
    工具描述 + Skill 菜单)                的工具调用)
```

### 2.3 声明式配置

```yaml
# agents/pero/capabilities.yaml
agent: pero

modes:
  desktop:
    tools:
      - web_search
      - code_search
      - screen_vision
      - task_lifecycle
      - file_operations
      - diary_query
      - tts_speak
    skills:
      - diary_query
      - coding_assistant
      - emotional_support
      - memory_recall
    prompt_fragments:
      - components/abilities/workspace
      - components/abilities/vision
      - components/abilities/nit

  social:
    tools:
      - web_search
      - send_sticker
      - social_context
      - diary_query
    skills:
      - social_chat
      - diary_query
      - emotional_support
    prompt_fragments:
      - social/abilities/sticker_expression
      - social/social_instructions

  work:
    tools:
      - code_search
      - file_operations
      - web_search
      - task_lifecycle
    skills:
      - coding_assistant
      - task_management
    prompt_fragments:
      - components/abilities/workspace
      - components/abilities/nit

  lightweight:
    tools:
      - screen_vision
      - task_lifecycle
    skills: []
    prompt_fragments: []
```

```yaml
# agents/nana/capabilities.yaml
agent: nana

modes:
  desktop:
    tools:
      - web_search
      - diary_query
      - tts_speak
    skills:
      - study_buddy         # nana 专属
      - diary_query
    prompt_fragments:
      - components/abilities/nit
```

### 2.4 TypeScript 接口

```typescript
// packages/backend/src/capabilities/types.ts

interface ModeCapability {
  /** 该模式下可用的 NIT 工具 ID 列表 */
  tools: string[]
  /** 该模式下可用的 Skill ID 列表 */
  skills: string[]
  /** 需要注入的 prompt 片段路径 */
  prompt_fragments: string[]
}

interface AgentCapabilityConfig {
  agent: string
  modes: Record<string, ModeCapability>
}

interface ResolvedCapability {
  /** Dispatcher 白名单 */
  allowedTools: Set<string>
  /** Skill 菜单摘要（L1，注入 system prompt） */
  enabledSkills: SkillManifest[]
  /** 需要渲染的 prompt 片段 */
  promptFragments: string[]
  /** 已过滤的工具描述文本 */
  toolsDescription: string
  /** Skill 菜单文本 */
  skillMenuText: string
}
```

```typescript
// packages/backend/src/capabilities/capabilityGate.ts

class CapabilityGate {
  private configs: Map<string, AgentCapabilityConfig> = new Map()
  private skillLoader: SkillLoader

  constructor(agentsDir: string, skillLoader: SkillLoader) {
    // 启动时扫描 agents/*/capabilities.yaml
    this.loadAll(agentsDir)
    this.skillLoader = skillLoader
  }

  /** 核心方法：解析 (agent, mode) → 完整能力上下文 */
  resolve(agentId: string, mode: string): ResolvedCapability {
    const config = this.configs.get(agentId)
    const modeConfig = config?.modes[mode] ?? config?.modes['desktop']

    if (!modeConfig) {
      return this.emptyCapability()
    }

    // 1. 工具白名单
    const allowedTools = new Set(modeConfig.tools)

    // 2. Skill 清单（只加载 metadata，不加载完整指令）
    const enabledSkills = modeConfig.skills
      .map(id => this.skillLoader.getManifest(id))
      .filter(Boolean)

    // 3. 工具描述文本（仅 enabled 的工具）
    const toolsDescription = this.buildToolsDescription(modeConfig.tools)

    // 4. Skill 菜单文本（~50 tokens，L1 渐进式加载）
    const skillMenuText = enabledSkills
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n')

    return {
      allowedTools,
      enabledSkills,
      promptFragments: modeConfig.prompt_fragments,
      toolsDescription,
      skillMenuText,
    }
  }

  /** 运行时单点校验 */
  isToolAllowed(agentId: string, mode: string, toolName: string): boolean {
    const resolved = this.resolve(agentId, mode)
    return resolved.allowedTools.has(toolName)
  }
}
```

---

## 3. Skill 系统

### 3.1 Skill 文件结构

```
skills/                              # Skill 根目录
├── builtin/                         # 系统内置 Skill（随版本发布）
│   ├── diary_query/
│   │   ├── SKILL.md                 # 主指令文件
│   │   └── references/
│   │       └── diary_schema.json
│   ├── coding_assistant/
│   │   └── SKILL.md
│   ├── emotional_support/
│   │   └── SKILL.md
│   ├── memory_recall/
│   │   └── SKILL.md
│   └── social_chat/
│       └── SKILL.md
└── custom/                          # 用户自定义 Skill（data 目录）
    └── cooking_helper/
        └── SKILL.md
```

### 3.2 SKILL.md 格式

```yaml
---
name: diary_query
description: 帮助主人查询日记，支持按日期、主题、人物检索历史记录
requiredTools:
  - diary_by_date
  - diary_by_topic
  - diary_by_entity
  - diary_summary
---

## 使用场景
当主人提到"之前"、"以前"、"上次"等时间回溯词，
或询问某段时间的经历时，应激活此技能。

## 执行步骤
1. 判断查询类型：
   - 明确日期 → `diary_by_date`
   - 模糊主题 → `diary_by_topic`
   - 提到人名 → `diary_by_entity`
   - "最近一周" → `diary_summary`
2. 格式化结果，自然融入对话（不要生硬列举）
3. 如果没找到，诚实告知

## 注意事项
- 日记查询不消耗 LLM Token，可以多查几次精确定位
- 对社交日报的内容注意脱敏表述
```

### 3.3 渐进式上下文加载 (Progressive Disclosure)

```
L1: System Prompt（始终加载，~50 tokens）
    ┌──────────────────────────────────────────┐
    │ 你拥有以下技能，在需要时可以使用：        │
    │ - diary_query: 查询日记和历史记录         │
    │ - emotional_support: 情绪支持和安慰       │
    │ - coding_assistant: 编程辅助              │
    │ 如需使用，请先调用 load_skill 加载详情。   │
    └──────────────────────────────────────────┘

L2: LLM 按需加载（仅当需要时，~200-500 tokens）
    LLM: "主人提到了'上次'，我需要查日记"
    → 调用 load_skill("diary_query")
    → 获得完整的使用步骤和注意事项
    → 按步骤执行 NIT 工具

L3: 参考资料（极少情况，按需加载）
    → 调用 load_skill_reference("diary_query", "diary_schema.json")
```

### 3.4 Skill 加载工具 (NIT)

```typescript
// 新增 NIT 内置工具：load_skill
const loadSkillTool = {
  name: 'load_skill',
  description: '加载指定技能的详细使用指南。需要执行某个技能但不确定步骤时使用。',
  parameter: 'skill_id: 技能 ID（从技能菜单中选择）',
  handler: async (skill_id: string) => {
    const content = skillLoader.loadSkill(skill_id)
    if (!content) return `未找到技能: ${skill_id}`

    // 临时解锁该 Skill 依赖的工具
    const manifest = skillLoader.getManifest(skill_id)
    if (manifest?.requiredTools) {
      sessionContext.temporaryAllowedTools.addAll(manifest.requiredTools)
    }

    return content
  },
}
```

### 3.5 Skill 与 Tool 的联动权限

```
普通流程:
  系统启动 → CapabilityGate.resolve() → 基础白名单
  → LLM 只能调用基础白名单内的工具

Skill 激活流程:
  LLM 调用 load_skill("diary_query")
  → 返回指令 + 临时解锁 requiredTools
  → 本次会话内 diary_by_date 等工具变为可用
  → 会话结束后自动回收

效果: 渐进式权限扩展，按需授权
```

---

## 4. Prompt 组装简化

### 4.1 重构前 (命令式 if-else)

```python
# prompt_service.py — 400+ 行
if is_social_mode or is_lightweight:
    variables["chain_logic"] = ""

if not is_social_mode:
    if enable_vision:
        abilities_parts.append(...)
    else:
        abilities_parts.append(...)

if "ability" not in variables:
    if not is_social_mode:
        prompt = self.mdp.get_prompt("components/abilities/workspace")
        ...
    else:
        variables["ability"] = ""

if "available_tools_desc" not in variables:
    dynamic_tools = variables.get("dynamic_tools")
    if dynamic_tools and isinstance(dynamic_tools, list):
        ...
    else:
        if not is_social_mode:
            ...
        else:
            ...
# 还有更多...
```

### 4.2 重构后 (声明式)

```typescript
// promptBuilder.ts — ~30 行核心逻辑
function buildSystemPrompt(agentId: string, mode: string, vars: Variables): string {
  // 1. 解析能力矩阵（单一来源）
  const cap = capabilityGate.resolve(agentId, mode)

  // 2. 渲染 prompt 片段（声明式列表驱动）
  const fragments = cap.promptFragments.map(f => mdp.render(f, vars))

  // 3. 注入工具描述（已过滤）
  vars.available_tools_desc = cap.toolsDescription

  // 4. 注入 Skill 菜单（L1）
  vars.skill_menu = cap.skillMenuText

  // 5. 渲染主模板
  return mdp.render(`agents/${agentId}/${mode}_template`, {
    ...vars,
    ability_fragments: fragments.join('\n'),
  })
}
```

---

## 5. 与现有系统的集成

### 5.1 迁移路径

| 现有模块 | 变更 |
|---|---|
| `PromptService._enrich_variables()` | 拆解为 `CapabilityGate.resolve()` + `PromptBuilder` |
| `NITDispatcher.dispatch(allowed_tools=)` | 参数由 `CapabilityGate.resolve().allowedTools` 提供 |
| `NITDispatcher._execute_plugin()` 的轻量模式检查 | 删除硬编码，由 Gate 白名单统一控制 |
| `NIT Manager` 的 category/plugin 开关 | 保留为用户运行时 override（Gate 提供基线，NIT Manager 覆盖） |
| Agent 的 `config.json` 中 `dynamic_tools` 字段 | 迁移到 `capabilities.yaml` |

### 5.2 优先级链

```
最终可用工具 = CapabilityGate 基线
             ∩ NIT Manager 运行时开关 (用户可在 UI 上关闭某些工具)
             ∪ Skill 临时解锁 (load_skill 激活的额外工具)
```

### 5.3 新增模式/Agent 的成本

| 操作 | 重构前 | 重构后 |
|---|---|---|
| 新增"学习模式" | 改 prompt_service + dispatcher + agent_config | 在 `capabilities.yaml` 加一个 `study:` 块 |
| 新增 Agent "nana" | 改多处代码逻辑 | 新建 `agents/nana/capabilities.yaml` |
| 新增 NIT 工具 | 改 dispatcher + prompt 注入逻辑 | 在 YAML 的 tools 列表加一行 |
| 新增 Skill | 不支持 | 新建 `skills/builtin/xxx/SKILL.md` |

---

*本文档由 Carola 整理，适用于 PeroCore-TS 能力门控与 Skill 系统架构规范。*
