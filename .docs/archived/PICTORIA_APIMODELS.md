# APIModels 服务商

## 使用

画布或工作流顶栏打开「供应商 → APIModels」，填写自己的 API Key，分别选择生成模型与编辑模型并保存。创作栏及工作流节点目录随即提供对应步骤；节点可复制已有 API 为独立配置。

已接入图片生成、图片编辑和视频生成。视频型号与参考输入见 [视频步骤说明](PICTORIA_VIDEO_AND_REFERENCES.md)；音频与 LLM 仍可通过通用 API 节点单独配置。APIModels 不依赖 infOS 的模型配置或认证，独立运行与嵌入运行共用同一实现。

## 模型

| 模型 | 编辑参考图上限 | 输出档位 |
| --- | --- | --- |
| GPT Image 2 | 16 | 1K / 2K / 4K |
| Nano Banana 2.1 | 10 | 1K / 2K / 4K |
| Seedream 5.0 Pro | 1 | 1K / 2K |
| Seedream 5.0 Flash | 1 | 1K / 2K |
| Seedream 5.0 Lite | 1 | 2K / 4K |
| Seedream 4.5 | 1（保守限制） | 1k / 2k / 3k / 4k |

官方文档：[客户端入口](https://apimodels.app/zh/integrations)、[GPT Image 2](https://apimodels.app/zh/docs/gpt-image-2)、[Nano Banana 2.1](https://apimodels.app/zh/docs/nano-banana-2-1)、[Seedream](https://apimodels.app/zh/docs/doubao-seedream)。原请求中的 `/zh/docs/clients` 无法打开，现行客户端指南链接到 `/zh/integrations`。

不同型号独立声明比例、分辨率字段与上限；GPT Image 2 的 5:4／4:5 在 2K、4K 下提前拒绝。提示词使用自然语言，无自动转换。参考图接受 PNG／JPEG／WebP、每张不超过 10 MB，按顺序通过官方支持的数据 URI 提交，避免本地 URL 不可达。总请求仍受 100 MB 限制，参考图数据预留 95 MB 上限。

## 协议与恢复

- 默认地址 `https://api.apimodels.app/v1/`，Bearer 认证；POST `images/generations`，GET `images/generations?task_id={id}`。
- 适配 `data.taskId`、`data.state`、`data.resultUrls`、`data.failMsg`；业务层错误码转为可读异常，不将 HTTP 200 的拒绝误当作提交成功。
- 配置、凭据、服务和步骤使用独立命名空间，不替换 AtlasCloud；密钥仅存在后台加密存储中。
- 沿用提交回执、状态持久化、90 秒单请求超时、6 小时恢复窗口和资源落盘机制。断线后已取得任务 ID 则继续轮询；提交结果不明时保留现场，不自动重发可能计费的请求。没有声称平台支持幂等请求头。
- 接收任务时固定服务快照；调整供应商选择不切换已接收任务的模型。

## 验证

已人工审阅目录注册、共享配置组件、独立运行通道、节点配置与请求恢复链路。新增回归用例覆盖多参考输入、提交回执复用、响应丢失不重复提交、凭据冲突、业务错误与字段校验。

- TODO：用户授权后运行回归测试与真实 API 联调，验证各型号生成、编辑、断线恢复和前端交互。

本轮未运行构建、测试、静态检查、应用启动或真实生成请求。
