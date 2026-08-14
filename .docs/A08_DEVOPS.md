# DevOps 与运维规范

> **版本**：0.2.0 · **更新时间**：2026-04-22
> **适用范围**：CI/CD、数据库迁移、版本发布、安全、可观测性、API 文档
> **依赖规范**：[A04_DEPLOYMENT](./A04_DEPLOYMENT.md)、[S04_TESTING_STANDARDS](./S04_TESTING_STANDARDS.md)

---

## 1. CI/CD 流水线

### 1.1 工具选型

GitHub Actions，与项目 GitHub 仓库原生集成。

### 1.2 流水线设计

```yaml
# .github/workflows/ci.yml 骨架
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint          # ESLint + Prettier 检查

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test          # Vitest 全量测试
      - run: pnpm coverage      # 覆盖率报告（需满足红线）

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build         # 全包构建验证

  # 可选：Electron 打包（仅 main/release 分支）
  electron-build:
    if: github.ref == 'refs/heads/main'
    runs-on: windows-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm electron:build
      - uses: actions/upload-artifact@v4
        with:
          name: electron-dist
          path: dist_electron/
```

### 1.3 分支策略

| 分支 | 用途 | CI 触发 |
|---|---|---|
| `main` | 稳定版本 | lint → test → build → Electron 打包 |
| `dev` | 开发主线 | lint → test → build |
| `feature/*` | 功能分支 | PR 时触发 lint + test |
| `release/*` | 发布准备 | 全量 CI + Steam 构建 |

---

## 2. 数据库迁移策略

### 2.1 SQLite 迁移 — Drizzle Kit

```bash
# 生成迁移文件
pnpm drizzle-kit generate

# 执行迁移
pnpm drizzle-kit migrate

# 推送 schema 变更（开发阶段快捷方式）
pnpm drizzle-kit push
```

### 2.2 迁移文件管理

```
packages/backend/src/db/
  ├── schema.ts              ← Drizzle schema 定义（唯一真理源）
  ├── migrations/             ← 自动生成的迁移 SQL
  │   ├── 0000_initial.sql
  │   ├── 0001_add_diary.sql
  │   └── meta/
  └── migrate.ts             ← 启动时自动执行迁移
```

### 2.3 迁移原则

- **向前兼容**：新增列给默认值，不删除现有列（可标记 deprecated）
- **不可逆操作需确认**：删表、改列类型等操作需要人工审批
- **每次 PR 最多一个迁移文件**：避免迁移冲突
- **TriviumDB 不需要迁移**：TriviumDB 的 schema 由代码定义（`file_format.rs` 版本号），二进制格式自带版本兼容

---

## 3. 版本发布策略

### 3.1 版本号规范

采用 **SemVer**（语义化版本）：`MAJOR.MINOR.PATCH`

| 类型 | 含义 | 示例 |
|---|---|---|
| MAJOR | 不兼容的 API / 数据格式变更 | `2.0.0` |
| MINOR | 新功能（向后兼容） | `1.1.0` |
| PATCH | Bug 修复 | `1.0.1` |
| 预发布 | Alpha / Beta / RC | `1.0.0-alpha.1` |

所有子包版本号通过 `pnpm version:sync` 统一同步。

### 3.2 Changelog 自动生成

使用 **changesets** 管理版本和变更日志：

```bash
# 开发者在 PR 中添加变更描述
pnpm changeset

# 发布时自动生成 CHANGELOG.md + 更新版本号
pnpm changeset version
pnpm changeset publish
```

### 3.3 发布渠道

| 渠道 | 触发条件 | 产物 |
|---|---|---|
| GitHub Release | `release/*` 分支合并到 `main` | `.exe` 安装包 + 发布说明 |
| Steam | 手动触发 SteamPipe 上传 | Depot 更新 |
| Docker Hub | `main` 分支 CI | Docker 镜像 |

---

## 4. 安全规范

### 4.1 输入验证

后端已通过 Hono + Zod 在 Router 层做 schema 验证：

```typescript
// 所有用户输入通过 Zod schema 验证
app.post('/api/chat', zValidator('json', chatSchema), handler)
```

**补充要点**：
- **路径遍历防护**：PathResolver 的 `resolve()` 必须检查解析后的路径不超出 roots 边界
- **SQL 注入**：Drizzle ORM 的参数化查询天然防注入
- **XSS**：Vue 的模板自动转义 + CSP 头（Electron 版由 `webPreferences` 控制）

### 4.2 依赖安全

```bash
# 定期检查依赖漏洞
pnpm audit

# GitHub Dependabot 自动创建漏洞修复 PR
# 配置 .github/dependabot.yml
```

### 4.3 敏感信息管理

| 信息类型 | 存储位置 | 注意事项 |
|---|---|---|
| LLM API Key | `config.json`（@data/） | 不上传 Steam Cloud，不提交 Git |
| Gateway Token | `gateway_token.json` | 排除在 Cloud Sync 之外 |
| Steam App ID | 代码硬编码 `4457100` | 公开信息，无需保护 |

---

## 5. 可观测性

### 5.1 日志（已有）

见 [S03_LOGGING_SPEC](./S03_LOGGING_SPEC.md)，使用 consola，日志消息中文。

### 5.2 健康检查

```typescript
// 后端健康检查端点
app.get('/health', (c) => c.json({
  code: 'OK',
  data: {
    status: 'ok',
    uptime: process.uptime(),
    version: APP_VERSION,
    memory: process.memoryUsage(),
  }
}))

// Docker Compose 健康检查
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:9120/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

### 5.3 APM / 分布式追踪（可选）

Docker 版可接入 OpenTelemetry：

```typescript
// 仅 Docker 版启用，Electron 版跳过
if (isDocker && process.env.OTEL_ENDPOINT) {
  initOpenTelemetry({
    serviceName: 'infos-backend',
    endpoint: process.env.OTEL_ENDPOINT,
  })
}
```

**当前不需要实现**，infOS 是单用户应用，日志 + 健康检查已足够。

---

## 6. API 文档

### 6.1 方案

使用 Hono 的 **OpenAPI** 插件 + **Scalar** 可视化：

```typescript
import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'

const app = new OpenAPIHono()

// Zod schema 同时用于验证和文档生成
app.openapi(chatRoute, handler)

// 挂载 Scalar UI
app.get('/docs', swaggerUI({ url: '/openapi.json' }))
```

### 6.2 优势

- **Zod schema 复用**：验证逻辑和文档描述是同一份代码，保证一致性
- **零额外维护**：不需要手写 Swagger YAML
- **内置 Playground**：Scalar 自带请求测试功能

---

## 7. 里程碑对照表

| 里程碑 | 需落地的运维项 |
|---|---|
| 首个模块开发完成 | CI/CD 流水线（§1） |
| 数据库模块开发 | Drizzle 迁移配置（§2） |
| 后端 Hono 搭建 | 健康检查（§5.2）、Dependabot（§4.2） |
| 首批 Router 完成 | API 文档生成（§6） |
| 首个 Alpha 发布 | 版本策略 + Changelog（§3） |
| Docker 版上线 | APM 评估（§5.3） |

---

*本文档由 Carola 整理，适用于 infOS 运维与 DevOps 规范。*
