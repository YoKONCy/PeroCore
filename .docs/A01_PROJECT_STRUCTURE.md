# 项目结构与 Monorepo 规范

> **适用范围**：infOS-TS 项目整体
> **最后更新**：2026-04-21

---

## 1. Monorepo 配置

使用 **pnpm workspace** 管理。

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/native/*'
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
│   │       ├── gateway/           # WebSocket Gateway (Protobuf)
│   │       ├── extensions/        # 扩展系统框架
│   │       ├── tools/             # 内置 Tool (平铺)
│   │       ├── applications/       # AgentApplication / SubAgent 应用层与运行时
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
│   └── native/                    # 🧱 Rust Native 模块
│       ├── render-core/           # @infos/render-core — 加密/反调/打包 (N-API)
│       ├── nit-runtime/           # @infos/nit-runtime — NIT 解释器 (N-API)
│       └── auditor-wasm/          # @infos/auditor-wasm — 终端命令审计 (WASM)
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
@infos/shared         ← 无任何内部依赖
@infos/render-core    ← 无内部依赖 (Rust N-API)
@infos/nit-runtime    ← 无内部依赖 (Rust N-API)
@infos/auditor-wasm   ← 无内部依赖 (Rust WASM)
      ↑
@infos/backend        ← 依赖 shared + nit-runtime + auditor-wasm
      ↑
@infos/frontend       ← 依赖 shared
electron                 ← 依赖 frontend + render-core
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

## 5. Rust Native 模块

| 模块 | 绑定方式 | 跨平台 | 说明 |
|---|---|---|---|
| `render-core` | N-API (napi-rs) | 需 prebuild | 加密/反调/打包 |
| `nit-runtime` | N-API (napi-rs) | 需 prebuild | NIT 解释器加速 |
| `auditor-wasm` | WASM (wasm-pack) | ✅ 跨平台 | 终端命令审计 |

构建命令：

```bash
pnpm -r --filter './packages/native/*' run build
```

---

*本文档由 Carola 整理，适用于 infOS-TS 项目结构规范。*
