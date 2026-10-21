# Docker Deployment

Docker 主应用经 Nginx 同源入口访问，默认地址为 `http://宿主机IP:3000`。手机与电脑使用同一个服务端，不需要部署第二份应用数据。

首次登录可使用 `INFOS_API_TOKEN` 管理凭据；未设置凭据且没有已配对设备时，可从 `docker compose logs backend` 获取五分钟内有效的一次性管理员配对码。登录后在「分布式 → 服务访问与设备」生成二维码，为其他设备授权并管理设备。填写目标设备可达的 IP 或域名入口；访问端口由容器端口映射或反向代理管理。

`INFOS_WEB_PORT` 控制 Web 发布端口；`INFOS_PUBLIC_URL` 可指定 HTTPS 公开入口。业务和能力端口默认绑定宿主回环地址，外部客户端统一走 Web 入口；额外节点接入可显式配置 `INFOS_BACKEND_BIND`。不要将容器内网地址用于手机二维码。

反向代理应转发 Host、Cookie 和 WebSocket Upgrade，并关闭 SSE 缓冲。普通 HTTP 支持文字、文件和任务；手机麦克风需要 HTTPS。

完整监听、鉴权、开发模式与移动端范围见仓库 `.docs/A04_DEPLOYMENT.md` 第 11 节。
