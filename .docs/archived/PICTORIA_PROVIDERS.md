# Pictoria 节点 API、供应商与独立运行

更新日期：2026-10-15。本轮仅修改并人工审阅源码，未执行构建、测试、静态检查、应用启动或真实 API 请求。

## 核心边界

Pictoria 子应用主体独立管理画布、工作流、素材、数据库、凭据与请求执行。infOS 兼容层提供可选的嵌入、Agent 工具及聊天交付；infOS 模型桥接是可选的 LLM 来源，不能作为子应用运行的前提。原则同时记录在包内 AGENTS.md。

## 入口

- 创作画布和工作流顶栏的“供应商”打开同一套配置 HUD。
- 工作流处理节点标题栏的连接图标、右侧“配置 API”打开节点 API 配置。
- 目录直接提供“API 步骤”和“LLM API”。默认创建独立 API 步骤；挂载模式另可选择“infOS LLM”。
- 输入／输出节点配置工作流接口；嵌套工作流的 API 属于其内部处理节点。

节点 API 支持独立地址／Key，或引用共享供应商；提供请求路径、模型名、认证、Headers、JSON／multipart、固定请求主体、输入输出映射与异步轮询。保存节点配置默认生成新的步骤和服务，保留同名输入引用，不修改其他节点共用的旧定义。凭据可以沿用原服务引用；填写新 Key 时保存到新服务，不回写原服务。

`LLM API` 提供可编辑的 OpenAI Chat Completions 起点：`chat/completions`、`messages.1.content` 输入映射、`choices.0.message.content` 文本输出。系统提示词、模型、请求字段均保存在本地 API 配置中。其他协议仍使用作者自定义的 API 字段映射；不假装所有提供商接口一致。

## 供应商契约

- `provider.list` 返回内置适配器描述和当前创作归属的通用供应商。
- `provider.save` 使用 `expectedRevision` 保存通用供应商的名称、URL、协议、默认模型、认证及启用状态。
- `provider.models` 接受供应商 `definition`，可在保存前获取模型列表。`modelsPath` 默认 `models`，相对于 Base URL；可设为 `/v1/models` 等同源路径。识别数组、`data`、`models`、`data.models`，支持 ID 字符串及带 `id/model/name` 的记录。
- 模型目录仅发起 GET，25 秒总超时、2 MB 响应上限、最多一次短暂重试；禁止重定向。沿用已保存凭据需保持相同域名和认证格式；供应商变更不会把密钥发给其他域名。获取失败保留手填模型 ID 的入口。
- `service.get` 按 ID 读取节点原 API 配置，不依赖服务目录是否超过展示数量；查询不会返回 Key。
- 内置适配器通过 `providers.ts` 注册设置／配置函数，前端按编辑器类型注册共享配置组件。AtlasCloud 保留专用上传与轮询适配；APIModels 提供独立的图片生成／编辑步骤、数据 URI 参考输入和任务轮询，详见 [APIModels 接入](PICTORIA_APIMODELS.md)。
- `provider.settings/configure` 可携带 `adapterId`；不传时兼容原 AtlasCloud 契约。
- 服务通过 `providerId` 显式引用共享连接和凭据。目录可用性、工作流校验、任务提交都解析同一份有效配置。
- 提交任务时冻结有效连接配置；已接收任务不因节点编辑切换请求地址。凭据留在 Pictoria 的 AES-GCM 加密存储中，查询仅返回是否已配置。
- 节点中写出的 `submit.body.model` 优先于供应商默认模型；默认模型只作为创建 API 配置时的起点。

## 独立运行

开发环境分别启动两个命令，不需要启动 infOS：

```powershell
pnpm --filter @infos/pictoria dev:standalone
pnpm --filter @infos/pictoria dev:client
```

使用 Pictoria 后台输出的“打开画布”链接。开发客户端默认 7363，独立 HTTP 后台默认 7364；`--port=0` 可使用随机端口，`PICTORIA_HTTP_PORT` 可指定固定端口。`PICTORIA_DATA_PATH` 指定独立数据目录，默认是启动目录下 `.pictoria`。开发入口显式使用 Vite，避免误读旧的客户端构建文件。

存在客户端发行资源时，`src/main.ts --standalone` 可由后台直接提供静态页面；`PICTORIA_UI_ROOT` 可以显式指定资源目录。Node 发行载体需要包含已生成的客户端与独立应用依赖；本轮未生成任何发行产物。

独立页面通过 `/pictoria-api/request` 调用 Pictoria 自己的同一执行引擎。浏览器会话码只存在启动链接的 fragment 与当前浏览器 sessionStorage，进入页面后移除 fragment；它与宿主桥接密钥分离，权限仅覆盖独立本地工作室。独立运行不读取 infOS 登录令牌、Agent 配置或模型配置。

独立模式支持 API／AtlasCloud 生成、LLM API、工作流发布与运行、素材和提示词库、任务查询及恢复。显式使用 infOS LLM 的旧步骤需在节点上改配 LLM API 后才能独立执行。关闭前端不会停止后台任务；后台终止由原有持久化回执与恢复机制承接。

独立开发后台可在启动终端按 Ctrl+C 正常停止；关闭浏览器标签页只关闭前端。

## infOS 托管生命周期

- 桌面通过主进程的 `pictoria:host-start` 启动或绑定托管 Pictoria。嵌入页面的重新连接也走同一路径，渲染页面不接触存活连接凭据。
- Electron 创建随机命名的本地连接（Windows named pipe，其他平台 Unix socket），以随机凭据完成握手。Daemon 和 Pictoria 各自持续观察连接；关闭单个前端标签不会关闭它。
- infOS 真正退出时，分别调用 Arca／Pictoria 的 `/shutdown-managed`，随后关闭存活连接。一个子应用停止失败不会跳过另一个；HTTP 不可达时，连接断开仍触发 Pictoria 停止。
- 桌面进程崩溃后，操作系统关闭连接。Pictoria 自行停止，同时 Daemon 回收自己持有的子进程句柄；子应用未及时结束时，Daemon 发送强制终止信号。
- Daemon 崩溃后，Pictoria 每秒检测原有宿主 PID，发现 `ESRCH` 后停止；无查询权限不会被误判为宿主死亡。Pictoria 的退出等待上限为八秒，超时直接结束进程。
- `/lifecycle/desktop` 仅接受 Pictoria 自身桥接密钥认证，且独立实例不允许绑定。一个托管实例只归属于同一桌面存活连接，避免换绑仍在运行的任务。
- `--standalone` 不读取 infOS 的宿主 PID 或桌面连接；外部发现的 `adopted` 实例不绑定桌面、不由 `/shutdown-managed` 停止。
- 退出停止本地执行并保留已有任务回执和项目数据，云端已接受的请求仍按供应商的实际状态恢复。

生命周期绑定需要新版本桌面、Daemon 和 Pictoria 后台共同加载；更新后重启 infOS。

## 待运行验证

- TODO：授权后验证无 infOS 进程时独立启动、会话连接、项目保存、素材上传／预览、LLM API、AtlasCloud 和工作流完整链路。
- TODO：授权后验证节点 API 副本、原凭据沿用、新 Key 隔离、共享供应商变更／停用、版本冲突与未知提交回执。
- TODO：授权后验证内嵌模式、独立发行静态入口、深浅色 HUD、键盘焦点和 API 配置错误后的重试。
- TODO：授权后运行新增的 `processLifetime.test.ts`，并实机验证桌面正常退出／强制结束、Daemon 强制结束、Pictoria 退出超时，以及独立实例不受影响。
