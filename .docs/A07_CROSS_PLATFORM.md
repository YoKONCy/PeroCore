# 跨平台与路径规范

> **版本**：0.2.0 · **更新时间**：2026-04-22
> **适用范围**：PeroCore 全项目（后端 / 前端 / Electron / Rust 模块）
> **依赖规范**：[A04_DEPLOYMENT](./A04_DEPLOYMENT.md)

---

## 1. 路径禁止硬编码

### 1.1 核心规则

**路径永远不能硬编码。** 必须通过 配置 / 环境变量 / 运行时计算 获取。

```typescript
// ❌ 禁止！硬编码路径
const dbPath = 'C:\\Users\\pero\\data\\perocore.db'
const dataDir = '/opt/perocore/data'

// ✅ 从环境变量/配置获取
const dbPath = env.PERO_DATABASE_PATH ?? path.join(getDataDir(), 'perocore.db')

// ✅ 运行时计算
const dataDir = app.getPath('userData')  // Electron
const dataDir = env.PERO_DATA_DIR ?? path.join(os.homedir(), '.perocore')  // Docker/CLI
```

### 1.2 路径操作必须使用 `node:path`

```typescript
// ❌ 禁止！手动拼接路径分隔符
const filePath = dataDir + '/' + 'config.json'
const filePath = `${dataDir}\\agents\\${agentId}`

// ✅ 必须使用 path.join / path.resolve
import path from 'node:path'
const filePath = path.join(dataDir, 'config.json')
const filePath = path.join(dataDir, 'agents', agentId)
```

### 1.3 路径分隔符

```typescript
// ❌ 禁止！假设分隔符
const parts = filePath.split('/')
const parts = filePath.split('\\')

// ✅ 使用 path.sep 或跨平台方法
const parts = filePath.split(path.sep)
// 或兼容两种分隔符
const parts = filePath.split(/[/\\]/)
```

### 1.4 统一路径工厂

所有运行时路径应从统一的工厂函数获取：

```typescript
// lib/paths.ts
import path from 'node:path'
import os from 'node:os'

/** 应用数据根目录 */
export function getDataDir(): string {
  return process.env.PERO_DATA_DIR
    ?? path.join(os.homedir(), '.perocore')
}

/** 数据库文件路径 */
export function getDatabasePath(): string {
  return process.env.PERO_DATABASE_PATH
    ?? path.join(getDataDir(), 'perocore.db')
}

/** Agent 工作区目录 */
export function getAgentWorkspace(agentId: string): string {
  return path.join(getDataDir(), 'agents', agentId, 'workspace')
}

/** TriviumDB 存储目录 */
export function getTriviumDir(): string {
  return path.join(getDataDir(), 'trivium')
}

/** 扩展目录 */
export function getExtensionsDir(): string {
  return process.env.PERO_EXTENSIONS_DIR
    ?? path.join(getDataDir(), 'extensions')
}
```

---

## 2. 平台特有代码标注

### 2.1 标注格式

所有平台特有的代码必须使用醒目的 **块注释 + `@platform` 标签** 标注：

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// @platform WINDOWS — 使用 Win32 API 获取活动窗口标题
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getActiveWindowTitle_win32(): string { ... }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// @platform LINUX — 使用 xdotool 获取活动窗口标题
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getActiveWindowTitle_linux(): string { ... }
```

### 2.2 平台标签枚举

| 标签 | 含义 |
|---|---|
| `@platform WINDOWS` | Windows 专有 (Win32 API, PowerShell, Registry 等) |
| `@platform LINUX` | Linux 专有 (xdotool, systemd, /proc 等) |
| `@platform DARWIN` | macOS 专有 (AppleScript, launchd, Cocoa 等) |
| `@platform ELECTRON` | Electron 专有 (BrowserWindow, Tray, IPC 等) |
| `@platform DOCKER` | Docker/容器专有 |

### 2.3 复合情况

当代码适用于多个（但非全部）平台时：

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// @platform LINUX | DARWIN — Unix 信号处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
process.on('SIGUSR2', () => { /* graceful restart */ })
```

---

## 3. 平台检测与分支模式

### 3.1 平台常量

```typescript
// lib/platform.ts
import os from 'node:os'

export const IS_WINDOWS = os.platform() === 'win32'
export const IS_LINUX = os.platform() === 'linux'
export const IS_DARWIN = os.platform() === 'darwin'
export const IS_ELECTRON = typeof process !== 'undefined'
  && !!process.versions?.electron
export const IS_DOCKER = !!process.env.PERO_DOCKER

export type Platform = 'windows' | 'linux' | 'darwin'

export function getPlatform(): Platform {
  if (IS_WINDOWS) return 'windows'
  if (IS_DARWIN) return 'darwin'
  return 'linux'
}
```

### 3.2 平台分支函数

对于需要平台特化的功能，使用 **策略模式** 而非 `if/else`：

```typescript
// ❌ 禁止！大段 if/else 散落在业务代码中
if (process.platform === 'win32') { ... }
else if (process.platform === 'linux') { ... }

// ✅ 策略模式，各平台实现独立文件
const impls = {
  windows: () => import('./activeWindow.win32'),
  linux:   () => import('./activeWindow.linux'),
  darwin:  () => import('./activeWindow.darwin'),
}

export async function getActiveWindowTitle(): Promise<string> {
  const impl = await impls[getPlatform()]()
  return impl.getActiveWindowTitle()
}
```

### 3.3 平台特有文件命名

| 文件 | 说明 |
|---|---|
| `activeWindow.ts` | 跨平台门面（对外 API） |
| `activeWindow.win32.ts` | Windows 实现 |
| `activeWindow.linux.ts` | Linux 实现 |
| `activeWindow.darwin.ts` | macOS 实现 |

---

## 4. 常见跨平台陷阱

### 4.1 文件系统

| 陷阱 | 说明 | 解决 |
|---|---|---|
| 路径分隔符 | Windows `\` vs Unix `/` | 用 `path.join()` |
| 大小写敏感 | Windows 不敏感, Linux 敏感 | 统一 lowercase 或明确约定 |
| 最大路径长度 | Windows 默认 260 字符 | 避免深层嵌套, 考虑 `\\?\` 前缀 |
| 文件锁 | Windows 独占锁更严格 | SQLite WAL 模式 + 重试 |
| 换行符 | Windows CRLF, Unix LF | `.gitattributes` 统一 LF; 读取时 `.replace(/\r\n/g, '\n')` |
| 临时目录 | Windows `%TEMP%`, Unix `/tmp` | 用 `os.tmpdir()` |

### 4.2 进程与信号

| 场景 | Windows | Linux/macOS | 解决 |
|---|---|---|---|
| 优雅关闭 | `SIGINT` 有限支持 | `SIGTERM` / `SIGINT` | 同时监听两者 |
| 子进程终止 | `taskkill /f /pid` | `process.kill(pid)` | 封装 `killProcess()` |
| Shell | `cmd.exe` / `PowerShell` | `/bin/bash` / `/bin/sh` | 用 `cross-env` 或 `execa` |

### 4.3 网络

| 场景 | 注意事项 |
|---|---|
| 端口占用检测 | 统一用 `net.createServer().listen()` 测试 |
| localhost | Windows 可能解析为 IPv6 `::1`, 建议显式用 `127.0.0.1` |

---

## 5. Electron 特有隔离 (重申)

- `packages/backend/` — **0 个 Electron 依赖**
- `packages/frontend/` — **0 个 Electron 依赖**
- `packages/shared/` — **0 个 Electron 依赖**
- `electron/` — 唯一允许 import Electron API 的位置

Electron 专有代码 **全部** 在 `electron/` 目录中，后端/前端通过 Transport 层访问。

---

## 6. Linux / Mac 待实现适配清单（预留）

| 适配项 | Linux x64 | Mac ARM64 |
|---|---|---|
| 系统托盘 | Electron Tray API 通用 | ✅ 原生支持 |
| 自动启动 | `.desktop` 文件 | Login Items |
| 原生通知 | libnotify | Notification API |
| Rust 编译目标 | `x86_64-unknown-linux-gnu` | `aarch64-apple-darwin` |
| 字体渲染 | 需验证中文字体 | ✅ 原生良好 |
| GPU (Three.js) | 需测试 Mesa/Vulkan | ✅ Metal |

---

*本文档由 Carola 整理，适用于 PeroCore 跨平台开发规范。*
