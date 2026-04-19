# 项目结构与 Monorepo 规范

> **版本**：0.2.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 项目整体目录布局

---

## 1. Monorepo 结构

使用 **pnpm workspace** 管理前后端和共享包。

### 1.1 pnpm workspace 配置

```yaml
# pnpm-workspace.yaml（项目根目录）
packages:
  - 'packages/*'
  - 'packages/native/*'    # Rust native 模块
  - 'electron'
```

### 1.2 整体目录

```
PeroCore-TS/
├── packages/
│   ├── shared/                    # @perocore/shared
│   │   ├── src/
│   │   │   ├── types/             # 共享类型定义
│   │   │   │   ├── api.types.ts   # ApiResponse, PaginatedData
│   │   │   │   ├── memory.types.ts
│   │   │   │   ├── agent.types.ts
│   │   │   │   ├── chat.types.ts
│   │   │   │   └── index.ts
│   │   │   ├── constants/         # 共享常量
│   │   │   │   ├── responseCodes.ts
│   │   │   │   └── index.ts
│   │   │   ├── utils/             # 共享工具函数
│   │   │   └── index.ts           # 桶导出
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── backend/                   # @perocore/backend
│   │   ├── src/
│   │   │   ├── app.ts             # Hono 应用入口
│   │   │   ├── database/          # 数据库层
│   │   │   │   ├── schema.ts      # Drizzle Schema 定义
│   │   │   │   ├── connection.ts  # SQLite 连接管理
│   │   │   │   ├── migrations/    # 数据库迁移
│   │   │   │   └── index.ts
│   │   │   ├── repositories/      # 数据访问层（Repo）
│   │   │   │   ├── memory.repo.ts
│   │   │   │   ├── vector.repo.ts # TriviumDB 适配
│   │   │   │   ├── config.repo.ts
│   │   │   │   └── index.ts
│   │   │   ├── services/          # 业务逻辑层
│   │   │   │   ├── memory/
│   │   │   │   ├── agent/
│   │   │   │   ├── llm/
│   │   │   │   ├── chat/
│   │   │   │   ├── voice/
│   │   │   │   └── ...
│   │   │   ├── routers/           # 路由层
│   │   │   │   ├── memory.router.ts
│   │   │   │   ├── chat.router.ts
│   │   │   │   ├── agent.router.ts
│   │   │   │   └── ...
│   │   │   ├── middleware/        # 中间件
│   │   │   │   ├── errorHandler.ts
│   │   │   │   ├── auth.ts
│   │   │   │   └── requestLogger.ts
│   │   │   ├── lifecycle/         # 生命周期 / 定时任务
│   │   │   │   ├── startup.ts
│   │   │   │   └── cron/
│   │   │   ├── lib/               # 底层工具库（无业务逻辑）
│   │   │   │   ├── logger.ts
│   │   │   │   └── env.ts
│   │   │   └── container.ts       # 依赖注入容器 / 初始化
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── frontend/                  # @perocore/frontend
│       ├── src/
│       │   ├── main.ts
│       │   ├── App.vue
│       │   ├── api/               # API 客户端
│       │   │   ├── client.ts      # 统一 ApiClient
│       │   │   ├── transport.ts   # 传输层抽象（HTTP / IPC）
│       │   │   ├── gateway.ts     # Protobuf Gateway
│       │   │   └── modules/       # 按域拆分的 API 模块
│       │   │       ├── memoryApi.ts
│       │   │       ├── chatApi.ts
│       │   │       └── ...
│       │   ├── stores/            # Pinia Stores（全局状态）
│       │   │   ├── useMemoryStore.ts
│       │   │   ├── useConfigStore.ts
│       │   │   └── useAgentStore.ts
│       │   ├── composables/       # Vue Composables（组件逻辑）
│       │   │   ├── pet/
│       │   │   ├── chat/
│       │   │   ├── dashboard/
│       │   │   └── ...
│       │   ├── components/        # 组件
│       │   │   ├── ui/            # 原子级 UI 组件
│       │   │   ├── chat/
│       │   │   ├── avatar/
│       │   │   ├── dashboard/
│       │   │   ├── settings/
│       │   │   ├── layout/
│       │   │   └── ...
│       │   ├── views/             # 页面级视图
│       │   ├── router/            # Vue Router
│       │   ├── assets/
│       │   └── config/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/native/               # 🧱 Rust native 模块
│   ├── render-core/           # @perocore/render-core
│   │   ├── Cargo.toml         #   加密/反调/打包（资产保护）
│   │   ├── src/lib.rs
│   │   ├── package.json       #   N-API 绑定，已有
│   │   └── index.d.ts         #   napi-rs 自动生成
│   ├── nit-runtime/           # @perocore/nit-runtime
│   │   ├── Cargo.toml         #   NIT 解释器 Rust 加速
│   │   ├── src/lib.rs         #   PyO3 → N-API 改造
│   │   ├── package.json
│   │   └── index.d.ts
│   └── auditor-wasm/          # @perocore/auditor-wasm
│       ├── Cargo.toml         #   终端命令安全审计 (WASM)
│       ├── src/lib.rs
│       ├── package.json
│       └── pkg/               #   wasm-pack 输出
│
├── electron/                      # Electron 壳层
│   ├── main/
│   │   ├── index.ts               # 主入口
│   │   ├── ipcBridge.ts           # IPC → 系统能力桥接
│   │   ├── services/              # Electron 专属服务
│   │   │   ├── steam.ts
│   │   │   ├── tray.ts
│   │   │   └── ...
│   │   ├── windows/
│   │   └── utils/
│   ├── preload/
│   ├── package.json
│   └── tsconfig.json
│
├── _docs_/                        # 规范文档（本目录）
├── pnpm-workspace.yaml
├── package.json                   # 根 package.json
└── tsconfig.base.json             # 共享 TS 配置
```

---

## 2. 包依赖关系

```
@perocore/shared         ← 无任何内部依赖
      ↑
@perocore/render-core    ← 无内部依赖（Rust N-API）
@perocore/nit-runtime     ← 无内部依赖（Rust N-API）
@perocore/auditor-wasm   ← 无内部依赖（Rust WASM）
      ↑
@perocore/backend        ← 依赖 shared + nit-runtime + auditor-wasm
      ↑
@perocore/frontend       ← 依赖 shared
electron                 ← 依赖 frontend + render-core
```

**严格规则**：

- `shared` 不依赖 `backend` 或 `frontend`
- `native/*` 不依赖任何内部 TS 包（纯 Rust）
- `backend` 不依赖 `frontend` 或 `electron`
- `frontend` 不依赖 `backend` 或 `electron`
- `electron` 可以依赖其他包，但仅在主进程中

---

## 3. package.json 配置示例

```jsonc
// packages/shared/package.json
{
  "name": "@perocore/shared",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}

// packages/backend/package.json
{
  "name": "@perocore/backend",
  "version": "0.1.0",
  "dependencies": {
    "@perocore/shared": "workspace:*",
    "@perocore/nit-runtime": "workspace:*",
    "@perocore/auditor-wasm": "workspace:*",
    "hono": "^4.x",
    "drizzle-orm": "^0.x",
    "better-sqlite3": "^11.x"
  }
}

// packages/frontend/package.json
{
  "name": "@perocore/frontend",
  "version": "0.1.0",
  "dependencies": {
    "@perocore/shared": "workspace:*",
    "vue": "^3.x",
    "pinia": "^3.x",
    "vue-router": "^4.x"
  }
}

// packages/native/render-core/package.json
{
  "name": "@perocore/render-core",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "render-core",
    "triples": { "defaults": true }
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2.14.0"
  }
}

// packages/native/nit-runtime/package.json
{
  "name": "@perocore/nit-runtime",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "nit-runtime",
    "triples": { "defaults": true }
  },
  "scripts": {
    "build": "napi build --platform --release"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2.14.0"
  }
}

// packages/native/auditor-wasm/package.json
{
  "name": "@perocore/auditor-wasm",
  "version": "0.1.0",
  "main": "pkg/nit_terminal_auditor.js",
  "types": "pkg/nit_terminal_auditor.d.ts",
  "scripts": {
    "build": "wasm-pack build --target nodejs --out-dir pkg"
  }
}
```

---

## 4. Pinia vs Composable 边界

| 场景 | 用 Pinia Store | 用 Composable |
|---|---|---|
| 跨组件/跨页面共享的全局状态 | ✅ | |
| 当前 Agent 信息、配置 | ✅ | |
| 记忆列表（Dashboard 多 Tab 共享） | ✅ | |
| 单个组件内部的 UI 状态 | | ✅ |
| 表单逻辑、输入处理 | | ✅ |
| 生命周期绑定的逻辑（onMounted 等） | | ✅ |
| 可复用的无状态逻辑 | | ✅ |

**命名约定**：

- Pinia Store：`useXxxStore.ts`，放在 `stores/`
- Composable：`useXxx.ts`，放在 `composables/{domain}/`

---

## 5. Rust Native 模块规范

### 5.1 现有模块迁移路径

| 原模块 | 绑定方式 | 迁移后 | 工作量 |
|---|---|---|---|
| `pero-render-core` | N-API (napi-rs) | ✅ 直接搬迁，不改代码 | 极小 |
| `nit_rust_runtime` | PyO3 → Python | ⚠️ **改为 N-API** (napi-rs) | 小（只换绑定层） |
| `nit_terminal_auditor` | wasm-bindgen → WASM | ✅ 直接搬迁，WASM 跨语言 | 极小 |
| `vision_core` | PyO3 → Python | ❌ **不迁移**（Python 特有的 PyO3 视觉模块，TS 版与本地推理无关） | 0 |

### 5.2 构建命令

```bash
# 构建所有 native 模块
pnpm --filter @perocore/render-core build
pnpm --filter @perocore/nit-runtime build
pnpm --filter @perocore/auditor-wasm build

# 或从根目录一键构建
pnpm -r --filter './packages/native/*' run build
```

### 5.3 后端使用方式

```typescript
// NIT 解释器 Rust 加速
import { executeAst } from '@perocore/nit-runtime'

// 终端命令安全审计 (WASM)
import { auditCommand } from '@perocore/auditor-wasm'

// 资产加密/解密 (Electron 主进程中)
import { encrypt, decrypt } from '@perocore/render-core'
```

### 5.4 跨平台注意事项

| 类型 | 跨平台性 | 部署方案 |
|---|---|---|
| N-API (`.node`) | ❌ 平台相关 | CI 交叉编译，通过 `napi` triples 配置目标平台 |
| WASM (`.wasm`) | ✅ 跨平台 | 一次编译，到处运行 |

---

*本文档由 Carola 整理，适用于 PeroCore-TS 项目结构规范。*
