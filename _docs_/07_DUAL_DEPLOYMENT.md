# 多目标部署架构

> **版本**：0.2.0（定稿） · **更新时间**：2026-04-18
> **适用范围**：PeroCore-TS 部署策略

---

## 1. 两种部署形态

PeroCore-TS 必须同时支持以下两种部署模式：

| | Electron 桌面版 | Docker 后端版 |
|---|---|---|
| **运行环境** | Windows (Electron + Node.js) | Docker (Bun 优先 / Node.js 兜底) |
| **后端** | 作为子进程嵌入 Electron | 独立容器运行 |
| **前端** | Electron BrowserWindow 加载 | Nginx / 静态文件服务 |
| **IPC 能力** | ✅ 窗口管理、托盘、文件对话框 | ❌ 无 Electron，走 HTTP 替代 |
| **用户** | 桌面端用户 | 服务器 / NAS / 远程访问用户 |

---

## 2. 核心设计原则

```
┌───────────────────────────────────────────────────────┐
│                    严格隔离原则                         │
│                                                       │
│  packages/backend/   →  0 个 Electron 依赖            │
│  packages/frontend/  →  0 个 Electron 依赖            │
│  packages/shared/    →  0 个 Electron 依赖            │
│  electron/           →  仅做壳层                       │
│                                                       │
│  所有业务 API 走 HTTP（即使在 Electron 也走 localhost） │
│  IPC 仅用于 Electron 专属的系统能力                    │
└───────────────────────────────────────────────────────┘
```

---

## 3. 通信架构

### 3.1 Electron 桌面版

```
┌─────────────────────────────────────────────────┐
│ Electron 主进程                                  │
│                                                 │
│  ┌──────────┐     ┌─────────────────────┐       │
│  │ IPC 桥接 │     │ 后端进程管理         │       │
│  │ (窗口/   │     │ (启动 @perocore/    │       │
│  │  托盘/   │     │  backend 进程)      │       │
│  │  文件)   │     └─────────┬───────────┘       │
│  └────┬─────┘               │                   │
│       │                     │ HTTP :9120         │
└───────┼─────────────────────┼───────────────────┘
        │ IPC                 │
┌───────▼─────────────────────▼───────────────────┐
│ Renderer 进程                                    │
│                                                 │
│  Transport 层                                   │
│  ├─ 业务 API → HTTP (localhost:9120) ──→ 后端   │
│  ├─ Gateway  → WS   (localhost:9120) ──→ 后端   │
│  └─ 系统能力 → IPC ──→ Electron 主进程           │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3.2 Docker 后端版

```
┌─────────────────────────┐     ┌──────────────────┐
│ 前端容器 (Nginx)         │     │ 后端容器 (Bun)   │
│                         │     │                  │
│ 静态文件                │     │ @perocore/backend│
│ Vue SPA                 │────→│ HTTP :9120       │
│                         │     │ WS   :9120       │
│ Transport: HttpTransport│     │                  │
│ (无 IPC，走 HTTP 替代)   │     │ SQLite + TriviumDB│
└─────────────────────────┘     └──────────────────┘
```

---

## 4. IPC vs HTTP 能力划分

### 4.1 仅 IPC 的能力（Electron 专属）

这些操作**只有 Electron 版**能做，Docker 版需要提供替代方案或禁用。

| 能力 | IPC 通道 | Docker 替代 |
|---|---|---|
| 窗口管理 | `window-minimize`, `window-close` | N/A（浏览器行为） |
| 托盘操作 | `tray-set-tooltip`, `tray-flash` | N/A |
| 文件对话框 | `dialog-open-file`, `dialog-save` | 浏览器 `<input type="file">` |
| 系统通知 | `notification-show` | Web Notification API |
| 剪贴板 | `clipboard-write` | `navigator.clipboard` |
| 全局快捷键 | `shortcut-register` | N/A |
| Steam 集成 | `steam-*` | N/A |
| 进程管理 | `backend-restart`, `get-app-path` | Docker restart |

### 4.2 走 HTTP 的能力（两种模式通用）

| 能力 | 接口 |
|---|---|
| 所有业务 API | `GET/POST/PUT/DELETE /api/*` |
| 聊天流式 | `SSE /api/chat/stream` |
| 配置管理 | `/api/configs` |
| 记忆 CRUD | `/api/memories` |
| Agent 管理 | `/api/agents` |
| Gateway 实时通信 | `WS /ws/gateway` (Protobuf) |

---

## 5. 前端运行时检测

```typescript
// config/runtime.ts
export const isElectron = typeof window !== 'undefined' && !!(window as any).electron
export const isDocker = !isElectron

// 功能特性检测
export const features = {
  /** 是否支持原生文件对话框 */
  nativeFileDialog: isElectron,
  /** 是否支持托盘 */
  systemTray: isElectron,
  /** 是否支持全局快捷键 */
  globalShortcuts: isElectron,
  /** 是否支持 Steam */
  steam: isElectron,
}
```

```vue
<template>
  <!-- 仅 Electron 显示的按钮 -->
  <button v-if="features.systemTray" @click="minimizeToTray">
    最小化到托盘
  </button>
</template>
```

---

## 6. Docker Compose 示例

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile.backend
    ports:
      - "9120:9120"
    volumes:
      - pero-data:/app/data
    environment:
      - PERO_PORT=9120
      - PERO_DATA_DIR=/app/data
      - PERO_DATABASE_PATH=/app/data/perocore.db

  frontend:
    build:
      context: .
      dockerfile: docker/Dockerfile.frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  pero-data:
```

---

## 7. 运行时选择

| 场景 | 推荐运行时 | 说明 |
|---|---|---|
| Electron 桌面版 | **Node.js** | Electron 内嵌 Node.js，无法更换 |
| Docker 后端版 | **Bun 优先** | 启动快、原生 SQLite、原生 TS |
| Docker 前端版 | **Nginx** | 静态文件服务 |
| 开发环境 | **Bun** | `bun run dev` 更快 |
| CI/CD | **Node.js** | 兼容性最好 |

---

## 8. 鉴权系统 (D34)

### 8.1 设计原则

| 原则 | 说明 |
|---|---|
| **Electron 版不需要鉴权** | localhost 本机访问，天然安全 |
| **Docker 版必须鉴权** | 端口暴露到公网/内网，需要保护 API、WebSocket、前端控制面板 |
| **单用户模型** | 不存在多用户、不需要角色权限 |
| **轻量实现** | Token/密码 → JWT，不引入 OAuth/SSO 等重型方案 |

### 8.2 Token 来源

```
优先级：
1. 环境变量 PEROCORE_AUTH_TOKEN（用户预设）
2. data/auth.json 中保存的 bcrypt 哈希（用户在控制面板修改的密码）
3. 首次启动自动生成随机 Token → 打印到日志 + 写入 data/auth.json
```

```
[PeroCore] ════════════════════════════════════════════════
[PeroCore]  首次启动，已自动生成访问令牌：
[PeroCore]  🔑 a7k9x3m2p5
[PeroCore]  请使用此令牌登录控制面板
[PeroCore]  或通过环境变量 PEROCORE_AUTH_TOKEN 自定义
[PeroCore] ════════════════════════════════════════════════
```

### 8.3 登录流程

```
前端                              后端
  │                                │
  │  POST /api/auth/login          │
  │  { token: "a7k9x3m2p5" }      │
  │ ──────────────────────────────→│
  │                                │ bcrypt.compare(token, hash)
  │  200 { jwt: "eyJ..." }        │
  │ ←──────────────────────────────│
  │                                │
  │  存入 localStorage             │
  │                                │
  │  GET /api/memories             │
  │  Authorization: Bearer eyJ...  │
  │ ──────────────────────────────→│
  │                                │ JWT 验证
  │  200 { code: "OK", data: [...]}│
  │ ←──────────────────────────────│
  │                                │
  │  WS /ws/gateway                │
  │  Hello { token: "eyJ..." }     │
  │ ──────────────────────────────→│
  │                                │ JWT 验证 → 注册节点
```

### 8.4 后端实现

#### 中间件

```typescript
// middleware/auth.ts
import { jwt } from 'hono/jwt'
import type { AppConfig } from '../config'

export function createAuthMiddleware(config: AppConfig) {
  // Electron 模式 → 完全跳过鉴权
  if (config.runtime === 'electron') {
    return async (c: any, next: any) => await next()
  }

  // Docker 模式 → JWT 验证
  return jwt({ secret: config.jwtSecret })
}
```

#### 路由注册

```typescript
// app.ts
const authMiddleware = createAuthMiddleware(config)

// 白名单路由（无需鉴权）
app.post('/api/auth/login', authController.login)
app.get('/api/auth/status', authController.status)
app.get('/api/health', healthController.check)

// 静态文件（前端 SPA）
app.get('/*', serveStatic({ root: './public' }))

// 需要鉴权的路由
app.use('/api/*', authMiddleware)
```

#### AuthService

```typescript
// services/auth/authService.ts
import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

export class AuthService {
  private secret: Uint8Array

  constructor(private config: AppConfig) {
    this.secret = new TextEncoder().encode(config.jwtSecret)
  }

  /** 验证 Token/密码，成功返回 JWT */
  async login(token: string): Promise<string | null> {
    const stored = await this.getStoredHash()
    if (!stored) return null

    const valid = await bcrypt.compare(token, stored)
    if (!valid) return null

    // 签发 JWT，7 天有效期
    const jwt = await new SignJWT({ sub: 'owner', iat: Date.now() })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(this.secret)

    return jwt
  }

  /** 修改密码 */
  async changePassword(oldToken: string, newToken: string): Promise<boolean> {
    const stored = await this.getStoredHash()
    if (stored && !await bcrypt.compare(oldToken, stored)) return false

    const hash = await bcrypt.hash(newToken, 10)
    await this.saveHash(hash)
    return true
  }

  /** 首次启动：自动生成 Token */
  async ensureToken(): Promise<string | null> {
    // 环境变量优先
    const envToken = process.env.PEROCORE_AUTH_TOKEN
    if (envToken) {
      const hash = await bcrypt.hash(envToken, 10)
      await this.saveHash(hash)
      return null  // 不打印（用户已知）
    }

    // 已有存储 → 跳过
    if (await this.getStoredHash()) return null

    // 首次启动 → 自动生成
    const token = crypto.randomBytes(8).toString('hex')
    const hash = await bcrypt.hash(token, 10)
    await this.saveHash(hash)
    return token  // 返回明文以打印到日志
  }
}
```

### 8.5 JWT 配置

| 配置项 | 值 | 说明 |
|---|---|---|
| 算法 | HS256 | 对称加密，单服务器部署足够 |
| 有效期 | **7 天** | 平衡安全性与便利性 |
| Secret 来源 | 首次启动随机生成 → 存 `data/jwt_secret.key` | 重启后 JWT 仍有效 |
| Payload | `{ sub: 'owner', iat, exp }` | 单用户模型不需要更多字段 |

### 8.6 前端集成

```typescript
// composables/useAuth.ts
export function useAuth() {
  const token = ref(localStorage.getItem('perocore_jwt') || '')
  const isLoggedIn = computed(() => !!token.value)

  async function login(inputToken: string): Promise<boolean> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inputToken }),
    })
    if (!res.ok) return false

    const { jwt } = await res.json()
    token.value = jwt
    localStorage.setItem('perocore_jwt', jwt)
    return true
  }

  function logout() {
    token.value = ''
    localStorage.removeItem('perocore_jwt')
  }

  return { token, isLoggedIn, login, logout }
}

// Transport 层自动附加 Authorization
// services/transport/httpTransport.ts
class HttpTransport {
  private getHeaders(): HeadersInit {
    const jwt = localStorage.getItem('perocore_jwt')
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }
}
```

### 8.7 Gateway WS 鉴权

Gateway 的 Hello 握手中 `token` 字段改为携带 JWT：

```typescript
// 前端 gateway.ts
const hello: Hello = {
  token: localStorage.getItem('perocore_jwt') || '',  // JWT 而非原始 Token
  deviceName: 'PeroChat 桌面端',
  clientVersion: '2.0.0',
  platform: detectPlatform(),
  capabilities: ['audio.in', 'audio.out'],
}
```

```typescript
// 后端 gatewayHub.ts handleHello()
private async handleHello(ws: WSContext, envelope: Envelope) {
  // Electron 模式跳过验证
  if (this.config.runtime === 'electron') {
    this.registerNode(ws, envelope); return
  }

  // Docker 模式验证 JWT
  try {
    await jwtVerify(envelope.hello!.token, this.secret)
    this.registerNode(ws, envelope)
  } catch {
    ws.close(4001, '鉴权失败')
  }
}
```

### 8.8 Docker Compose 更新

```yaml
# docker-compose.yml
services:
  backend:
    environment:
      - PERO_PORT=9120
      - PERO_DATA_DIR=/app/data
      - PERO_DATABASE_PATH=/app/data/perocore.db
      # 鉴权（可选，不设则首次启动自动生成）
      - PEROCORE_AUTH_TOKEN=your_custom_password
```

### 8.9 前端登录页

Docker 模式下，未登录用户访问任何前端路由时，Vue Router 守卫重定向到 `/login`：

```typescript
// router/index.ts
router.beforeEach((to, from, next) => {
  const { isLoggedIn } = useAuth()

  // Electron 模式不需要登录
  if (isElectron) { next(); return }

  // 白名单路由
  if (to.path === '/login') { next(); return }

  // 未登录 → 跳转登录
  if (!isLoggedIn.value) { next('/login'); return }

  next()
})
```

---

## 9. 多目标构建矩阵 (D46)

### 9.1 构建变体总览

| # | 变体 | 平台 | Electron | Steam SDK | 打包格式 | 自动更新 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | **Steam 版** | Windows x64 | ✅ | ✅ | NSIS 安装包 | Steam 自带 | 当前主力 |
| 2 | **标准版** | Windows x64 | ✅ | ❌ | NSIS 安装包 | electron-updater | 当前主力 |
| 3 | **便携版** | Windows x64 | ✅ | ❌ | ZIP 解压即用 | electron-updater | 当前主力 |
| 4 | **Docker 版** | Linux x64 | ❌ | ❌ | Docker Image | docker pull | 当前主力 |
| 5 | **Linux 桌面版** | Linux x64 | ✅ | ❌ | AppImage / deb | 待定 | 待实现 |
| 6 | **Mac 版** | macOS ARM64 | ✅ | ❌ | DMG | 待定 | 待实现 |

窗口标题统一为 `萌动链接：PeroperoChat！`，所有变体一致。

### 9.2 双轴解耦模型

差异只有三个维度，代码层面只需处理前两个：

```
维度 1: Edition（版本）   → steam | standard     ← 代码分支
维度 2: Platform（平台）  → win-x64 | linux-x64 | mac-arm64 | docker  ← 代码分支
维度 3: Packaging（打包） → nsis | portable | appimage | dmg | docker  ← 纯构建配置
```

### 9.3 Edition 编译标记

```typescript
// packages/desktop/src/edition.ts
export const EDITION = (process.env.PEROCORE_EDITION ?? 'standard') as 'steam' | 'standard'
export const IS_STEAM = EDITION === 'steam'
```

Steam 相关代码**全部用 dynamic import + IS_STEAM 门控**，standard 版构建时 tree-shaking 完全去除：

```typescript
// packages/desktop/src/services/steamService.ts
export async function initSteam(): Promise<SteamApi | null> {
  if (!IS_STEAM) return null
  try {
    const { init } = await import('steamworks.js')
    return init(4457100)
  } catch {
    logger.warn('Steam', 'steamworks.js 初始化失败，以标准模式运行')
    return null
  }
}
```

### 9.4 Platform 适配层（预留）

```typescript
// packages/backend/src/platform/index.ts
export type PlatformId = 'win-x64' | 'linux-x64' | 'mac-arm64' | 'docker'

export function detectPlatform(): PlatformId {
  if (process.env.PEROCORE_DOCKER === '1') return 'docker'
  const p = platform()
  const a = arch()
  if (p === 'win32') return 'win-x64'
  if (p === 'linux') return 'linux-x64'
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64'
  throw new Error(`不支持的平台: ${p}-${a}`)
}
```

```typescript
// packages/backend/src/platform/paths.ts
const PLATFORM_PATHS: Record<PlatformId, PlatformPaths> = {
  'win-x64':   { dataDir: path.join(process.env.APPDATA!, 'PeroCore') },
  'linux-x64': { dataDir: path.join(os.homedir(), '.config', 'perocore') },
  'mac-arm64': { dataDir: path.join(os.homedir(), 'Library/Application Support/PeroCore') },
  'docker':    { dataDir: process.env.PERO_DATA_DIR ?? '/data' },
}
```

### 9.5 Electron Builder 配置矩阵

```
packages/desktop/
  ├── electron-builder.base.yml       ← 共享配置
  ├── electron-builder.steam.yml      ← extends base + Steam 文件
  ├── electron-builder.standard.yml   ← extends base, 无 Steam
  └── electron-builder.portable.yml   ← extends standard, target=portable
```

```yaml
# electron-builder.base.yml — 共享骨架
appId: com.perocore.peroperochat
productName: "萌动链接：PeroperoChat！"
directories:
  output: dist_electron
files:
  - "dist/**/*"
  - "resources/**/*"
  - "!resources/steam/**"      # 默认排除 Steam 文件
extraResources:
  - from: "../backend/dist"
    to: "backend"
  - from: "../backend/prompts"
    to: "backend/prompts"
  - from: "../backend/agents"
    to: "backend/agents"
```

```yaml
# electron-builder.steam.yml
extends: electron-builder.base.yml
files:
  - "dist/**/*"
  - "resources/**/*"           # 覆写：不排除 Steam 目录
extraFiles:
  - from: "resources/steam/steam_api64.dll"
    to: "."
  - from: "resources/steam/steam_appid.txt"
    to: "."
win:
  target: nsis
```

```yaml
# electron-builder.standard.yml
extends: electron-builder.base.yml
publish:
  provider: github              # electron-updater 从 GitHub Releases 拉取更新
win:
  target: nsis

# electron-builder.portable.yml
extends: electron-builder.standard.yml
win:
  target: portable
```

### 9.6 构建脚本

```jsonc
// package.json (root)
{
  "scripts": {
    // ── 当前主力 ──
    "build:steam":     "cross-env PEROCORE_EDITION=steam    electron-builder --win --config packages/desktop/electron-builder.steam.yml",
    "build:standard":  "cross-env PEROCORE_EDITION=standard electron-builder --win --config packages/desktop/electron-builder.standard.yml",
    "build:portable":  "cross-env PEROCORE_EDITION=standard electron-builder --win --config packages/desktop/electron-builder.portable.yml",
    "build:docker":    "docker build -t perocore-backend .",

    // ── 待实现 ──
    "build:linux":     "cross-env PEROCORE_EDITION=standard electron-builder --linux --config packages/desktop/electron-builder.standard.yml",
    "build:mac":       "cross-env PEROCORE_EDITION=standard electron-builder --mac --arm64 --config packages/desktop/electron-builder.standard.yml"
  }
}
```

### 9.7 Native Addon 交叉编译

| Addon | win-x64 | linux-x64 | mac-arm64 | Docker |
|---|---|---|---|---|
| `@perocore/render-core` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ❌ 不需要 |
| `@perocore/nit-runtime` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ✅ prebuild |
| `steamworks.js` | ✅ 仅 steam 版 | ❌ | ❌ | ❌ |
| `better-sqlite3` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ✅ prebuild |

使用 `prebuildify` 或 `prebuild-install` 预编译，CI 中针对每个平台跑一次编译并上传 `.node` 文件。

### 9.8 自动更新策略

| 变体 | 更新机制 | 说明 |
|---|---|---|
| Steam 版 | Steam 自带 | Depot 更新，零代码 |
| 标准版 / 便携版 | `electron-updater` | 从 GitHub Releases 下载 |
| Docker 版 | `docker pull` | 用户手动或 CI/CD |
| Linux / Mac | 待定 | 随平台实现一起确定 |

### 9.9 Linux / Mac 待实现适配清单（预留）

| 适配项 | Linux x64 | Mac ARM64 |
|---|---|---|
| 系统托盘 | Electron Tray API 通用 | ✅ 原生支持 |
| 自动启动 | `.desktop` 文件 | Login Items |
| 原生通知 | libnotify | Notification API |
| Rust 编译目标 | `x86_64-unknown-linux-gnu` | `aarch64-apple-darwin` |
| 字体渲染 | 需验证中文字体 | ✅ 原生良好 |
| GPU (Three.js) | 需测试 Mesa/Vulkan | ✅ Metal |

---

## 10. 跨设备实时同步 (D48)

### 10.1 场景

用户同时拥有 Electron 桌面版 + 自部署 Docker 版（24 小时在线），需要两端数据一致。

### 10.2 方案：Electron 远程直连 Docker 后端

PeroCore 依赖外部 API（LLM、Embedding、Reranker、TTS 等），**没有网络本身就无法使用**，因此不存在离线场景。

方案极简：**让 Electron 直接连接远程 Docker 后端，不启动本地后端。数据只有一份，零同步逻辑。**

```
桌面 Electron (纯壳 + 3D 渲染)           服务器 Docker (唯一后端)
┌───────────────────────┐               ┌───────────────────────┐
│ Vue 前端               │               │ PeroCore 后端          │
│ Three.js 3D 渲染      │ ──HTTP/WS──→  │ :9120                  │
│ 音频 VAD/PTT          │               │ SQLite (唯一真理源)     │
│                       │               │ TriviumDB (唯一真理源)  │
│ ❌ 不启动本地后端      │               │ 记忆 / 日记 / 配置      │
└───────────────────────┘               └───────────────────────┘
```

### 10.3 Electron 连接模式

```typescript
// packages/desktop/src/config/connectionMode.ts
type ConnectionMode =
  | { type: 'local' }                                // 启动本地后端子进程
  | { type: 'remote', url: string, jwt?: string }    // 连接远程 Docker

// 默认 'local'，用户可在设置页切换为 'remote'
```

**切换逻辑**：

```typescript
// packages/desktop/src/main/backendManager.ts
async function setupBackend(mode: ConnectionMode) {
  if (mode.type === 'local') {
    // 启动本地后端子进程
    await spawnLocalBackend()
    return 'http://localhost:9120'
  } else {
    // 远程模式：不启动子进程，直接用远程 URL
    // Docker 端的 JWT 鉴权(D34) 直接复用
    return mode.url  // e.g. 'http://192.168.1.100:9120'
  }
}
```

**前端无需任何改动**——前端已经通过 `HttpTransport` + `WsTransport` 与后端通信，换个 base URL 就完事了。

### 10.4 数据迁移

从「本地模式」切换到「远程模式」时，提供一次性数据迁移工具：

```
POST /api/sync/import
Content-Type: multipart/form-data

files:
  - perocore.db          (SQLite)
  - memory.tdb           (TriviumDB)
  - workspace/diary/*    (日记文件)
```

Docker 端接收后合并到自己的数据库中。迁移后本地数据可选择保留或清空。

### 10.5 为什么不做双向实时同步

1. **PeroCore 没有离线场景**——依赖外部 LLM/Embedding/TTS API，断网 = 无法使用
2. **SQLite + TriviumDB 双向同步极其复杂**——需要改全部表结构、改 TriviumDB 引擎、处理冲突…工程量不合理
3. **远程直连零成本解决问题**——改一个 URL 配置，现有架构完美支持

---

_本文档由 Carola 整理，适用于 PeroCore-TS 多目标部署方案。_

