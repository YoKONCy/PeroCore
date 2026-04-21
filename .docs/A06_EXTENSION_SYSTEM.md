# 扩展系统 (Extension System)

> **适用范围**：`packages/backend/src/extensions/`
> **最后更新**：2026-04-21

---

## 1. 扩展分类

PeroCore 扩展分为三种类型：

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
└── diary_query/
    ├── SKILL.md       # 指令文件
    └── references/    # 参考资料 (JSON/Schema)
```

### 2.2 渐进式加载 (L1-L2)
- **L1 (菜单)**：随 System Prompt 注入，仅含 Skill 名和简短描述。
- **L2 (详情)**：LLM 调用 `load_skill` 后注入完整的执行步骤。

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

---

*本文档由 Carola 整理，适用于 PeroCore-TS 扩展系统规范。*
