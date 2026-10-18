# 社交能力与工具契约

社交业务统一为 `social`、`social_group`、`social_account`。参数使用 `{ action, input, account_id? }`，每种操作有独立输入结构；共享目录位于 `packages/shared/src/socialTools.ts`。工具文档和执行器使用同一目录，执行时再次验证参数与权限。

不支持 anyOf 的模型传输层合并各分支的可选字段，并保留各操作的参数说明；执行层仍以所选 action 的原始结构验证，不能把传输兼容处理当作权限或参数放宽。

## 已接入范围

- 日常社交：联系人与资料、备注、好友申请和删除、历史消息与转发、图片与资源、收藏表情、资料卡点赞、戳一戳、消息回应与撤回、已读、联系人记忆、主人私聊模式和状态卡片。
- 群事务：群资料与成员、名片、群名与头像、禁言和成员管理、入群申请、公告与精华、群文件与目录、相册查询上传和互动。
- 账号与空间：资料、签名、头像、在线状态；文字与多图说说、可见范围、发布记录和删除；好友动态、说说列表与详情、点赞、评论和转发。
- 等待、延后、任务控制、私有心流与宿主通信保持独立流程工具。

## 三层调用链

主应用的三个工具通过 AppManager 的同名 command 委派给社交子应用；主应用不访问 QQ 凭据或平台 SDK。社交运行时以 SocialOperations 统一处理账号、输入、权限与副作用，NapCat 与 QzoneClient 负责平台访问。应用清单同步声明三个入口和只读的能力描述入口。

当前会话默认使用可信入站账号。非主人不能改选账号；主应用连接多个 QQ 时必须显式选择。消息操作核验本地消息所属账号；普通会话只能访问本会话历史和当前群。账号修改、空间写入和群管理仅主人可用，主应用按具体 action 进入现有审批策略。停止、暂停和宿主取消信号贯穿平台请求。

## 空间实现

发布与删除使用 NapCat 4.18.38 原生 `send_qzone_msg`、`delete_qzone_msg`。每次发布保存 tid、正文、可见范围与时间；删除后标记记录。可见范围显式指定为 public、friends、selected、private、exclude；selected 和 exclude 必须提供 target_uins。

浏览与互动通过 NapCat 获取当前账号的临时空间凭据，访问固定空间 CGI 地址。凭据不落盘、不暴露给模型。只解析 JSON/JSONP 与动态数据，不执行返回脚本、不跟随重定向；响应有超时和大小上限。查询返回账号绑定、30 分钟有效的 post_id，详情和互动只能使用该引用。

空间 CGI 不属于 NapCat 稳定 OneBot 契约，仍需实号联调确认不同账号权限、网络和服务端响应。接口错误必须返回失败，不能伪装为空列表。

协议核对来源：[NapCat 4.18.38](https://github.com/NapNeko/NapCatQQ/tree/v4.18.38/packages/napcat-onebot/action)、[空间发布](https://github.com/NapNeko/NapCatQQ/blob/v4.18.38/packages/napcat-onebot/action/extends/SendQzoneMsg.ts)、[空间 CGI 参考](https://github.com/Eganchiyu/qzone-sdk/tree/main/src/qzone_sdk)。

## 结果不明的操作

写操作在发出前保存操作日志，并按账号串行。相同调用恢复时复用已完成结果；相同参数的 pending 或 uncertain 操作会阻止重复提交。超时、取消、断连或投递后记录失败均不能直接自动重放。

主人可用 social_account.operations 查看记录，核对实际结果后通过 operation_resolve 标记 completed 或 not_sent。未确认的日志不随普通历史截断丢弃。说说发布记录独立保留最近 500 条。

## 验证范围

单元用例覆盖账号绑定、群友越权、未知参数、业务错误、说说发布记录、防重复提交、生命周期、JSONP 与凭据隔离。按项目约定未运行测试、构建或 QQ 实号操作；静态检查结果以本次交付说明为准。

## 收藏表情

> 以下内容并入自原 `SOCIAL_ACCOUNT_STICKERS.md`。

### 使用方式

- 表情归属 QQ 账号，由 NapCat 的收藏管理接口读写。角色资源包不再提供预设表情，旧 `use_stickers` 配置读取时忽略。
- 社交 Agent 使用一个 `social_sticker` 工具：`list`、`search`、`read`、`collect`、`describe`、`delete`。
- 回复使用 `[sticker:查询返回的ID]`，桥接层按原有位置交错发送文字与表情。发送前重新核验账号收藏；失效标记不泄露给用户，也不记为发送成功。
- 工具仅接入社交回合，不注册到主 Agent 工具库。账号由可信入站消息绑定，模型不能指定其他账号。
- `collect` 接受当前会话来源 `message_id` 与从 1 开始的 `image_index`；可同时提供最多 200 字的描述。下载在 NapCat 主机上执行，兼容分机部署。
- 有视觉能力的社交模型可用 `read` 查看收藏图片；没有视觉能力时使用现有描述。图片经多模态部分传递，不把 base64 重复塞进文字上下文。

### 管理入口

社交配置 → 收藏表情：选择已连接 QQ 账号，同步、搜索、分页查看、修改描述、移除收藏。GIF 保留动图播放。删除在卡片内确认，无原生弹窗。

### 接口与结果确认

- 使用 `fetch_custom_face_detail`、`add_custom_face`、`set_custom_face_desc`、`delete_custom_face`、`download_file`。
- NapCat `download_file` 未传文件名时，以文件 MD5 命名；以此去重和确认收藏结果。
- 删除使用 `resId`，不使用 MD5。写操作串行，完成后再次拉取 QQ 收藏核验。
- 收藏成功但描述更新失败会返回已收藏的 ID 与警告，不把整次收藏报为失败。
- 超时或结果未确认会明确反馈，提示先同步确认，避免盲目重试。
- 收藏列表缓存 30 秒。一次最多拉取 4096 条，达到上限时返回 `truncated`；工具默认每页 20 条，前端每页 30 条。
- 图片预览限制 20 MB、15 秒，仅接受实际 PNG、JPEG、GIF、WebP 数据，不代理模型任意传入的 URL。

### 验证范围

已人工审阅源码与调用链，并更新账号隔离、无效标记过滤、删除结果确认和收藏部分成功的回归用例源码。未运行测试、构建、静态类型检查、模板检查、应用启动或真实 QQ 接口调试。
