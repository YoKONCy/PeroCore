---
description: PeroCore-TS 项目的完整工程规范与架构设计，覆盖命名、API、架构、记忆系统、扩展系统等全部设计决策。在为 PeroCore-TS 编写任何代码之前必须阅读本技能。
---

# PeroCore-TS 工程规范 Skill

> **本文件是对 `_docs_/` 下 15 份规范文档的高密度摘要。**
> 目标读者：AI 编码助手（包括你自己的后续会话）。
> 文档分三类：**S (Standards 规范)** / **A (Architecture 架构)** / **M (Modules 模块说明)**。
> 如需查看完整细节，请阅读对应的 `_docs_/Sxx_*.md` / `_docs_/Axx_*.md` / `_docs_/Mxx_*.md` 源文件。

---

## 0. 项目概况

PeroCore-TS 是 PeroCore (Python) 的 TypeScript 全栈重写。核心卖点：**庞大的 AI 角色记忆系统**。

### 产品命名体系

| 名称 | 含义 | 使用场景 |
|---|---|---|
| **PeroCore** | 后端引擎内核 | 代码仓库名、`packages/backend`、技术文档、Docker 镜像名 |
| **萌动链接：PeroperoChat** | 完整 Electron 桌面应用 | Steam 商店页、用户可见的产品名、窗口标题 |
| **PeroperoChat** | 上述产品的简称 | 日常口语、非正式场合 |
| **PeroCore-TS** | 整个 TS 重构仓库 | 仅开发期使用，区分 Python 版 PeroCore |

> PeroCore 是引擎，PeroperoChat 是产品。关系类似 Unreal Engine 和用它做的游戏。

### 技术栈

- **Monorepo**: pnpm workspace
- **后端**: Hono + Drizzle + better-sqlite3 + TriviumDB (自研 Rust 向量引擎)
- **前端**: Vue 3 + Pinia + Vue Router
- **壳层**: Electron (桌面版) / Docker (服务器版)
- **Rust N-API**: `@perocore/render-core`, `@perocore/nit-runtime`, `@perocore/auditor-wasm`

**包依赖关系**:
```
@perocore/shared ← 无内部依赖
@perocore/backend ← shared + nit-runtime + auditor-wasm
@perocore/frontend ← shared
electron ← frontend + render-core
```

**严禁**: backend import frontend/electron; frontend import backend/electron (除 shared 外); shared 无任何内部依赖。

→ 详见 [A01_PROJECT_STRUCTURE.md](../_docs_/A01_PROJECT_STRUCTURE.md)

---

## 1. 命名规范速查

- **TS 文件**: `camelCase.ts` (`memoryService.ts`, `vectorWriteHelper.ts`)
- **Vue 组件**: `PascalCase.vue` (`ChatInterface.vue`)
- **变量/函数**: camelCase; **类/接口/类型**: PascalCase; **常量**: UPPER_SNAKE_CASE
- **私有成员**: `private` 关键字, **不加下划线前缀**
- **布尔变量**: is/has/can/should 前缀
- **API 路由**: 复数名词 + kebab-case (`/api/memories`, `/api/model-configs`)
- **数据库**: snake_case, 复数表名 (`memory_nodes`, `conversation_logs`)
- **注释/日志**: **中文**（专业术语保留英文）
- **平台特有代码**: `@platform WINDOWS/LINUX/DARWIN/ELECTRON/DOCKER` 标注

→ 详见 [S01_NAMING_CONVENTIONS.md](../_docs_/S01_NAMING_CONVENTIONS.md)

---

## 2. API 响应规范速查

**统一信封**:
```typescript
{ code: string, message: string, data?: T }
```

- `code`: 38 个预定义值 (UPPER_SNAKE_CASE)，新增 code 须先更新文档
- `message`: 中文, 面向用户, 每个 code 有默认 message (CODE_MESSAGES 注册表)
- HTTP 状态码: 15 个 (200/201/202/400/401/403/404/405/409/413/415/422/429/500/502/503/504)
- 分页: `page=1, pageSize=20, max=100`, 响应 `{ items, total, page, pageSize, hasMore }`
- 流式SSE: 不走信封, 事件类型 `delta/tool_call/tool_result/status/done/error`
- 错误处理: `AppError` 类 + 全局 `errorHandler` 中间件

→ 详见 [S02_API_SPEC.md](../_docs_/S02_API_SPEC.md)

---

## 3. 后端三层架构

```
Router 层 (routers/)
  ↓ 接收请求 → Zod 校验 → 调用 Service → 包装响应
Service 层 (services/)
  ↓ 业务逻辑编排 → 调用 Repository → 外部服务
Repository 层 (repositories/)
    数据访问 (SQLite via Drizzle / TriviumDB)
```

**禁令**:
- Router 禁止直接操作 DB, 包含业务逻辑
- Service 禁止 import Hono, 构造 HTTP 响应
- Repository 禁止包含业务逻辑

**DI 容器**: `container.ts` → `createAppContext()` 按依赖顺序初始化

**LLM Provider 模式**: `LlmProvider` 接口 → `OpenAiProvider` / `GeminiProvider` / `AnthropicProvider`

→ 详见 [A02_BACKEND_ARCHITECTURE.md](../_docs_/A02_BACKEND_ARCHITECTURE.md)

---

## 4. 前端架构速查

- **Transport 层**: `ElectronTransport`(IPC) / `HttpTransport`(REST), 运行时自动切换
- **Pinia vs Composable**: Pinia 管跨页面全局状态, Composable 管组件 UI 逻辑
- **性能 P0**: keep-alive 白名单 / 稳定区-尾部区分段渲染 / IntersectionObserver 不可见消息暂停
- **性能 P1**: 分批加载历史消息 / defineAsyncComponent 异步加载 / manualChunks 分包

→ 详见 [A03_FRONTEND_ARCHITECTURE.md](../_docs_/A03_FRONTEND_ARCHITECTURE.md)

---

## 5. 双形态部署

- **Electron 桌面版**: 业务 API 走 HTTP(localhost:9120), IPC 仅用于窗口/托盘等 Electron 专属能力
- **Docker 后端版**: Bun 优先, Nginx 前端静态服务, 无 IPC
- **PathResolver**: `@app/@data/@workshop/@temp` 四前缀，Docker 版无 `@workshop`
- **资源覆盖**: custom > workshop > official
- **CI/CD**: GitHub Actions, lint→test→build→打包; Tag 触发 Release
- **严格隔离**: packages/backend、frontend、shared 里 **0 个 Electron 依赖**

→ 详见 [A04_DEPLOYMENT.md](../_docs_/A04_DEPLOYMENT.md)

---

## 6. 记忆系统架构 (核心!)

这是 PeroCore 最重要的子系统，基于 PEDSA (Pipeline for Embedded Directed Semantic Analysis)。

### 四层存储

| Layer | 载体 | 内容 | 生命周期 |
|---|---|---|---|
| L0 Working | JSON/Context | 当前会话 | 短期 |
| L1 Vector | TriviumDB | 向量+BM25 | 长期 |
| L2 Graph | TriviumDB | 实体图谱 | 长期 |
| L3 Diary | SQLite/TDB | 日记总结 | 永久 |

### 处理管线

Ingest → Tag → Consolidate → Link → Flush

### 关键设计

- **VectorWriteHelper**: 统一 "TriviumDB 写入→失败→补偿入队" 模式
- **LlmJsonParser**: 统一 LLM JSON 输出解析
- **Scorer**: 攒批提炼 (200条/50000字) → 记忆分层
- **混合检索**: HyDE + 向量 + BM25 + 图谱扩散

### 目录结构

```
services/memory/
  memoryService.ts              # 记忆 CRUD
  memorySearch.ts               # 语义检索 + 逻辑闪回
  conversationLog.ts            # 对话日志
  reflection/                   # 反思子系统 (7个文件)
  scorer/                       # 记忆提炼
  graph/                        # 图谱可视化
  importer.ts                   # 故事导入

services/generation/            # LLM 内容生成 (日记/报告)
services/embedding/             # 向量编码 (外部 API 为主)

shared/
  vectorWriteHelper.ts          # 向量写入+补偿
  llmJsonParser.ts              # 鲁棒 JSON 解析
```

→ 详见 [A05_MEMORY_ENGINE.md](../_docs_/A05_MEMORY_ENGINE.md)

---

## 7. 扩展系统

**3 种扩展类型**:
- **Skill**: 任务级知识 + 工具组合指南，SKILL.md 格式，LLM 按需加载 (L1 菜单 / L2 详情)
- **Tool**: 原子 FC 工具，标准 JSON Schema + Handler
- **Hook**: 事件钩子 (`pre_chat`, `post_chat`, `on_event` 等)

**通信模型**: In-process (TS/JS) 或 External (stdio JSON-RPC, MCP 兼容)

→ 详见 [A06_EXTENSION_SYSTEM.md](../_docs_/A06_EXTENSION_SYSTEM.md)

---

## 8. 模式体系

- **桌面** (`desktop`): default / lightweight / companion / work 四种 Profile
- **群聊** (`group_chat`): 据点系统 (Facility → Room → Agent)
- **社交** (`social`): 四层解耦 (Bridge → Manager → Abstract → Adapter)

→ 详见 [M01_MODE_SYSTEM.md](../_docs_/M01_MODE_SYSTEM.md)

---

## 9. 能力门控 (CapabilityGate)

声明式 YAML 矩阵，`(Agent, Mode)` → `allowedTools + enabledSkills + promptFragments`
- 单一权威来源，消除散落的 if-else
- 新增模式/Agent 只需加 YAML 配置

→ 详见 [M02_CAPABILITY_GATE.md](../_docs_/M02_CAPABILITY_GATE.md)

---

## 10. NIT 引擎 (v3.1)

NIT 解释器封装为标准 FC 工具 `run_script`，LLM 通过 Function Calling 调用。
- 支持条件、循环、并行、try-catch
- 禁止函数定义、import、递归
- 脚本内工具调用递归走 ToolRegistry

→ 详见 [M03_NIT_ENGINE.md](../_docs_/M03_NIT_ENGINE.md)

---

## 11. 其他规范

- **日志**: consola, 中文消息, 14天保留 → [S03_LOGGING_SPEC.md](../_docs_/S03_LOGGING_SPEC.md)
- **测试**: Vitest, 模块同步测试, 覆盖率红线 (shared 80% / backend 60% / frontend 50%) → [S04_TESTING_STANDARDS.md](../_docs_/S04_TESTING_STANDARDS.md)
- **代码标准**: 文件大小参考上限, 三层约束, 路径规范, 依赖管理 → [S05_CODE_STANDARDS.md](../_docs_/S05_CODE_STANDARDS.md)
- **Steam**: Electron 专属, Workshop/Cloud/成就 → [M04_STEAM_INTEGRATION.md](../_docs_/M04_STEAM_INTEGRATION.md)

---

## 快速 Checklist

在为 PeroCore-TS 编写代码时, 对照以下检查项:

1. [ ] 文件名用 camelCase? Vue 组件用 PascalCase?
2. [ ] 注释和日志是中文?
3. [ ] API 返回 `{ code, message, data }` 信封? code 在规范表中?
4. [ ] Service 没 import Hono? Router 没包含业务逻辑?
5. [ ] 数据库操作通过 Repository 而非直接 Drizzle/TriviumDB?
6. [ ] 新 Service 接受构造函数注入?
7. [ ] 单个文件 ≤ 500 行 (Vue ≤ 400)?
8. [ ] 向量写入使用 VectorWriteHelper?
9. [ ] LLM JSON 解析使用 LlmJsonParser?
10. [ ] 没有 Electron 依赖渗透到 backend/frontend/shared?
11. [ ] 路径没有硬编码? 使用 `path.join()` 拼接?
12. [ ] 平台特有代码用 `@platform` 标注了?
13. [ ] 平台特化功能用策略模式拆分了独立文件?
14. [ ] 事件监听用 `useEventListener`? 定时器用 `useInterval`?
15. [ ] 大型数组用 `shallowRef` 而非 `ref`?
16. [ ] 新模块有对应的 `*.test.ts` 文件?
17. [ ] 测试用例覆盖了正常路径 + 边界条件 + 错误处理?
18. [ ] 测试描述是中文，说清行为和预期?
