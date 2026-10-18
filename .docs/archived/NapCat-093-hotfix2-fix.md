# 0.9.3-hotfix2 便携版 NapCat 已登录但未连接

## 定位

QQ 已扫码并在 NapCat 终端收到消息，说明 NapCat 的安装和 QQ 登录已经成功。`onebot11_<QQ>.json` 是 OneBot 配置，`napcat_<QQ>.json` 是账号运行配置，均不应通过删除来修复此问题。文件用途和新账号默认配置见 [NapCat 官方文档](https://doc.napneko.icu/config/basic)。

发行构建将 Daemon 和 Social runtime 打成两个独立 bundle。原代码让 Social runtime 直接导入 `setSocialNapcatAdapter`，导致两个 bundle 各有一份 `_napcatAdapter`：Social 写入自己的副本，Daemon 的 WebSocket 处理器仍读到 null。主服务和社交页面可以正常运行，但反向 WS 会被 Daemon 关闭。

另外，SocialTab 仅初始化时查询连接状态，扫码后不会自动更新；首次启动只有发现账号配置后才写 WS 地址，晚于 NapCat 首次读取配置。

## 修复

- AppManager 为内置 Social 注入 `registerSocialTransport`。注册函数在 Daemon 中执行，返回绑定本次注册的释放函数；初始化成功后发布，失败和停止时清理。
- 移除 Application Host ABI 中的全局注册 setter，避免独立打包再次复制注册表。
- 重连关闭旧连接时按 sender 身份注销，旧 close 事件不能移除新连接；无账号头的默认连接也正常关闭。
- NapCat 启动前同步 `onebot11.json` 默认配置和已有账号配置，保留其他客户端和账号运行设置。
- 页面串行刷新连接状态，隐藏时暂停，区分服务异常与正常未连接；启动前检查社交服务是否就绪。
- 发行烟雾测试在健康检查后模拟 OneBot 反向连接，并验证 `/api/social/status` 为已连接，避免仅凭主 HTTP 正常判定发行成功。
- 发行资源包含标准数据库迁移的 journal 和 snapshot。

## 验证边界

回归测试将真实 Social runtime 和 WebSocket 宿主分别打包，再进行真实本地 WebSocket 握手和状态查询；不需要真实 QQ 登录或模型调用。账号配置测试使用临时目录，验证首次启动、幂等同步与保留已有设置。

用户升级修复版后保留原账号 JSON 文件，重启 infOS 与 NapCat 即可。旧发行包的独立注册表问题无法通过重装 NapCat 或删除账号配置彻底解决。
