# 多目标部署架构

> **版本**：0.2.0 · **更新时间**：2026-04-22
> **适用范围**：PeroCore 全项目部署策略
> **依赖规范**：[A07_CROSS_PLATFORM](./A07_CROSS_PLATFORM.md)、[A08_DEVOPS](./A08_DEVOPS.md)

---

## 1. 两种部署形态

PeroCore 采用**前后端全解耦**架构，支持两种共生的部署形态：

| | Electron 桌面版 | Docker 后端版 |
|---|---|---|
| **运行环境** | Windows (Electron + Node.js) | Docker (Bun 优先 / Node.js 兜底) |
| **后端** | 作为子进程嵌入 Electron | 独立容器运行 |
| **前端** | Electron BrowserWindow 加载 | Nginx / 静态文件服务 |
| **IPC 能力** | ✅ 窗口管理、托盘、文件对话框 | ❌ 无 Electron，走 HTTP 替代 |
| **鉴权** | 跳过 (本地可信) | JWT + Token |
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

---

## 6. 多目标构建矩阵

### 6.1 构建变体总览

| # | 变体 | 平台 | Electron | Steam SDK | 打包格式 | 自动更新 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | **Steam 版** | Windows x64 | ✅ | ✅ | NSIS 安装包 | Steam 自带 | 当前主力 |
| 2 | **标准版** | Windows x64 | ✅ | ❌ | NSIS 安装包 | electron-updater | 当前主力 |
| 3 | **便携版** | Windows x64 | ✅ | ❌ | ZIP 解压即用 | electron-updater | 当前主力 |
| 4 | **Docker 版** | Linux x64 | ❌ | ❌ | Docker Image | docker pull | 当前主力 |
| 5 | **Linux 桌面版** | Linux x64 | ✅ | ❌ | AppImage / deb | 待定 | 待实现 |
| 6 | **Mac 版** | macOS ARM64 | ✅ | ❌ | DMG | 待定 | 待实现 |

### 6.2 双轴解耦模型

差异只有三个维度，代码层面只需处理前两个：

```
维度 1: Edition（版本）   → steam | standard     ← 代码分支
维度 2: Platform（平台）  → win-x64 | linux-x64 | mac-arm64 | docker  ← 代码分支
维度 3: Packaging（打包） → nsis | portable | appimage | dmg | docker  ← 纯构建配置
```

### 6.3 Edition 编译标记

```typescript
// edition.ts
export const EDITION = (process.env.PEROCORE_EDITION ?? 'standard') as 'steam' | 'standard'
export const IS_STEAM = EDITION === 'steam'
```

Steam 相关代码**全部用 dynamic import + IS_STEAM 门控**，standard 版构建时 tree-shaking 完全去除。

### 6.4 Electron Builder 配置矩阵

```
electron/
  ├── electron-builder.base.yml       ← 共享配置
  ├── electron-builder.steam.yml      ← extends base + Steam 文件
  ├── electron-builder.standard.yml   ← extends base, 无 Steam
  └── electron-builder.portable.yml   ← extends standard, target=portable
```

### 6.5 构建脚本

```jsonc
// package.json (root)
{
  "scripts": {
    // ── 当前主力 ──
    "electron:build":          "electron-builder --config electron-builder.standard.yml",
    "electron:build:steam":    "cross-env PEROCORE_EDITION=steam electron-builder --config electron-builder.steam.yml",
    "electron:build:portable": "electron-builder --config electron-builder.portable.yml",
    "build:docker":            "docker build -t perocore-backend .",

    // ── 待实现 ──
    "electron:build:linux":    "electron-builder --linux --config electron-builder.standard.yml",
    "electron:build:mac":      "electron-builder --mac --arm64 --config electron-builder.standard.yml"
  }
}
```

### 6.6 便携模式 (Portable)

在 `.exe` 同级目录下新建 `.portable` 空白文件，应用将读写本地 `userData/` 目录而非系统 `%APPDATA%`。

```typescript
// electron/main/utils/portable.ts
const portableMarker = path.join(path.dirname(process.execPath), '.portable')
export const IS_PORTABLE = fs.existsSync(portableMarker)

export function getDataDir(): string {
  if (IS_PORTABLE) return path.join(path.dirname(process.execPath), 'userData')
  return app.getPath('userData')
}
```

### 6.7 自动更新策略

| 变体 | 更新机制 | 说明 |
|---|---|---|
| Steam 版 | Steam 自带 | Depot 更新，零代码 |
| 标准版 / 便携版 | `electron-updater` | 从 GitHub Releases 下载 |
| Docker 版 | `docker pull` | 用户手动或 CI/CD |
| Linux / Mac | 待定 | 随平台实现一起确定 |

### 6.8 Native Addon 交叉编译

| Addon | win-x64 | linux-x64 | mac-arm64 | Docker |
|---|---|---|---|---|
| `@perocore/render-core` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ❌ 不需要 |
| `@perocore/nit-runtime` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ✅ prebuild |
| `steamworks.js` | ✅ 仅 steam 版 | ❌ | ❌ | ❌ |
| `better-sqlite3` | ✅ prebuild | ✅ prebuild | ✅ prebuild | ✅ prebuild |

---

## 7. Docker 部署规范

### 7.1 Docker Compose

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
      # 鉴权（可选，不设则首次启动自动生成）
      - PEROCORE_AUTH_TOKEN=your_custom_password
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9120/health"]
      interval: 30s
      timeout: 5s
      retries: 3

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

### 7.2 运行时选择

| 场景 | 推荐运行时 | 说明 |
|---|---|---|
| Electron 桌面版 | **Node.js** | Electron 内嵌 Node.js，无法更换 |
| Docker 后端版 | **Bun 优先** | 启动快、原生 SQLite、原生 TS |
| Docker 前端版 | **Nginx** | 静态文件服务 |
| 开发环境 | **Node.js** | `pnpm start` 一键启动 |
| CI/CD | **Node.js** | 兼容性最好 |

---

## 8. 鉴权系统

### 8.1 设计原则

| 原则 | 说明 |
|---|---|
| **Electron 版不需要鉴权** | localhost 本机访问，天然安全 |
| **Docker 版必须鉴权** | 端口暴露到公网/内网，需要保护 |
| **单用户模型** | 不存在多用户、不需要角色权限 |
| **轻量实现** | Token → JWT，不引入 OAuth/SSO |

### 8.2 Token 来源

```
优先级：
1. 环境变量 PEROCORE_AUTH_TOKEN（用户预设）
2. data/auth.json 中保存的 bcrypt 哈希（用户在控制面板修改的密码）
3. 首次启动自动生成随机 Token → 打印到日志 + 写入 data/auth.json
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
```

### 8.4 JWT 配置

| 配置项 | 值 | 说明 |
|---|---|---|
| 算法 | HS256 | 对称加密，单服务器足够 |
| 有效期 | **7 天** | 平衡安全性与便利性 |
| Secret | 首次启动随机生成 → `data/jwt_secret.key` | 重启后 JWT 仍有效 |
| Payload | `{ sub: 'owner', iat, exp }` | 单用户模型 |

---

## 9. 跨设备远程连接

### 9.1 场景

用户同时拥有 Electron 桌面版 + 自部署 Docker 版（24 小时在线），需要两端数据一致。

### 9.2 方案：Electron 远程直连 Docker 后端

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

### 9.3 连接模式切换

```typescript
type ConnectionMode =
  | { type: 'local' }                                // 启动本地后端子进程
  | { type: 'remote', url: string, jwt?: string }    // 连接远程 Docker
```

前端无需任何改动——已通过 Transport 层与后端通信，换个 base URL 即可。

### 9.4 为什么不做双向实时同步

1. **PeroCore 没有离线场景**——依赖外部 LLM API，断网 = 无法使用
2. **SQLite + TriviumDB 双向同步极其复杂**——需改全部表结构、改引擎、处理冲突
3. **远程直连零成本解决问题**——改一个 URL 配置，现有架构完美支持

---

## 10. 跨平台路径管理

**路径严禁硬编码**。所有运行时路径应从统一工厂函数获取。

详见 [A07_CROSS_PLATFORM.md](./A07_CROSS_PLATFORM.md)。

### 10.1 逻辑前缀映射 (PathResolver)

| 前缀 | 含义 | Electron 映射 | Docker 映射 |
|---|---|---|---|
| `@app/` | 安装程序目录 (只读) | `resources/` | `/app` |
| `@data/` | 用户可写数据 | `%APPDATA%/PeroCore/` | `$PERO_DATA_DIR` |
| `@workshop/` | Steam 创意工坊 | `steamapps/workshop/...` | ❌ 不支持 |
| `@temp/` | 运行时临时文件 | 系统 TEMP | 系统 TEMP |

### 10.2 覆盖优先级 (AssetRegistry)

```
@data/custom/ (手动覆盖) > @workshop/ (创意工坊) > @app/ (内置资源)
```

---

*本文档由 Carola 整理，适用于 PeroCore 多目标部署方案。*
