# P5 后端攻坚计划 (v3 · 已确认版)

> **日期**：2026-04-19 23:18 · **状态**：主人已确认，开始执行
> **策略**：先啃后端，做完一整面再串前端
> **当前**：98 个 TS 文件 / 9,489 行 / tsc 零错误
> **目标**：填充至 ~28,500 行
>
> ### v3 修正 (主人反馈)
> 1. **NIT v3 解释器 = 纯 TS** (1,232 行已实装)，Rust 模块负责 minGRU/Leiden/WASM/加密
> 2. **Hook 接入点** 必须在 B2b 规划、B3/B4/B6 预埋
> 3. **`packages/native/` 脚手架** 纳入 B0 (含 TS mock + workspace 更新)

---

## 之前遗漏了什么？

| 遗漏模块 | 来源文档 | 估算 |
|---|---|---|
| **`@perocore/shared` 共享层** | 02_API_RESPONSE_SPEC (38 个 code + AppError + 分页) | ~800 行 |
| **扩展系统 (ExtensionManager + 13 个内置 Tool)** | 09_EXTENSION_SYSTEM 758 行规范 | ~3,000 行 |
| **PEDSA v2 认知检索引擎** | 10_MEMORY_SYSTEM §14 (ContextRNN + Leiden + 反馈闭环) | ~1,500 行 |
| **三层记忆隔离 + 日记中转** | 10_MEMORY_SYSTEM §15 (Store 级物理隔离 + 日记共享层) | ~600 行 |
| **Token 优化策略** | 10_MEMORY_SYSTEM §10-13 (Scorer 攒批 + 日记一体化 + Reflection 降频) | ~500 行 |
| **路由补全** | 02_API (SSE 事件规范) + 09 (扩展 API) | ~400 行 |
| **PathResolver + AssetRegistry 完善** | 14_STEAM (Workshop 路径 + 资产覆盖) | ~200 行 |
| | **共计遗漏** | **~7,000 行** |

---

## 全景：后端文件分层统计 (修正版)

```
层                  文件数  行数    状态
──────────────────────────────────────────
基础设施             12      584    ✅ 完成
Database/Schema      3       329    ✅ 完成
NIT v3               5     1,232    ⚠️ 90% (runtime 接入)
Repository           6       845    ⚠️ 70% (向量检索)
Router               9       728    ⚠️ 50% (handler 空壳)
Schema (Zod)         2        55    ⚠️ 需扩充
Service/LLM          5       769    ⚠️ 60% (HTTP 调用未实现)
Service/Agent        6     1,041    ⚠️ 40% (核心逻辑空)
Service/Memory       11    1,488    ⚠️ 30% (Reflection 空壳)
Service/Pipeline     8       500    ⚠️ 30% (5阶段空)
Service/Other        8       748    ⚠️ 50% (Prompt/Scheduler/Session/Gateway)
Shared               4       272    ✅ 完成
Capabilities         4       454    ✅ 完成
── 以下为完全缺失 ──
@perocore/shared     8       388    ⚠️ 30% (基础类型有，code 不全)
packages/native/     0         0    ❌ 目录不存在 (3 个 Rust 子包)
扩展系统             0         0    ❌ (ExtensionMgr + 13 Tool)
PEDSA v2             0         0    ❌ (ContextRNN/Leiden/Feedback)
──────────────────────────────────────────
总计                98    9,489
预估目标                  ~28,000    (+18,500 行)
```

---

## 攻坚批次 (9 批，按依赖链序)

### B0: 共享层 + Native 脚手架 + Workspace (~1,000 行)

> **三件事：shared 补全 + native mock + workspace 更新**

#### B0-1: `@perocore/shared` 补全

| 文件 | 工作内容 |
|---|---|
| `shared/src/constants/responseCodes.ts` | 补全 38 个 code→message + CODE_TO_HTTP 映射 (02 §5) |
| `shared/src/types/api.types.ts` | 补全 SSE Event 类型 (02 §9) |
| `shared/src/types/memory.types.ts` | 补全 MemorySource / MemoryType / Sentiment 枚举 (10 §2.5) |
| **新建** `shared/src/types/extension.types.ts` | ToolExtension / HookExtension / HookEvent 接口 (09 §6-7) |
| `shared/src/types/agent.types.ts` | 补全 ModeCapability / ResolvedCapability (16 §2.4) |

#### B0-2: `packages/native/` 脚手架 + TS Mock

| 文件 | 工作内容 |
|---|---|
| `native/nit-runtime/package.json` | @perocore/nit-runtime 包声明 |
| `native/nit-runtime/index.ts` | TS mock: `minGruForward()` / `leidenCluster()` 占位 |
| `native/nit-runtime/index.d.ts` | 类型声明 |
| `native/auditor-wasm/package.json` | @perocore/auditor-wasm 包声明 |
| `native/auditor-wasm/index.ts` | TS mock: `auditCommand()` 占位 |
| `native/render-core/package.json` | @perocore/render-core 包声明 |
| `native/render-core/index.ts` | TS mock: `encrypt()` / `decrypt()` 占位 |

#### B0-3: Workspace + 依赖更新

| 文件 | 工作内容 |
|---|---|
| `pnpm-workspace.yaml` | 加入 `packages/native/*` |
| `backend/package.json` | 加 optionalDependencies: nit-runtime + auditor-wasm |

#### B0-4: AppError + 错误中间件

| 文件 | 工作内容 |
|---|---|
| `backend/src/lib/appError.ts` | 重写：import CODE_TO_HTTP from shared (02 §7.1) |
| `backend/src/middleware/errorHandler.ts` | 对齐 02 §7.2 全局错误中间件 |

**前置依赖**: 无
**验收**: tsc 零错误 + `throw new AppError('LLM_ERROR')` → 502 + shared 导出所有类型

---

### B1: LLM Provider 真实化 (~1,200 行)

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| [llm/llmService.ts](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/backend/src/services/llm/llmService.ts) | 135 | ~250 | [chat()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/backend/src/services/llm/llmService.ts#113-126) + [chatStream()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/backend/src/services/llm/llmService.ts#127-140) SSE 编排 |
| `llm/providers/openaiProvider.ts` | 128 | ~280 | OpenAI-compatible fetch + SSE 解析 |
| `llm/providers/geminiProvider.ts` | 168 | ~280 | Gemini REST |
| `llm/providers/anthropicProvider.ts` | 223 | ~280 | Anthropic Messages |
| `llm/types.ts` | 95 | ~150 | ChatMessage / ToolCall / FunctionDef / ChatDelta |
| **新建** `llm/modelRegistry.ts` | 0 | ~120 | 从 ConfigRepo 按用途查模型 |

**验收**: `await llmService.chatStream(msgs, { model })` 返回 `AsyncIterable<ChatDelta>`

---

### B2a: Embedding + Prompt 引擎 (~1,500 行)

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| `embedding/embeddingService.ts` | 92 | ~180 | embed/embedOne 真实 HTTP 调用 |
| **新建** `embedding/providers/apiProvider.ts` | 0 | ~150 | OpenAI-compatible Embedding API |
| `prompt/mdpEngine.ts` | 196 | ~350 | Nunjucks 渲染 + frontmatter + Agent override + PathResolver 联动 |
| `prompt/promptService.ts` | 109 | ~300 | compose() + TaskPromptComposer (后台精简人设 §12) |
| **新建** `prompt/enrichers/*.ts` (5个) | 0 | ~500 | agent/ability/social/work/tool Enricher 管道 (§11.4) |

**验收**: `promptService.compose(agentId, 'desktop')` → 含人设+工具+记忆上下文的完整 system prompt

---

### B2b: 扩展系统 (~3,000 行) ← 之前完全遗漏！

> **09_EXTENSION_SYSTEM：统一 Tool + Hook + Service 三类扩展**
> 这是 Agent 工具调用的底层基础设施。

| 文件 | 工作内容 |
|---|---|
| `extensions/extensionManager.ts` | scanAndLoad + getTool + emitHook + callService + 热重载 |
| `extensions/extensionLoader.ts` | TS/JS 动态 import() 加载 + manifest.json 解析 |
| `extensions/types.ts` | ToolExtension / HookExtension / ServiceExtension 接口 |
| `extensions/hookRegistry.ts` | Hook 事件注册 + 串行触发 + 异常隔离 + 超时保护 |
| `extensions/serviceRunner.ts` | Service 子进程管理 (stdio JSON-RPC) |
| `extensions/transports/stdioTransport.ts` | JSON-RPC over stdio 双向通信 |
| `extensions/transports/transport.ts` | ServiceTransport 接口 |
| **13 个内置 Tool (每个 ≈150 行)**: | |
| `tools/core/fileSearch/` | 文件搜索 |
| `tools/core/browserOps/` | 浏览器操作 |
| `tools/core/windowsOps/` | Windows 系统操作 |
| `tools/core/screenVision/` | 屏幕视觉 |
| `tools/core/scheduler/` | 定时任务管理 |
| `tools/core/taskLifecycle/` | 任务暂停/取消 |
| `tools/work/codeSearcher/` | 代码搜索 |
| `tools/work/fileOps/` | 文件操作 |
| `tools/work/terminalExecutor/` | 终端执行 |
| `tools/work/workspaceOps/` | 工作区操作 |
| `tools/group/strongholdOps/` | 据点操作 |
| `tools/core/diaryQuery/` | 日记查询 NIT 工具 (§15.5) |
| `tools/core/webSearch/` | 网络搜索 |
| **新建** `routers/extension.router.ts` | 扩展管理 API (列表/reload/enable/disable) |

**验收**: `extensionManager.loadAll()` 加载全部内置 Tool + `getAllToolDefinitions()` 返回 function calling schema

---

### B3: 记忆核心域 (~2,500 行)

> **对照 10_MEMORY §3-§6，含 Token 优化 §11**

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| `memory/memoryService.ts` | 148 | ~300 | create() + 时间链 + 图谱边 + Hook 触发 |
| `memory/memorySearch.ts` | 183 | ~350 | 语义检索 + 关键词 + 逻辑闪回 |
| `memory/conversationLog.ts` | 100 | ~200 | savePair() + query() + 滑动窗口 |
| `memory/scorerService.ts` | 253 | ~500 | **攒批触发** (§11.1) + 余弦去重 + entities/causal_refs 新产出 (§14.6.2) |
| `memory/diaryEngine.ts` | 205 | ~400 | **日记+图谱一体化** (§11.2) + 跨模式日记中转 (§15.3) |
| **新建** `memory/importer.ts` | 0 | ~150 | 故事→事件拆分→批量导入 |
| **新建** `memory/graph/memoryGraph.ts` | 0 | ~200 | 图谱可视化数据生成 |
| `repositories/vector.repo.ts` | 176 | ~280 | TriviumDB search + link + delete |
| `repositories/memory.repo.ts` | 184 | ~280 | findByTags + findSimilar + 分页 + retrieval_quality 字段 |
| `repositories/storeRegistry.ts` | 100 | ~200 | **三层 Store 隔离** (§15.4): getAgentMainStore/Social/getDiaryStore |

**验收**: Scorer 攒批提炼记忆 → DiaryEngine 一次 LLM 产出日记+实体+图谱边

---

### B4: Pipeline + Chat 打通 (~2,000 行)

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| `pipeline/ingress.ts` | 35 | ~120 | 消息预处理 + 社交适配器统一入口 (09 §6.4 InboundMessage) |
| `pipeline/enrichers/memoryEnricher.ts` | 62 | ~150 | 记忆召回 + RAG 数量限制 (§11.5) |
| `pipeline/enrichers/historyEnricher.ts` | 51 | ~120 | 对话历史 (滑动窗口) |
| `pipeline/enrichers/stateEnricher.ts` | 35 | ~80 | Agent/宠物状态注入 |
| **新建** `pipeline/synthesis.ts` | 0 | ~300 | LLM + SSE + FC 工具调用循环 |
| `pipeline/egress.ts` | 73 | ~200 | 存日志 + Scorer 攒批入队 + 广播 |
| `routers/chat.router.ts` | 96 | ~200 | SSE (02 §9: delta/tool_call/tool_result/status/done/error) |
| `session/sessionService.ts` | 93 | ~200 | 会话创建/恢复/结束 |
| `agent/agentService.ts` | 217 | ~350 | 聊天编排 + CapabilityGate 解析 |

**验收**: `POST /api/chat/stream` → SSE 真实对话 + 工具调用

---

### B5a: Reflection 子系统 (~2,000 行)

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| `maintenance/reflectionOrchestrator.ts` | 119 | ~250 | runMaintenance() + 进度广播 |
| `maintenance/tagger.ts` | 72 | ~200 | **批量 10 条/批** (§11.3) + 标签归簇 |
| `maintenance/consolidator.ts` | 31 | ~250 | 相似记忆整合 |
| `maintenance/auditor.ts` | 29 | ~200 | 错误记忆审计 |
| `maintenance/retirementPolicy.ts` | 47 | ~150 | 退役规则 |
| `maintenance/dreamAssociator.ts` | 62 | ~200 | 梦境关联 |
| `maintenance/graphGardener.ts` | 30 | ~250 | **多类型边** (§14.6.3): semantic/entity/causal/thematic |
| `scheduler/backgroundScheduler.ts` | 93 | ~200 | 定时触发 + Leiden + RNN 训练 |

**验收**: Reflection 维护 + 多类型边构建

---

### B5b: PEDSA v2 认知检索引擎 (~1,500 行)

> **10_MEMORY §14：三大创新模块 — ContextRNN + Leiden + 反馈闭环**
> Rust 侧负责 minGRU 推理 + Leiden 算法，TS 侧做编排 + 调用 + 持久化。

| 文件 | 工作内容 |
|---|---|
| **新建** `services/retrieval/contextualRetriever.ts` | PEDSA v2 统一管线 (7 步 §14.3) |
| **新建** `services/retrieval/contextRnn.ts` | minGRU 隐状态管理 + 调 `@perocore/nit-runtime` (B0 已建 mock) |
| **新建** `services/retrieval/clusterRouter.ts` | Leiden cluster 路由 + centroid 亲和度 |
| **新建** `services/retrieval/retrievalFeedback.ts` | Jaccard 信号采集 + RNN 训练触发 |
| **新建** `services/retrieval/dpDiversity.ts` | DPP 去冗余 |

**前置依赖**: B3 (记忆) + B5a (Reflection 产出的多类型边) + B0 (nit-runtime mock)
**验收**: 检索结果附带 cluster 标签 + retrieval_quality 更新

> [!NOTE]
> Rust 真实实现在 `packages/native/nit-runtime/` 中，与 TS 侧并行开发。
> B0 已建好 TS mock，开发期走 fallback，编译 Rust 后无缝切换。

---

### B6: Agent 系统 + NIT + Router 完善 (~2,500 行)

| 文件 | 当前 | 目标 | 工作内容 |
|---|---|---|---|
| `agent/reactLoop.ts` | 263 | ~400 | FC + NIT v3 双轨 + ExtensionManager 集成 |
| [agent/toolExecutor.ts](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/backend/src/services/agent/toolExecutor.ts) | 159 | ~300 | 调 ExtensionManager.getTool() 真实执行 |
| `agent/toolRegistry.ts` | 73 | ~150 | 从 ExtensionManager 获取 schema |
| `agent/agentManager.ts` | 218 | ~350 | Agent CRUD + cap.yaml 加载 |
| `agent/taskManager.ts` | 95 | ~200 | 暂停/取消/进度 |
| `nit/runtime.ts` | 293 | ~400 | 接入真实工具环境 (纯 TS，不依赖 Rust) |
| `routers/agent.router.ts` | 104 | ~200 | Agent CRUD |
| [routers/model.router.ts](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/backend/src/routers/model.router.ts) | 228 | ~300 | 模型 CRUD + 连通性测试 |
| `routers/config.router.ts` | 38 | ~120 | 配置 CRUD |
| `gateway/gatewayHub.ts` | 222 | ~350 | WS Hub + Protobuf + 广播 |
| `core/assetRegistry.ts` | 152 | ~250 | Workshop 扫描 + 覆盖优先级 (14 §4) |
| `core/pathResolver.ts` | 112 | ~160 | @workshop 可用性检查 (14 §3) |

**验收**: Agent 对话 + 工具调用 + NIT + 资产加载

---

## 路线图

```
B0  共享层 + Native脚手架           ██████████  ~1,000 行  ✅ 完成
B1  LLM Provider                    ██████████  ~1,750 行  ✅ 完成 (超额!)
B2a Embedding + Prompt              ██████████  ~916 行    ✅ 完成
B2b 扩展系统 + 13 Tool              ████░░░░░░  ~894 行    🔨 框架完成 (Tool 待做)
B3  记忆核心域                      ░░░░░░░░░░  ~2,500 行   ← 灵魂
B4  Pipeline + Chat                 ░░░░░░░░░░  ~2,000 行
B5a Reflection                      ░░░░░░░░░░  ~2,000 行
B5b PEDSA v2 认知引擎               ░░░░░░░░░░  ~1,500 行   ← 之前遗漏！
B6  Agent + NIT + Router            ░░░░░░░░░░  ~2,500 行
                  补充: Zod Schema + 杂项  ~1,500 行
                                    ─────────
                                    ≈ 18,500 行
                        目标总行数 ≈ 28,000 行
```

---

## 关键认知更新 (读完文档 + 主人确认后)

| # | 认知 | 影响 |
|---|---|---|
| 1 | **NIT v3 = 纯 TS** | runtime 不依赖 Rust，只需在 B6 接入真实工具环境 |
| 2 | **Rust 模块 = minGRU/Leiden/WASM/加密** | B0 建 mock，真实 Rust 实现并行开发 |
| 3 | **Hook 接入点必须预埋** | B2b 规划类型，B3/B4/B6 每个 Service 方法触发 Hook |
| 4 | **扩展系统是 Agent 工具调用的基础** | 没有 ExtensionManager，ToolExecutor 无法运行 |
| 5 | **Scorer 必须攒批 (§11.1)** | 全新设计，不是简单迁移 v1 |
| 6 | **日记系统融合图谱构建 (§11.2)** | DiaryEngine 一次 LLM = 日记+实体+图谱边 |
| 7 | **三层记忆隔离 (§15)** | StoreRegistry per-Agent 物理隔离 + 共享日记层 |
| 8 | **PEDSA v2 (§14)** | TS 编排 + Rust 计算，B0 已建 mock |
| 9 | **SSE 有 6 种事件类型 (02 §9)** | delta/tool_call/tool_result/status/done/error |
| 10 | **38 个业务 code (02 §5)** | shared 层 B0 补全 |
| 11 | **packages/native/ 不存在** | B0 创建脚手架 + TS mock |

---

## 决策确认

| # | 问题 | Carola 的建议 |
|---|---|---|
| Q1 | 从 B0 → B1 → B2a 开始？ | ✅ 共享层 → LLM → Prompt 是基石 |
| Q2 | B2b 扩展系统何时做？ | B2a 之后紧接，因为 B4/B6 的工具调用依赖它 |
| Q3 | PEDSA v2 (B5b) 的 Rust 部分？ | TS 侧先做接口 + mock，Rust 另开工作流 |
| Q4 | TriviumDB 何时真实对接？ | B3 中，三层 Store 隔离一起做 |
| Q5 | 先做哪些 Tool？ | 先做 5 个核心 Tool (fileSearch/webSearch/diaryQuery/screenVision/taskLifecycle) |

---

*B0 已开始执行 🐱 · 2026-04-19 23:18*
