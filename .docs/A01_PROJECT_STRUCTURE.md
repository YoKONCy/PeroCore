# 项目结构与 Monorepo 规范

> **适用范围**：infOS-TS 项目整体
> **最后更新**：2026-08-19

---

## 1. Monorepo 配置

使用 **pnpm workspace** 管理。

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/apps/*'
  - 'electron'
```

---

## 2. 目录结构

```
infOS-TS/
├── packages/
│   ├── shared/                    # @infos/shared — 共享类型/常量/工具
│   │   └── src/
│   │       ├── types/             # 共享类型 (api.types.ts, memory.types.ts ...)
│   │       ├── constants/         # 共享常量 (responseCodes.ts ...)
│   │       ├── utils/             # 共享工具函数
│   │       └── index.ts           # 桶导出
│   │
│   ├── backend/                   # @infos/backend — Hono + Drizzle + TriviumDB
│   │   └── src/
│   │       ├── app.ts             # Hono 应用入口
│   │       ├── container.ts       # DI 容器
│   │       ├── database/          # Drizzle schema + 连接 + 迁移
│   │       ├── repositories/      # 数据访问层 (SQLite / TriviumDB)
│   │       ├── services/          # 业务逻辑层 (按功能域分目录)
│   │       ├── routers/           # 路由层
│   │       ├── middleware/        # 中间件 (errorHandler / auth / requestLogger)
│   │       ├── services/gateway/  # 版本化JSON WebSocket Gateway
│   │       ├── packages/          # Package Manifest V2与运行时
│   │       ├── tools/             # 内置Tool（按能力域分目录）
│   │       ├── applications/       # Application Realm、Host ABI与应用协作基础设施
│   │       ├── capabilities/       # CapabilityGate、Provider 注册与调用桥接
│   │       ├── lifecycle/          # 启动、关闭、Scheduler
│   │       ├── core/               # PathResolver、资产注册表与领域基础设施
│   │       ├── lib/                # 底层工具库 (logger, env, paths)
│   │       └── shared/             # 后端共享工具 (llmJsonParser, vectorWriteHelper)
│   │
│   ├── frontend/                  # @infos/frontend — Vue 3 + Pinia
│   │   └── src/
│   │       ├── api/               # API 客户端 + Transport 层
│   │       ├── stores/            # Pinia Stores
│   │       ├── composables/       # Vue Composables (按域分目录)
│   │       ├── components/        # 组件 (ui/chat/avatar/dashboard/settings...)
│   │       ├── views/             # 页面级视图
│   │       ├── router/            # Vue Router
│   │       └── config/            # 运行时配置
│   │
│   ├── document-engine/            # @infos/document-engine — 语义文档权威与投影
│   ├── node-sdk/                   # @infos/node-sdk — Node协议客户端
│   ├── node-host/                  # @infos/node-host — 独立Capability Provider宿主
│   ├── daemon/                     # @infos/daemon — Daemon发行入口
│   ├── wiki/                       # @infos/wiki — 文档站
│   ├── apps/
│   │   ├── social/                 # infos.social Application Realm
│   │   └── arca/                   # Arca自治Host与独立Client双入口
│
├── electron/                      # Electron 壳层
│   ├── main/                      # 主进程 (index.ts, ipcBridge.ts, services/...)
│   └── preload/                   # 预加载脚本
│
├── .docs/                         # 规范文档
├── .github/workflows/             # CI/CD
├── .changeset/                    # Changeset 配置
├── pnpm-workspace.yaml
├── package.json                   # 根 package.json
└── tsconfig.base.json             # 共享 TS 配置
```

---

## 3. 包依赖关系

```
@infos/shared              ← 无内部依赖，只承载跨包稳定协议、DTO、Port、协议校验器与无领域归属的纯工具
@infos/document-engine     ← 独立Document Authority核心
@infos/node-sdk            ← 依赖shared
@infos/node-host           ← 依赖shared + node-sdk
@infos/backend             ← 依赖shared + document-engine + node-sdk
@infos/social              ← 依赖shared + 公开Application Host ABI
@infos/arca                ← 依赖shared + document-engine + node-host
@infos/arca/client         ← Arca包内独立Vue Client入口，通过Node协议连接Arca Host
@infos/frontend            ← 依赖shared
@infos/daemon              ← Backend发行入口
@infos/wiki                ← 文档站
Electron                   ← 主Frontend与本机Capability Provider壳层
```

**严格规则**：见 `S05_CODE_STANDARDS.md` §7（依赖管理）。

---

## 4. 后端 Service 目录

Service 按功能域分目录，超 500 行必须拆分子模块。

```
services/
├── memory/              # 记忆核心域
│   ├── memoryService.ts         # CRUD
│   ├── memorySearch.ts          # 语义检索 + 逻辑闪回
│   ├── conversationLog.ts       # 对话日志
│   ├── reflection/              # 反思子系统 (orchestrator/tagger/consolidator/...)
│   ├── scorer/                  # 记忆提炼
│   ├── graph/                   # 图谱可视化
│   └── importer.ts              # 故事导入
├── generation/          # LLM 内容生成 (日记/报告)
├── embedding/           # 向量编码
├── llm/                 # LLM 门面 + Provider
├── prompt/              # 提示词系统
├── agent/               # Agent 服务 + ReAct 循环
├── chat/                # 聊天会话
└── voice/               # 语音 TTS / VAD
```

---

## 5. 规范文档与归档

活动架构文档按职责维护，禁止重新建立跨领域巨型“演进计划”作为第二权威源：

| 主题                                                           | 权威文档                              |
| -------------------------------------------------------------- | ------------------------------------- |
| AIOS宪法、Kernel Object、Execution、Capability、Event、Context | [A09](./A09_AIOS_ARCHITECTURE.md)     |
| Backend分层、DI、Gateway与错误                                 | [A02](./A02_BACKEND_ARCHITECTURE.md)  |
| Surface Protocol与Compositor                                   | [A03](./A03_FRONTEND_ARCHITECTURE.md) |
| Memory Resource与Provenance                                    | [A05](./A05_MEMORY_ENGINE.md)         |
| Package、Application与跨包Port                                 | [A06](./A06_EXTENSION_SYSTEM.md)      |
| Runtime Adapter、资源Handle与跨平台隔离                        | [A07](./A07_CROSS_PLATFORM.md)        |
| 第三方Application三层Adapter、协议与Arca参考实现               | [A11](./A11_APPLICATION_INTEGRATION.md) |
| 性能预算、安全、故障注入与发布验证                             | [A08](./A08_DEVOPS.md)                |

已完成或被拆分的设计文档移入`archived/`，仅作为历史背景，不再作为新实现的权威规范：

- [A10 infOS操作系统化架构演进计划](./archived/A10_INFOS_OS_EVOLUTION_PLAN.md)：固定条目已拆入上表文档；
- [A11 Arca与Document Engine历史技术规范](./archived/A11_ARCA_DOCUMENT_ENGINE.md)：保留Document Engine实现路线与历史产品决策；新的Application接入权威规范见活动文档[A11](./A11_APPLICATION_INTEGRATION.md)。

---

_本文档由 Carola 整理，适用于 infOS-TS 项目结构规范。_
