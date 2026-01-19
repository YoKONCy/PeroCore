# PeroCore 多 Agent 架构重构技术方案 (Multi-Agent Refactoring Plan)

## 1. 核心目标 (Objectives)

打破当前代码库与 "Pero" 人格的强耦合，将系统升级为支持 **多 Agent 共存、自定义与群聊** 的通用 AI 代理平台。
用户可以自定义 Agent 的名字、人设、头像、语气风格，甚至为不同的 Agent 分配不同的模型和职责。

## 2. 现状与痛点 (Current State & Issues)

目前系统中 "Pero" 的存在是**分形 (Fractal)** 的，即在从宏观架构到微观代码的各个层面都有硬编码。

### 2.1 硬编码分布清单 (Hardcoding Audit)

#### A. 后端服务 (Backend Services)
1.  **System Prompts**:
    *   `mdp/prompts/identity.md`: 直接定义了 "Identity: Pero" 和性格。
    *   `prompt_service.py`: 默认变量 `bot_name="Pero"`, `mind="正在想主人..."`。
2.  **Inline Prompts (隐式硬编码)**:
    *   **`scorer_service.py`**:
        *   `Fallback Prompt` (Line 145): 记忆摘要提示词中写死 `AI (Pero):`。
    *   **`memory_secretary_service.py`**:
        *   `Daily Lines Prompt`: 每日台词生成提示词写死 `# Role: Pero (Live2D 看板娘)`。
        *   `Memory Auditor Prompt` (Line 171): 记忆清洗提示词写死 `你是 Pero 的记忆秘书...`。
    *   **`companion_service.py`**:
        *   `System Prompt Injection` (Line 347): `[陪伴模式核心指令] ... 以你的角色身份...` (逻辑与人设混合)。
        *   `User Message Injection` (Line 349): `【管理系统提醒：Pero，这是你观察到的...】` (直接称呼 Pero)。
        *   `Memory Summary Prompt` (Line 169): `role = "Pero" ...`。
    *   **`runtime.py (NIT)`**:
        *   工作日志总结提示词写死 `你是 Pero。你刚刚完成了一项编码/工作任务...`。
3.  **Hidden/Functional Prompts (功能性提示词污染)**:
    *   **`AgentService`**:
        *   `_run_reflection` (Line 295): 硬编码的 UI 自动化反思 System Prompt (需去人格化)。
        *   `_analyze_file_results_with_aux`: 辅助模型分析 User Prompt (需去人格化)。
        *   `handle_proactive_observation`: `[PERO_INTERNAL_SENSE]` 视觉感知 Prompt。
    *   **`MemoryService`**:
        *   `get_relevant_memories`: 意图识别关键词字典 (`cluster_keywords`) 可能包含特定人设倾向。

#### B. 前端界面 (Frontend & UI)
1.  **Chat UI (`ChatInterface.vue`)**:
    *   Line 57: 消息发送者名字写死 `Pero`。
    *   Line 49: 默认头像占位符写死 `P`。
    *   Line 86/104: 思考中状态写死 `Pero 正在思考...`。
2.  **Dashboard UI (`DashboardView.vue`)**:
    *   聊天记录列表名字写死 `Pero`。
    *   头像 Emoji 写死 `🎀`。
3.  **Launcher UI (`LauncherView.vue`)**:
    *   Line 18: Sidebar 标题 `<span ...>PERO</span>`。
    *   Line 43: 硬编码版本号 `v0.1.0`。

*   **Hidden Prompts Audit (Backend)**:
    *   **AgentService**:
        *   `_run_reflection`: 硬编码的 UI 自动化反思 System Prompt。
        *   `handle_proactive_observation`: `[PERO_INTERNAL_SENSE]` 视觉感知 Prompt。
        *   `_analyze_file_results_with_aux`: 辅助模型分析文件的 User Prompt 拼装逻辑。
        *   `mobile_instruction`: 针对手机端的 Context 注入。
        *   `active_windows`: 活跃窗口列表的 Context 注入。
    *   **MemoryService**:
        *   `get_relevant_memories`: 硬编码的意图识别关键词字典 (`cluster_keywords`)。
    *   **Vision Tool Description**:
        *   `AgentService`: 动态修改 `see_screen` 工具描述的逻辑。
    *   Line 58: Header 标题 `Pero Launcher`。

#### C. Live2D 与交互 (Live2D & Interaction)
1.  **静态台词库 (`waifu-texts.json`)**:
    *   所有 Key 对应的 Value 均以 "Pio" (Live2D 模型原名) 或 "Pero" 自称。
    *   例如: `idleMessages_01: "主人～Pio在这儿等你拥抱呀！"`。
    *   这些台词在没有 LLM 生成的动态台词覆盖时，是默认回退内容。
2.  **交互脚本 (`waifu-tips.js`)**:
    *   可能包含对模型名称的特定判断逻辑。

#### D. 社交适配器 (Social Adapter)
1.  **QQ 机器人**:
    *   虽然有 `nickname` 获取逻辑，但在处理群聊上下文、欢迎语、请求处理逻辑中可能存在对 "Pero" 身份的默认假设。

---

## 3. 重构架构设计 (Architecture Redesign)

### 3.1 提示词原子化与统一管理策略 (Prompt Atomization & Centralization)

**核心原则**: 
1.  **彻底解耦**: 将 "功能定义 (Function)" 与 "人设定义 (Persona)" 完全分离。
2.  **统一托管**: 代码库中**严禁出现任何 Inline Prompts (硬编码提示词)**。所有的提示词（无论是系统指令、功能性任务、还是对话引导）必须统一存放于 `backend/services/mdp/prompts/` 目录下，通过 `PromptManager` 或 `MDPManager` 加载。

#### 3.1.1 目录结构规划 (Directory Structure)

```text
backend/services/mdp/prompts/
├── core/                   # 系统核心 (Output constraints, Security)
│   ├── system_template.md  # 主系统提示词模板
│   └── safety.md           # 安全/拒绝回复策略
├── capabilities/           # 能力相关 (Vision, Voice, NIT)
│   ├── vision_analyze.md   # 视觉分析指令
│   └── reflection.md       # 自动化反思指令
├── tasks/                  # [NEW] 功能性任务 (原 Inline Prompts 迁移区)
│   ├── analysis/           # 分析类任务
│   │   ├── scorer_summary.md   # 对话评分/记忆摘要
│   │   └── file_analysis.md    # 辅助模型文件分析
│   ├── maintenance/        # 维护类任务
│   │   ├── daily_lines.md      # 每日问候语生成
│   │   └── memory_auditor.md   # 记忆清洗/审计
│   ├── companion/          # 陪伴模式任务
│   │   ├── screen_observe.md   # 屏幕观察引导
│   │   └── proactive_chat.md   # 主动搭话生成
│   └── nit/                # NIT 运行时任务
│       └── work_log.md         # 工作日志总结
├── context/                # [NEW] 上下文注入片段
│   ├── mobile.md           # 移动端指令注入
│   ├── active_windows.md   # 活跃窗口列表注入
│   └── social_history.md   # 社交历史摘要注入
└── personas/               # [NEW] 人设模板 (Persona Definition)
    └── default.md          # "{{agent_name}} 是一个..." (默认人设)
```

#### 3.1.2 组合逻辑 (Composition Logic)

**Old Way (Coupled):**
```markdown
# Role: Pero
你是一个可爱的看板娘 Pero。
请分析以下对话并生成摘要...
```

**New Way (Atomized):**
```python
# 运行时动态组合
system_prompt = render(task_template) + "\n\n" + render(persona_template)
```

*   **Task Template (`tasks/scorer_summary.md`)**:
    ```markdown
    # Task: Conversation Analysis
    请分析 User 和 Assistant 之间的对话。
    Assistant 的名字是: {{agent_name}}。
    ...
    ```
*   **Persona Template (来自数据库)**:
    ```markdown
    # Identity
    {{agent_name}} 是一个冷酷的杀手...
    语气风格: {{agent_style}}
    ```

#### 3.1.3 文档溯源规范 (Traceability Standards)

为了防止提示词与代码逻辑脱节，**所有 MDP 文档必须包含溯源注释**。

*   **Header Requirement**: 每个 Markdown 文件顶部必须包含 YAML Front Matter 或注释，指明该提示词被哪个 Service 的哪个方法调用。

**Example (`mdp/prompts/tasks/maintenance/daily_lines.md`)**:
```markdown
<!-- 
Target Service: backend/services/memory_secretary_service.py
Target Function: _generate_daily_lines
Injected Via: MDPManager.render("maintenance/daily_lines")
-->

# Task: Generate Daily Greetings
...
```

#### 3.1.4 递归占位符与嵌套支持 (Recursive Placeholder Resolution)

**核心要求**:
1.  **全量占位符化**: 代码中禁止硬编码拼接字符串。所有动态内容（包括子 Prompt 模块）必须通过 `{{ variable_name }}` 占位符注入。
2.  **嵌套支持**: MDP 渲染引擎必须支持**递归解析 (Recursive Resolution)**。
    *   即：模板 A 包含 `{{ template_b }}`，而模板 B 中又包含 `{{ user_name }}`。
    *   渲染时，系统应自动展开所有层级的占位符，直到没有未解析的 `{{ ... }}` 为止。

**Example**:
*   `system_template.md`:
    ```markdown
    # System
    {{ persona_definition }}
    {{ task_instruction }}
    ```
*   `personas/pero.md` (injected as `persona_definition`):
    ```markdown
    我是 {{ agent_name }}，你的 {{ agent_role }}。
    ```
*   **Result**: 渲染引擎需自动将 `{{ agent_name }}` 解析为具体值，而非保留原样。

### 3.2 数据模型层 (Data Model)

新增 `AgentProfile` 模型，用于存储每个“灵魂”的定义。

```python
class AgentProfile(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    
    # 基础信息
    name: str = Field(index=True)           # 名字 (如 "Pero", "Alter")
    avatar_url: str = Field(default="")     # 头像路径
    description: str = Field(default="")    # 简短描述 (UI展示用)
    
    # 人设核心
    system_prompt: str = Field(sa_column=Column(Text)) # 完整的自定义 System Prompt (Markdown)
    
    # 风格指导 (用于注入到辅助任务 Prompt)
    tone_style: str = Field(default="可爱、活泼、高效") # e.g. "冷酷、理性、简洁"
    
    # 配置
    model_config_id: Optional[int] = Field(default=None, foreign_key="aimodelconfig.id")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.now)
```

### 3.3 服务层改造 (Service Layer)

#### `AgentManager` (New Service)
*   负责管理多个 Agent 的生命周期。
*   提供 `get_current_agent()`, `switch_agent(id)` 等接口。
*   支持群聊模式下的“路由分发”：决定当前消息由哪个 Agent 回复。

#### `PromptManager`
*   移除所有硬编码默认值。
*   `build_system_prompt` 接收完整的 `AgentProfile` 对象，而非零散变量。

### 3.4 前端交互 (Frontend)

1.  **Agent 管理面板**:
    *   创建/编辑/删除 Agent。
    *   人设编辑器 (Markdown)。
    *   头像上传。
2.  **多角色聊天 UI**:
    *   聊天气泡根据消息的 `agent_id` 动态显示头像和名字。
    *   输入框上方增加“当前对话对象”切换器。
    *   (未来) 群聊模式 UI。

---

## 4. 实施路线图 (Execution Roadmap)

### Phase 1: MDP 引擎升级与目录重构 (Infrastructure First)
**目标**: 建立强大的 Prompt 管理基座，确保所有提示词都能被模块化管理和递归解析。

1.  **升级 MDPManager**:
    *   实现 Jinja2 递归渲染 (Recursive Rendering) 逻辑，支持 `{{ nested_template }}` 的自动展开。
    *   支持从 `mdp/prompts/` 下的任意子目录加载模板。
2.  **重构目录结构**:
    *   按照 3.1.1 规划，建立 `core`, `capabilities`, `tasks`, `context`, `personas` 等子目录。
    *   确保所有新文件都包含 Traceability Header。

### Phase 2: 提示词迁移与人设解耦 (The Great Migration)
**目标**: 消灭代码中的 Inline Prompts，实现 Function (功能) 与 Persona (人设) 的彻底分离。

1.  **迁移 Inline Prompts (硬编码大清洗)**:
    *   **ScorerService**: 提取 Fallback Prompt 到 `tasks/analysis/scorer_summary.md`。
    *   **CompanionService**: 提取屏幕观察 Prompt 到 `tasks/companion/screen_observe.md`。
    *   **MemorySecretary**: 提取 Auditor Prompt 到 `tasks/maintenance/memory_auditor.md`。
    *   **AgentService**: 提取 Reflection/Vision/Aux Prompts 到 `capabilities/` 和 `tasks/`。
    *   **NIT Runtime**: 提取 Work Log Prompt 到 `tasks/nit/work_log.md`。
2.  **人设与功能分离**:
    *   **去人格化**: 确保上述功能性 Prompt 中不包含 "Pero"、"看板娘" 等具体人设描述，改为 "Assistant"、"Observer" 等中立称呼。
    *   **模块化人设**: 将 `identity.md` 拆分为 `personas/default.md` (或 `pero.md`)。
    *   **动态拼接**: 修改 `PromptManager`，在生成 System Prompt 时动态拼接 `Function Template` + `Persona Template`。

### Phase 3: 全局硬编码清理 (The Cleanup)
**目标**: 消除前端、日志、Live2D 等非 Prompt 区域的 "Pero" 硬编码。

1.  **前端清理 (Frontend)**:
    *   修改 `ChatInterface.vue`, `DashboardView.vue`, `LauncherView.vue`。
    *   将硬编码的 "Pero" 文本/头像替换为从后端配置接口获取的动态变量 (`{{ bot_name }}`, `{{ bot_avatar }}`)。
2.  **日志与工具清理**:
    *   规范化后端日志输出，移除 "Pero says..." 等硬编码，改为 "Agent says..."。
    *   更新插件描述 (`description.json`) 中的硬编码名称。
3.  **Live2D 配置化**:
    *   将 `waifu-texts.json` 中的台词模板化，或建立多份台词库以支持不同 Agent。

### Phase 4: 多 Agent 架构落地 (Multi-Agent Implementation)
**目标**: 引入数据库模型，支持真正的多角色切换与并发。

1.  **数据模型建设**:
    *   创建 `AgentProfile` 表。
    *   编写迁移脚本，将现有配置迁移入库。
2.  **服务层改造**:
    *   实现 `AgentManager` 服务。
    *   改造 `AgentService.chat` 接口支持 `agent_id`。
3.  **UI 完整支持**:
    *   开发 Agent 管理面板。
    *   实现多角色切换与群聊 UI。

---

## 5. 待讨论问题 (Open Questions)

1.  **记忆隔离策略**: 不同 Agent 之间是共享记忆库，还是完全隔离？(建议：默认共享事实类记忆，但“人际关系/私有对话”隔离？或者简单点，全共享/全隔离)。
2.  **资源分配**: 多个 Agent 同时运行时，显存/API 限额如何分配？
3.  **Live2D 对应**: 每个 Agent 是否需要绑定特定的 Live2D 模型？(如果是，AgentProfile 需要增加 `live2d_model_id` 字段)。
