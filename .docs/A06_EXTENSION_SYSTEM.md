# 扩展系统 (Extension System)

> **适用范围**：`packages/backend/src/extensions/`
> **最后更新**：2026-04-21

---

## 1. 扩展分类

infOS 扩展分为三种类型：

| 类型 | 说明 | 实现方式 |
|---|---|---|
| **Skill (技能)** | 任务级知识与工具组合指南 | `SKILL.md` (YAML + Markdown) |
| **Tool (工具)** | 原子功能扩展 (v1 插件) | 标准 FC 工具 schema + Handler |
| **Hook (钩子)** | 生命周期干预 (消息前置/后置处理) | 事件监听与拦截器 |

---

## 2. Skill 系统 (核心)

Skill 取代了传统意义上的"复杂助手配置"，允许 LLM 按需加载。

### 2.1 文件结构
```
skills/
└── weekly_report/
    ├── SKILL.md       # 指令文件
    └── references/    # 参考资料 (JSON/Schema)
```

### 2.2 SKILL.md Frontmatter 格式

```yaml
---
name: 周报生成器
description: 自动汇总本周工作并生成格式化周报
category: productivity
tags:
  - report
  - automation
requiredTools:
  - read_file
  - write_file
parameters:
  - project_name: 项目名称
  - date_range: 日期范围 (如 2026-04-20~2026-04-26)
dependsOnSkills:
  - file_organizer
---
(Markdown 指令内容，支持 {{project_name}} 模板变量...)
```

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `name` | ✅ | Skill 显示名称 |
| `description` | ✅ | L1 菜单摘要 |
| `category` | — | 分类 (默认 `general`) |
| `tags` | — | 标签列表 (便于搜索) |
| `requiredTools` | — | 加载时临时解锁的工具 ID |
| `parameters` | — | 可接收的参数 (模板变量名 → 描述) |
| `dependsOnSkills` | — | 依赖的子 Skill ID (递归解锁工具) |

### 2.3 渐进式加载 (L1→L2)
- **L1 (菜单)**：随 System Prompt 注入，仅含 Skill 名和简短描述。
- **L2 (详情)**：LLM 调用 `load_skill(skill_id, params?)` 后注入完整的执行步骤。

### 2.4 参数化 Skill

Agent 调用 `load_skill` 时可传入 `params` 参数：
```json
{ "skill_id": "weekly_report", "params": { "project_name": "infOS", "date_range": "2026-04-20~2026-04-26" } }
```
SkillLoader 会将 SKILL.md body 中的 `{{project_name}}` 替换为实际值。

### 2.5 嵌套调用

Skill 声明 `dependsOnSkills` 后，加载时会递归解锁子 Skill 的工具权限。
Agent 可在执行父 Skill 指令的过程中，按需 `load_skill` 子 Skill 获取更细粒度的指令。
系统通过 `visited` 集合防止循环依赖。

---

## 3. Tool 系统 (标准 FC)

所有工具必须符合主流 LLM 的 **Function Calling** 规范。

```typescript
interface ExtensionTool {
  name: string
  description: string
  parameters: object // JSON Schema
  handler: (args: any) => Promise<any>
}
```

---

## 4. Hook 管道 (Pipe)

后端提供消息流转管道，支持扩展介入：

- **`pre_chat`**：修改用户输入或注入额外上下文。
- **`post_chat`**：处理 LLM 输出或触发外部副作用（如灯光控制）。
- **`on_event`**：监听系统事件（如 Agent 切换、记忆落盘）。

---

## 5. 通信模型 (RPC)

支持两种运行方式：

1. **In-process (TypeScript/WebWorker)**：直接加载 `.ts`/`.js` 扩展，执行速度快。
2. **External (stdio JSON-RPC)**：通过标准输入输出与外部进程通信（如 Python/Go 脚本），符合 MCP 协议规范。

---

## 6. 安全与权限

扩展必须在元数据中声明权限：
- `network`: 是否允许网络请求。
- `filesystem`: 读写权限范围（限 `@data/workspace/`）。
- `vision`: 访问屏捕内容。

## 7. AIOS 权限与运行时边界

扩展、Skill 与 Tool 是 Tool Capability 的受控资源，完整模型见 [A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md#6-workspace-与-tool-capability)。

- 能力解析维度是 `(agentId, channel)`，不是全局 mode；未知或未配置 channel 必须 fail-closed。
- 工具描述注入和实际 Handler 执行必须复用同一 CapabilityGate 判定；`run_script`、平台能力和扩展快捷路径均不得绕过门控。
- 文件权限必须以资源根和 containment 为单位配置，默认仅限 Principal/App Workspace，禁止把安装目录、Workshop 目录或 Runtime Data Space 当作通用可写目录。
- AgentApplication/SubAgent 是未来应用层：其工具权限为应用白名单与子任务 scope 的交集，记忆通过 Checkpoint 交给宿主 Agent 的 MemoryGate，而非直接写入主记忆。

---

*本文档由 Carola 整理，适用于 infOS-TS 扩展系统规范。*
