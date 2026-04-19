---
description: PeroCore-TS 项目的完整工程规范与架构设计，覆盖命名、API、架构、记忆系统、扩展系统等全部设计决策。在为 PeroCore-TS 编写任何代码之前必须阅读本技能。
---

# PeroCore-TS 工程规范 Skill

> **本文件是对 `_docs_/00~15` 共 16 份规范文档的高密度摘要。**
> 目标读者：AI 编码助手（包括你自己的后续会话）。
> 如需查看完整细节，请阅读对应的 `_docs_/XX_*.md` 源文件。

---

## 0. 项目概况

PeroCore-TS 是 PeroCore (Python) 的 TypeScript 全栈重写。核心卖点：**庞大的 AI 角色记忆系统**。

### 产品命名体系

| 名称 | 含义 | 使用场景 |
|---|---|---|
| **PeroCore** | 后端引擎内核 | 代码仓库名、`packages/backend`、技术文档、Docker 镜像名 |
| **萌动链接：PeroperoChat** | 完整 Electron 桌面应用 | Steam 商店页、用户可见的产品名、窗口标题 |
| **PeroperoChat** | 上述产品的简称 | 日常口语、非正式场合 |
| **PeroCore-TS** | 整个 TS 重构仓库 | 仅开发period使用，区分 Python 版 PeroCore |

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

→ 详见 [03_PROJECT_STRUCTURE.md](../_docs_/03_PROJECT_STRUCTURE.md)

---

## 1. 已确认决策速查 (D1–D51)

| # | 决策 | 结果 |
|---|---|---|
| D1 | 业务状态码格式 | 字符串枚举 UPPER_SNAKE_CASE (`OK`, `LLM_ERROR`...) |
| D3 | 文件命名 | TS: camelCase, Vue组件: PascalCase |
| D4 | 依赖注入 | 构造函数注入 |
| D7 | 后端框架 | Hono |
| D8 | ORM | Drizzle |
| D9 | 前端状态 | Pinia (全局) + Composable (组件) |
| D10 | Gateway 协议 | 保留 Protobuf, 音频传输优势明显 |
| D11 | Repository 层 | 引入 (双数据源隔离 SQLite + TriviumDB) |
| D12 | 运行时 | Electron=Node.js, Docker=Bun 优先 |
| D13 | 双形态部署 | Electron桌面版 + Docker后端版, 0个Electron依赖渗透 |
| D17 | 日志库 | consola, 日志消息中文 |
| D18 | HTTP 客户端 | 原生 fetch, 不用 axios |
| D22 | 扩展系统 | 统一 ExtensionManager (Tool + Hook + Service) |
| D23 | Service 通信 | v1: stdio JSON-RPC, 预留 HTTP/Zenoh |
| D27 | Embedding/Reranker/ASR | 外部API为主; TS代码与推理无关; Rust可做纯CPU推理; 用户可自部署Ollama等 |
| D28 | 记忆系统拆分 | 按领域能力拆分 7 大子模块 |
| D29 | 跨平台规范 | 路径禁止硬编码 + `@platform` 标注 + 平台策略模式 |
| D30 | 前端性能 | keep-alive 白名单 + 分段渲染 + IntersectionObserver |
| D31 | 单元测试规范 | Vitest + 模块同步测试 + 覆盖率红线 |
| D32 | Gateway 端口 | 耦合同端口 :9120, Hono WS 升级 |
| D33 | Gateway 语言 | TypeScript (Hono), 消息路由 IO-bound 不需 Rust |
| D34 | 鉴权系统 | 单用户 Token/密码 + JWT 7天, Electron 跳过 |
| D35 | 记忆 Token 优化 | ⏳ 暂定: 攒批 Scorer + 日记图谱一体化 + 人设注入修复 |
| D36 | Steam 模块边界 | Electron 专属, Docker 零 Steam 依赖 |
| D37 | 虚拟路径管理 | PathResolver 四前缀 (@app/@data/@workshop/@temp) |
| D38 | 资源覆盖优先级 | custom > workshop > official, 条件扫描 |
| D39 | 资源读取职责 | 后端直接读 (不走 IPC), config 后端写前端只读 |
| D40 | Cloud 同步策略 | 全量覆写 + 时间戳冲突, 10GB 配额 |
| D41 | CI/CD | GitHub Actions, lint→test→build→打包 |
| D42 | 数据库迁移 | Drizzle Kit, 向前兼容, TriviumDB 无需迁移 |
| D43 | 版本发布 | SemVer + changesets, 三渠道发布 |
| D44 | 代码搜索工具 | ripgrep 替代自研 CodeSearcher, 预编译二进制分发 |
| D45 | AuraVision | 暂不迁移, 功能冻结 (384维模型不兼容) |
| D46 | 多目标构建 | Edition+Platform 双轴解耦, 6 变体, IS_STEAM 门控 |
| D47 | 自动更新 | Steam 自带 / electron-updater / docker pull |
| D48 | 跨设备同步 | Electron 远程直连 Docker, 零同步逻辑 |
| D49 | PEDSA v2 | minGRU(256维) + Leiden聚类 + 检索反馈闭环 |
| D50 | 三层记忆隔离 | 日记共享中转 + Store级物理隔离 + 对话层 |
| D51 | Capability Gate | 声明式 YAML 矩阵 + Skill 渐进式加载 |

→ 详见 [00_DECISIONS.md](../_docs_/00_DECISIONS.md)

---

## 2. 命名规范速查

- **TS 文件**: `camelCase.ts` (`memoryService.ts`, `memory.repo.ts`, `memory.router.ts`)
- **Vue 组件**: `PascalCase.vue` (`ChatInterface.vue`)
- **变量/函数**: camelCase; **类/接口/类型**: PascalCase; **常量/枚举值**: UPPER_SNAKE_CASE
- **私有成员**: `private` 关键字, **不加下划线前缀**
- **布尔变量**: is/has/can/should 前缀
- **API 路由**: 复数名词 + kebab-case (`/api/memories`, `/api/memories/retry-sync`)
- **数据库**: snake_case, 复数表名 (`memory_nodes`, `conversation_logs`)
- **注释/日志**: **中文**（专业术语保留英文）

→ 详见 [01_NAMING_CONVENTIONS.md](../_docs_/01_NAMING_CONVENTIONS.md)

---

## 3. API 响应规范速查

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

→ 详见 [02_API_RESPONSE_SPEC.md](../_docs_/02_API_RESPONSE_SPEC.md)

---

## 4. 后端三层架构

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

→ 详见 [04_BACKEND_ARCHITECTURE.md](../_docs_/04_BACKEND_ARCHITECTURE.md)

---

## 5. 前端架构速查

- **统一 ApiClient**: 禁止直接 fetch, 所有请求走 `apiClient.get/post/put/delete`
- **Transport 层**: `ElectronTransport`(IPC+HTTP) / `HttpTransport`(纯HTTP), 运行时自动切换
- **API 模块**: 按域拆分 `api/modules/memoryApi.ts` 等
- **错误分级**: `SILENT / TOAST / MODAL`, 由 `ERROR_UI_MAP[code]` 决定
- **Pinia vs Composable**: Pinia 管跨页面全局状态, Composable 管组件 UI 逻辑

→ 详见 [05_FRONTEND_ARCHITECTURE.md](../_docs_/05_FRONTEND_ARCHITECTURE.md)

---

## 6. 文件大小硬限

| 类型 | 最大行数 |
|---|---|
| Vue SFC | **400** |
| TS Service | **500** |
| Electron 主进程 | **300** |
| Router / Repository | **300 / 400** |

超过必须拆分。原 v1 巨型文件的拆分方案在文档中有详细列出。

→ 详见 [06_FILE_SIZE_LIMITS.md](../_docs_/06_FILE_SIZE_LIMITS.md)

---

## 7. 双形态部署

- **Electron 桌面版**: 所有业务 API 走 HTTP(localhost:9120), IPC 仅用于窗口/托盘/文件对话框等 Electron 专属能力
- **Docker 后端版**: Bun 优先, Nginx 前端静态服务, 无 IPC
- **严格隔离**: packages/backend、frontend、shared 里 **0 个 Electron 依赖**

→ 详见 [07_DUAL_DEPLOYMENT.md](../_docs_/07_DUAL_DEPLOYMENT.md)

---

## 8. 日志规范

- 库: **consola**, 用 `createLogger(module)` 创建带 tag 的 logger
- 级别: error > warn > info > debug
- 语言: 日志消息**中文**, 结构化字段用英文 key
- 前端: 统一 `logger.info(tag, message, data)`, 禁止裸 `console.log`

→ 详见 [08_LOGGING_SPEC.md](../_docs_/08_LOGGING_SPEC.md)

---

## 9. 扩展系统 (Mod/Plugin)

**3 种扩展类型**:
- **Tool**: Agent 可调用的能力, 同进程 `import()`, manifest.json + `ToolExtension` 接口
- **Hook**: 事件钩子注入, `before*/after*` 模式, 可修改数据/中断链
- **Service**: 独立进程运行, stdio JSON-RPC (MCP 协议兼容), 进程隔离

**统一清单**: `manifest.json` (取代 v1 的 `mod.toml` + `asset.json`)

**Hook 已定义事件**: `chat:beforeSend`, `chat:afterReply`, `memory:beforeCreate`, `memory:afterCreate`, `agent:onSwitch`, `app:onStart` 等

**热重载**: 开发模式 fs.watch 自动, 生产 API 手动 `POST /api/extensions/{id}/reload`

→ 详见 [09_EXTENSION_SYSTEM.md](../_docs_/09_EXTENSION_SYSTEM.md)

---

## 10. 记忆系统架构 (核心!)

这是 PeroCore 最重要的子系统。原 Python 版存在严重技术债 (上帝类, Copy-Paste, 循环依赖), v2 按领域能力全面重构。

### v2 目录结构

```
services/memory/
  memoryService.ts              # 记忆 CRUD
  memorySearch.ts               # 语义检索 + 逻辑闪回
  conversationLog.ts            # 对话日志 (独立领域)
  reflection/                   # 反思子系统
    reflectionOrchestrator.ts   # 编排入口
    consolidator.ts             # 记忆整合
    tagger.ts                   # 标注+归簇
    auditor.ts                  # 错误审计
    retirementPolicy.ts         # 退役策略
    dreamAssociator.ts          # 梦境关联
    graphGardener.ts            # 图谱园丁
  scorer/                       # 记忆提炼
    scorerService.ts            # 对话→记忆
    scorerRecovery.ts           # 重试恢复
  graph/memoryGraph.ts          # 图谱可视化
  importer.ts                   # 故事导入

services/generation/            # LLM 内容生成 (与记忆分离!)
  diaryGenerator.ts             # 桌宠日记
  reportGenerator.ts            # 周报/社交日报/工作日志
  waifuTextUpdater.ts           # Waifu 台词

services/embedding/             # 向量编码
  embeddingService.ts           # 门面
  providers/apiProvider.ts      # 远程 API (唯一实现)

shared/
  vectorWriteHelper.ts          # 向量写入+补偿 (消除 10+ 处 Copy-Paste)
  llmJsonParser.ts              # 鲁棒 JSON 解析 (消除 5+ 处 Copy-Paste)
```

### 关键设计决策

- **Embedding**: 外部 API 为主, TS 代码与本地推理无关
- **VectorWriteHelper**: 统一 "TriviumDB 写入→失败→补偿入队" 模式
- **LlmJsonParser**: 统一 LLM JSON 输出解析 (````json``` 代码块 / 裸 {} / [])
- **MDP 迁移**: Jinja2 → Nunjucks (API 兼容), 提示词 .md 文件直接平移
- **所有文件 ≤ 500 行**, 原 ReflectionService 1933 行拆成 7 个文件

→ 详见 [10_MEMORY_SYSTEM.md](../_docs_/10_MEMORY_SYSTEM.md)

---

## 11. 跨平台与路径规范

**路径**:
- **禁止硬编码任何路径**，所有路径通过环境变量/配置/运行时计算
- 路径拼接**必须用 `path.join()`**，禁止手动拼 `/` 或 `\`
- 统一路径工厂 `lib/paths.ts`: `getDataDir()`, `getDatabasePath()`, `getAgentWorkspace(id)`, `getTriviumDir()` 等

**平台特有代码**:
- 必须用醒目的块注释 + `@platform` 标签标注: `@platform WINDOWS`, `@platform LINUX`, `@platform DARWIN`, `@platform ELECTRON`, `@platform DOCKER`
- 平台特化功能用**策略模式**：门面文件 `foo.ts` + 平台实现 `foo.win32.ts` / `foo.linux.ts` / `foo.darwin.ts`
- 平台常量 `lib/platform.ts`: `IS_WINDOWS`, `IS_LINUX`, `IS_DARWIN`, `IS_ELECTRON`, `IS_DOCKER`

**常见陷阱**: 大小写敏感(Linux)、文件锁(Windows)、换行符(CRLF/LF)、信号处理(SIGTERM)、Shell差异(cmd/bash)、localhost IPv6

→ 详见 [11_CROSS_PLATFORM.md](../_docs_/11_CROSS_PLATFORM.md)

---

## 12. 前端性能优化（含 VCPChat 参考）

原 v1 前端存在严重性能隐患，v2 综合自身审计和 VCPChat 最佳实践在架构层面解决：

**P0 必须做**:
- `<keep-alive>` 加 `:include` 白名单，只缓存 DashboardView→离开 Pet3DView 时释放 GPU/Three.js
- 统一 `useEventListener` / `useInterval` composable，兼容 keep-alive 的 activated/deactivated
- SSE Markdown **稳定区/尾部区分段渲染**（参考 VCPChat）：已闭合结构只渲染一次，尾部 30fps 限流更新
- **IntersectionObserver 不可见消息暂停**（参考 VCPChat）：自动暂停不可见消息的动画/视频/Canvas

**P1 应该做**:
- **分批加载历史消息**（参考 VCPChat）：先渲染最新 5 条，用 `requestIdleCallback` 分批补充旧消息
- Tab 组件 `defineAsyncComponent` 异步加载，首屏 JS -40%
- Vite `manualChunks` 分包（vue/three/marked/monaco/protobuf 各自独立）

**P2 建议做**:
- 大型数组用 `shallowRef`（已部分采用，扩展到消息列表）
- **双模式渲染流水线**（参考 VCPChat）：FULL_RENDER(11步) vs STREAM_FAST(4步)
- Markdown 渲染移入 Web Worker
- 图片懒加载 + WebP 优化

→ 详见 [12_FRONTEND_PERFORMANCE.md](../_docs_/12_FRONTEND_PERFORMANCE.md)

---

## 13. 单元测试规范 (D31)

**核心原则：每开发一个模块，必须同步编写对应的单元测试。**

**技术栈**: Vitest + @vue/test-utils + msw

**文件组织**: Co-located（测试文件与源码同目录）
- 单元测试: `<模块名>.test.ts`
- 集成测试: `<场景名>.integration.test.ts`
- 组件测试: `<组件名>.test.ts`

**必须测试的模块类型**:
- Service 层（Mock Repository）
- Repository 层（内存 SQLite `:memory:`）
- Composable（`withSetup` 辅助）
- Pinia Store（`createTestingPinia`）
- 工具函数

**豁免范围**: 纯类型定义、纯常量、配置文件、入口引导文件

**覆盖率红线**: shared 80%，backend 60%，frontend 50%

**测试描述**: 使用中文，AAA 模式 (Arrange-Act-Assert)

→ 详见 [13_TESTING_STANDARDS.md](../_docs_/13_TESTING_STANDARDS.md)

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
