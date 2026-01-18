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
    *   `scorer_service.py`: 记忆摘要提示词中写死 `AI (Pero):`。
    *   `memory_secretary_service.py`: 每日台词生成提示词写死 `# Role: Pero (Live2D 看板娘)`。
    *   `companion_service.py`: 屏幕观察提示词写死 `【管理系统提醒：Pero，这是你观察到的...】`。
    *   `runtime.py (NIT)`: 工作日志总结提示词写死 `你是 Pero。你刚刚完成了一项编码/工作任务...`。
3.  **插件系统**:
    *   `CharacterOps/description.json`: 描述中写死 `Pero 的状态`。
    *   `CodeSearcher/description.json`: 作者写死 `PeroCore`。

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

### 3.1 提示词原子化策略 (Prompt Atomization Strategy)

为了实现彻底的自定义，我们需要将 **"功能定义 (Function)"** 与 **"人设定义 (Persona)"** 完全解耦。

**原则**: 功能提示词只描述“做什么”，人设提示词只描述“你是谁”。两者在运行时动态拼接。

#### 3.1.1 目录结构规划 (Directory Structure)

```text
backend/services/mdp/prompts/
├── core/               # 系统核心 (Output constraints, Security)
├── capabilities/       # 能力相关 (Vision, Voice, NIT)
├── tasks/              # [NEW] 纯任务逻辑 (Function Definition)
│   ├── scorer_summary.md      # "分析以下对话..." (不含人设)
│   ├── daily_lines.md         # "生成一组问候语..." (不含人设)
│   ├── screen_observation.md  # "这是屏幕截图..." (不含人设)
│   └── work_log.md            # "总结工作内容..." (不含人设)
└── personas/           # [NEW] 人设模板 (Persona Definition)
    └── default.md             # "{{agent_name}} 是一个..."
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

### Phase 1: 原子化与去硬编码 (The Great Decoupling)
**目标**: 不引入新数据库表，仅将代码中的硬编码提取为 MDP 模板变量。
1.  **提取 Inline Prompts**: 将 `scorer`, `companion`, `runtime` 等处的硬编码 Prompt 移入 `mdp/prompts/tasks/`。
2.  **变量替换**: 在后端代码中，统一使用 `bot_name` 变量替换字符串 "Pero"。
3.  **前端清理**: 将前端写死的 "Pero" 替换为从后端配置获取的 `{{ bot_name }}`。

### Phase 2: 数据模型落地 (Model Implementation)
**目标**: 数据库支持多 Agent 存储。
1.  创建 `AgentProfile` 表及迁移脚本。
2.  初始化脚本：系统启动时，将现有的 `identity.md` 内容迁移到数据库，创建一个名为 "Pero" 的默认 Agent。
3.  修改 `PromptManager` 从数据库读取人设。

### Phase 3: 多 Agent 业务逻辑 (Multi-Agent Logic)
**目标**: 后端支持多 Agent 运行。
1.  改造 `AgentService` 的 `chat` 接口，支持 `agent_id`。
2.  改造 `MemoryService`，记忆需要关联 `agent_id` (或共享记忆？需讨论策略)。
3.  实现简单的 Agent 切换逻辑。

### Phase 4: 前端完整支持 (UI/UX)
**目标**: 用户可见的多 Agent 管理。
1.  开发 Agent 管理页面。
2.  升级聊天窗口支持多头像显示。

---

## 5. 待讨论问题 (Open Questions)

1.  **记忆隔离策略**: 不同 Agent 之间是共享记忆库，还是完全隔离？(建议：默认共享事实类记忆，但“人际关系/私有对话”隔离？或者简单点，全共享/全隔离)。
2.  **资源分配**: 多个 Agent 同时运行时，显存/API 限额如何分配？
3.  **Live2D 对应**: 每个 Agent 是否需要绑定特定的 Live2D 模型？(如果是，AgentProfile 需要增加 `live2d_model_id` 字段)。
