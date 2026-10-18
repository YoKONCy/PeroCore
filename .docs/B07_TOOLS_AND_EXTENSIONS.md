# 工具与扩展

## 页面与分类

侧栏「工具与扩展」复用原 `mcp_config` 导航标识，包含：

- **扩展工具**：DeepWiki、Sciverse.space，均为 infOS 自带官方适配。卡片使用品牌图形，打开各自配置 HUD。
- **拓展功能**：联网搜索、PDF 解析。每项进入独立子页面，再管理具体来源。
- **MCP 服务**、**技能**：保留原管理能力。

MinerU 只作为 PDF 解析来源；搜索服务商只作为联网搜索来源，均不进入扩展工具大类。页面使用现有像素组件和主题变量；品牌图形随应用提供，来源见 `public/integration-brands/SOURCES.md`。

## 配置与生命周期

配置保存到现有 configs 表的 `integrations.v1`，无需数据库结构迁移。

- 官方扩展只有在必填配置完整且启用后才注册到 ToolRegistry。停用或清除必填配置后不再向模型提供工具。
- DeepWiki 默认使用官方 Streamable HTTP MCP 地址，不需要 Key；Sciverse 需要 API Key。
- 搜索与 PDF 可各保存最多 32 个来源，每种功能只选用其中一个；删除当前来源会停用功能，不自动切换其他来源。
- 修改端点或来源类型时，不把旧凭据自动带到新端点。留空只在端点和类型不变时保留旧 Key，也可明确清除。
- 管理 API 只返回 `hasApiKey`，不返回密钥正文。完整配置表示本地配置通过校验，不表示已经联网验证成功。
- 保存和启用不会自动调用服务商的接口。网络调用只发生在用户上传 PDF 或 Agent 实际调用工具时。
- 配置写入串行处理，重启保持启用状态。来源切换不改变已经开始的解析任务所使用的配置快照。

## 扩展工具

DeepWiki、Sciverse 使用 Manifest V2 的官方 Package 与 tool contribution，分别注册 `deepwiki_query`、`sciverse_search`。入口由宿主提供，不恢复旧 Extension Loader，也不将整个 AppContext 交给扩展。

- `deepwiki_query(repository, question)`：通过官方 MCP 的 `ask_question` 查询公开仓库；内部连接在调用后释放，支持超时和取消。
- `sciverse_search(query, limit)`：调用 `/agentic-search`，保留文献编号、命中片段和来源。传 `doc_id`、`offset` 时改为读取 `/content` 原文片段，仍使用一个工具。
- 工具注册后仍受既有 Agent、频道和会话权限限制。
- 返回结果在服务端按条目和文字预算收敛，保持 JSON 完整；截断时明确标记，不将长结果直接塞满上下文。

官方接口参考：

- https://docs.devin.ai/work-with-devin/deepwiki-mcp
- https://sciverse.space/docs/cookbook/fulltext-evidence

## 联网搜索

原生工具 `web_search` 仅在当前来源配置完整且功能启用时注册。

首批来源：

- Tavily：Key、服务地址、常规/深入检索、默认结果数。
- Brave Search：Key、服务地址、默认结果数。
- SearXNG：实例地址、默认结果数；实例需开放 JSON 格式搜索。

工具输入为 `query`、可选 `limit`（1～10），统一输出标题、URL、摘要和来源。不会并发查询多个来源，也不会在失败后静默换源。

接口参考：

- https://docs.tavily.com/documentation/api-reference/endpoint/search
- https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
- https://docs.searxng.org/dev/search_api.html

## PDF 解析

统一 `PdfParserAdapter` 接口处理 PDF 字节、文件名、来源配置及取消信号，向附件服务返回文字。首批提供：

- MinerU 轻量模式：免 Key，最多 10MB，页数与 IP 额度按服务商规则。
- MinerU 精准模式：需要 Token，可选择 VLM/Pipeline；应用当前上传上限 50MB。
- 通用 HTTP 解析：POST multipart，包含 `file`、`language`、`ocr`；可选 Bearer Key，返回 `{ "markdown": "…" }` 或 `{ "text": "…" }`，当前最多 50MB。

MinerU 使用签名上传与异步状态查询；轻量模式读取 Markdown 下载结果，精准模式只读取结果包内的 `full.md`，不解压其他文件或路径。上游返回的签名链接限定为服务商文件域名。

附件流程：

1. 前端从后端能力接口获取 PDF 是否可用和大小限制；选择器、拖入上传与后端均检查该能力。
2. 上传原始 PDF 后返回 `processing`，前端显示「解析中」，此时不能发送该附件。
3. 解析完成后变为 `uploaded`，解析文字按现有用户附件流程进入本轮上下文，原始 PDF 保留用于查看和下载。
4. 失败变为 `failed`，展示原因并可重试；移除未发送附件会取消本地请求/轮询并删除原文件。
5. 每次解析最多等待十分钟，同时最多处理八份 PDF。重启时将中断的 processing 记录标为失败；本轮不恢复浏览器中未发送的附件列表。

本轮不提供 PDF Agent 工具，也不自动将附件写入知识库。解析文字继续遵守现有附件预算：最多 120,000 字符且最多 30,000 Token，超出时明确要求拆分，不静默截断。

接口参考：https://mineru.net/apiManage/docs

## HTTP 管理接口

- `GET /api/integrations`
- `PUT /api/integrations/extensions/:id`
- `PUT /api/integrations/features/:kind`
- `POST /api/integrations/features/:kind/sources`
- `DELETE /api/integrations/features/:kind/sources/:id`
- `GET /api/attachments/capabilities`
- `GET /api/attachments/:id`
- `POST /api/attachments/:id/retry`

所有管理接口沿用现有认证与 API 信封。

## 本轮验证范围

按用户要求，仅修改、格式化和阅读源码，并阅读公开接口文档、获取品牌资源。未启动应用，未进行运行时调试，未运行类型/模板检查、构建或测试；也未使用用户凭据调用这些外部服务。实际联通性和界面显示尚未验证。
