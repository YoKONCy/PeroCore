# Contributing Guide / 贡献指南

Thank you for your interest in contributing to infOS! 🎉

感谢您对 infOS 项目的关注与贡献意愿！🎉

## Table of Contents / 目录

- [Getting Started / 快速开始](#getting-started--快速开始)
- [Development Environment / 开发环境](#development-environment--开发环境)
- [Project Structure / 项目结构](#project-structure--项目结构)
- [Code Style / 代码风格](#code-style--代码风格)
- [Commit Convention / 提交规范](#commit-convention--提交规范)
- [Pull Request Process / PR 流程](#pull-request-process--pr-流程)
- [Extension Development / 扩展开发](#extension-development--扩展开发)

## Getting Started / 快速开始

### Prerequisites / 前置要求

| Requirement / 依赖 | Version / 版本 |
| :----------------- | :------------- |
| Node.js            | ≥ 20.0.0       |
| pnpm               | ≥ 9.0.0        |
| Git                | Latest / 最新  |

### Setup / 初始化

```bash
# 克隆仓库
git clone https://github.com/YoKONCy/infOS.git
cd infOS

# 安装依赖
pnpm install

# 一键启动开发环境 (后端 + Electron)
pnpm start
```

## Development Environment / 开发环境

### Available Scripts / 可用脚本

| Command / 命令      | Description / 说明                                                                   |
| :------------------ | :----------------------------------------------------------------------------------- |
| `pnpm start`        | Start backend + Electron (one-click dev mode).<br>一键启动后端 + Electron 开发模式。 |
| `pnpm dev`          | Start backend only.<br>仅启动后端。                                                  |
| `pnpm dev:electron` | Start Electron only (requires backend running).<br>仅启动 Electron（需后端已运行）。 |
| `pnpm build`        | Build for production.<br>构建生产版本。                                              |
| `pnpm version:sync` | Sync version across all packages.<br>同步所有包的版本号。                            |

### Ports / 端口

| Service / 服务 | Port / 端口 | Description / 说明                                            |
| :------------- | :---------- | :------------------------------------------------------------ |
| Backend API    | 9120        | Hono HTTP + WebSocket server.<br>Hono HTTP + WebSocket 服务。 |
| Frontend Dev   | 7359        | Vite HMR dev server.<br>Vite 热更新开发服务。                 |

## Project Structure / 项目结构

```
infOS/
├── electron/                 # Electron 主进程
│   ├── main/                 # 主进程代码
│   └── preload/              # 预加载脚本
├── packages/
│   ├── backend/              # 后端 (Hono + SQLite)
│   │   └── src/
│   │       ├── tools/        # 内置工具扩展
│   │       ├── services/     # 业务服务层
│   │       ├── routers/      # API 路由
│   │       └── extensions/   # 扩展系统
│   ├── frontend/             # 前端 (Vue 3 + Vite)
│   │   └── src/
│   │       ├── views/        # 页面视图
│   │       ├── components/   # UI 组件
│   │       └── composables/  # 组合式函数
│   ├── shared/               # 共享类型与常量
│   └── browser-extension/    # 浏览器桥接插件
├── public/                   # 静态资源 (全局共享)
├── resources/                # Electron 构建资源
└── scripts/                  # 构建与工具脚本
```

## Code Style / 代码风格

### Language / 语言规范

- **Comments MUST be in Chinese.** All code comments, log messages, and error messages should be written in Chinese.

  **注释必须使用中文。** 所有代码注释、日志输出和错误信息均应使用中文。

- **Variable names, function names, and identifiers** remain in English.

  **变量名、函数名和标识符** 保持英文。

### File Headers / 文件头

Every source file should include a JSDoc/TSDoc header:

每个源文件应包含 JSDoc/TSDoc 文件头：

```typescript
/**
 * 模块简要描述
 *
 * 详细说明（可选）。
 *
 * @module packages/backend/src/services/myService
 */
```

### Section Comments / 分区注释

Use section dividers for code organization:

使用分区注释组织代码：

```typescript
// ─── 区域名称 ──────────────────────────────────────────
```

### Logging / 日志

Use `createLogger` from `lib/logger` instead of raw `console.log`:

使用 `lib/logger` 的 `createLogger` 而非原始 `console.log`：

```typescript
import { createLogger } from '../lib/logger'
const logger = createLogger('MyModule')

logger.info('操作成功')
logger.warn('非致命警告')
logger.error('操作失败', { error: err })
```

## Commit Convention / 提交规范

We follow [Conventional Commits](https://www.conventionalcommits.org/). Commit messages should be in **Chinese** or **English**.

我们遵循 [约定式提交](https://www.conventionalcommits.org/)。提交信息使用**中文**或者**英文**。

```
<type>(<scope>): <description>

[optional body]
```

### Types / 类型

| Type / 类型 | Description / 说明                                       |
| :---------- | :------------------------------------------------------- |
| `feat`      | New feature. / 新功能。                                  |
| `fix`       | Bug fix. / Bug 修复。                                    |
| `docs`      | Documentation changes. / 文档变更。                      |
| `style`     | Code style (no logic change). / 代码风格（无逻辑变更）。 |
| `refactor`  | Code refactoring. / 代码重构。                           |
| `perf`      | Performance improvement. / 性能优化。                    |
| `test`      | Adding or updating tests. / 添加或更新测试。             |
| `chore`     | Build, CI, or tooling changes. / 构建、CI 或工具变更。   |

### Scopes / 作用域

| Scope / 作用域 | Package / 包                 |
| :------------- | :--------------------------- |
| `backend`      | `packages/backend`           |
| `frontend`     | `packages/frontend`          |
| `electron`     | `electron/`                  |
| `shared`       | `packages/shared`            |
| `ext`          | `packages/browser-extension` |

### Examples / 示例

```
feat(backend): add memory consolidation scheduler
fix(frontend): resolve launcher onboarding overlay z-index
chore(electron): update preload script path
```

## Pull Request Process / PR 流程

1. **Fork** the repository and create your branch from `main`.

   **Fork** 仓库并从 `main` 分支创建你的分支。

2. **Follow** the code style guidelines above.

   **遵循**上述代码风格规范。

3. **Test** your changes locally with `pnpm start`.

   使用 `pnpm start` 在本地**测试**你的更改。

4. **Describe** your changes clearly in the PR description.

   在 PR 描述中**清晰说明**你的更改。

5. **Link** related issues (if any).

   **关联**相关 Issue（如有）。

## Extension Development / 扩展开发

infOS supports three types of extensions:

infOS 支持三种扩展类型：

| Type / 类型 | Description / 说明                                                                           |
| :---------- | :------------------------------------------------------------------------------------------- |
| **Tool**    | Agent-callable tools (LLM function calling).<br>Agent 可调用的工具（LLM Function Calling）。 |
| **Hook**    | Event interceptors (pre/post processing).<br>事件拦截器（前/后处理）。                       |
| **Service** | Long-running background services.<br>长期运行的后台服务。                                    |

### Creating a Tool Extension / 创建工具扩展

1. Create a directory under `packages/backend/src/tools/yourTool/`

   在 `packages/backend/src/tools/yourTool/` 下创建目录

2. Add `manifest.json`:

   添加 `manifest.json`：

```json
{
  "id": "your-tool",
  "name": "Your Tool",
  "type": "tool",
  "version": "0.9.0",
  "description": "工具描述",
  "entry": "index.ts"
}
```

3. Implement `index.ts` with a `definition` and `execute` method.

   在 `index.ts` 中实现 `definition` 和 `execute` 方法。

---

Thank you for contributing! Every improvement makes infOS better. 💖

感谢您的贡献！每一个改进都让 infOS 变得更好。💖
