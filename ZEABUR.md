# Zeabur 部署说明

本仓库当前采用 Zeabur 单服务部署方案：Python 后端与 Vue WebUI 会一起构建进同一个容器中；NapCat 作为独立服务部署，并通过社交模式 WebSocket 反向连接回 PeroCore。

## 相关文件

- `Dockerfile`
  - 当前唯一且权威的单服务镜像构建入口，供 Zeabur 与手动 `docker build` 共用
- `zbpack.json`
  - 仅用于将 Zeabur 的 `app_dir` 固定为仓库根目录 `/`，避免在 pnpm workspace 下误选 `wiki` 子应用
- `backend/main.py`
  - 当检测到 `dist/` 存在时挂载 `/web`，并在启用 `PERO_DESKTOP_API_KEY` 时保护 `/web` 与大多数 `/api/*`

## Zeabur 必要设置

- 分支：`electron`
- Root Directory：`/`
- 持久化卷：挂载到 `/data`

## 推荐环境变量

- `PERO_DATA_DIR=/data`
- `PERO_DATABASE_PATH=/data/perocore.db`
- `PERO_DESKTOP_API_KEY=<可选；设置后启用 WebUI / API / WS 统一访问密钥>`
- `PERO_SOCIAL_WS_SECRET=<你的 NapCat 反向 WS 密钥>`

## 鉴权行为

- 未设置 `PERO_DESKTOP_API_KEY`
  - `/web/`、`/api/*`、`/ws/gateway`、`/ws/browser` 保持开放，兼容本地开发与内网使用
- 已设置 `PERO_DESKTOP_API_KEY`
  - `/api/system/health`、`/api/system/ping`、`/api/system/auth/status`、`/api/system/auth/validate` 保持公开
  - 其他大多数 `/api/*` 需要有效密钥
  - `/ws/gateway` 与 `/ws/browser` 也会校验相同密钥
  - 浏览器首次访问 `/web/` 时会被重定向到 `/web-unlock`，验证成功后服务端写入 `HttpOnly` Cookie，再自动返回原页面
  - WebUI 仍内置前端 `AuthGate`，用于 401/403 后重新解锁，以及在 Electron 远程模式下自动附加访问密钥

## 最终服务结构

- Zeabur 单服务
  - 自动检测根目录的 `Dockerfile`
  - 对外提供后端 API：`/api/*`
  - 对外提供前端页面：`/web/`
  - 如果开启 `PERO_DESKTOP_API_KEY`，未授权访问 `/` 或 `/web/` 时会先跳转到 `/web-unlock`
  - 接收 NapCat 的反向 WebSocket：`/api/social/ws`
- 独立 NapCat 服务
  - 连接到 `wss://<你的 Zeabur 域名>/api/social/ws`
  - 如可用，发送 `X-Self-ID`
  - 通过 `?token=<secret>` 或请求头 `x-pero-social-ws-secret` 提供密钥
- Windows Electron 前端
  - 使用远程后端模式连接服务器
  - 如果配置了 `PERO_DESKTOP_API_KEY`，则需使用相同密钥作为远程桌面访问密钥

## 说明

- `enable_social_mode` 现在会持久化到后端配置存储中，因此通过 WebUI 切换后，在后端重启后仍可保留，除非被环境变量或 CLI 参数覆盖。
- `napcat_ws_url` 和 `napcat_http_url` 仍然是易失占位配置，在当前反向 WebSocket 部署路径中不是必需项。
- WebUI 现在已经提供“标准管理”级别的社交模式管理能力：连接状态、API 响应、Bot 身份、基础诊断与最近错误。
- 浏览器模式不再暴露旧的 Electron 专用 NapCat 终端；如需远程排查，请使用 Web 管理面板。
- 由于仓库使用了 `pnpm-workspace.yaml` 且包含 `wiki`（VitePress 文档站点），Zeabur 可能会默认把 `wiki` 识别为要部署的 Node.js 应用，导致构建预览出现 `WORKDIR /src/wiki`、`vitepress` 等信息。
- 当前 `zbpack.json` 的作用就是把 `app_dir` 固定为 `/`，让 Zeabur 在仓库根目录检查并使用根 `Dockerfile` 进行 Docker 部署。
