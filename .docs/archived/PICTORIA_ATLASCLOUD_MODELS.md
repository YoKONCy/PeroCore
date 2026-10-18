# AtlasCloud 编辑模型与节点剪贴板

## 编辑模型

型号字段、默认值和接口文档集中维护在 `packages/apps/pictoria/src/atlasModels.ts`。编辑模型与生成模型分别列出，新增编辑模型不改变生成模型的可选范围。配置保存后创建内置步骤的新版本，前端与 Agent 共用输入 schema。

| 编辑模型 | 参考图上限 | 官方接口 |
| --- | ---: | --- |
| Nano Banana | 10 | [文档](https://www.atlascloud.ai/docs/more-models/google/nano-banana-edit/generateImage) |
| Nano Banana Pro | 10 | [文档](https://www.atlascloud.ai/docs/more-models/google/nano-banana-pro-edit/generateImage) |
| Nano Banana 2 | 14 | [文档](https://www.atlascloud.ai/docs/more-models/google/nano-banana-2-edit/generateImage) |
| Seedream 4.5 | 10 | [文档](https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v4.5-edit/generateImage) |
| Seedream 5.0 Lite | 14 | [文档](https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v5.0-lite-edit/generateImage) |
| Seedream 5.0 Pro | 10 | [文档](https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v5.0-pro-edit/generateImage) |
| FLUX.2 Pro | 8 | [文档](https://www.atlascloud.ai/docs/more-models/black-forest-labs/flux-2-pro-edit/generateImage) |
| FLUX.2 Flex | 8 | [文档](https://www.atlascloud.ai/docs/more-models/black-forest-labs/flux-2-flex-edit/generateImage) |
| GPT Image 2 | 10 | [文档](https://www.atlascloud.ai/docs/more-models/openai/gpt-image-2-edit/generateImage) |
| Qwen Image 2.0 | 3 | [文档](https://www.atlascloud.ai/docs/more-models/qwen/qwen-image-2.0-edit/generateImage) |
| Grok Imagine Image 2.0 | 3 | [文档](https://www.atlascloud.ai/docs/more-models/xai/grok-imagine-image-2.0-edit/generateImage) |

Grok 使用 `image_urls`；其他已适配型号使用 `images`。对外步骤统一接受 Pictoria 素材引用，由适配器上传并映射请求字段。各型号单独声明尺寸、比例、质量、格式、种子和可用高级参数，提交前再次校验。Qwen 官方文字描述与 schema 的图片上限不一致，目前取 schema 的三张限制，提示词上限 800 字符；Grok 为 8000 字符。Seedream 5.0 Pro／Lite 允许 GIF，其他型号仍限定 PNG、JPEG、WebP；单图维持 20 MB 上限。

AtlasCloud 原有持久化提交回执、素材上传回执、轮询与异常恢复链路继续共用。切换供应商默认型号后，旧画布草稿需要通过刷新步骤使用新 schema，已配置独立 API 的节点沿用自己的配置。

### 上传与尺寸显示修复

AtlasCloud [官方上传示例](https://github.com/AtlasCloudAI/atlas-cloud-skills/blob/main/atlas-cloud/SKILL.md#upload-media)返回 `data.download_url`。上传解析已补齐该字段及旧版 `url`、`file_url` 等兼容字段，避免本地图片上传成功后仍被判断为缺少图片地址；上传端点按 JSON 解析，不受响应 MIME 缺失影响。原始上传回执继续保留，修复后恢复未提交生成请求的失败任务时可重新解析回执。

本地导入、图库与生成结果中的图片统一使用 Pictoria 素材引用上传，无需用户把本地路径手动转换为公网地址。格式、数量与大小仍遵循所选模型的输入契约。

分辨率下拉框和当前选中值均显示比例标签。具体尺寸显示为 `2048 × 1152` 与 `16:9`；像素块取整造成的近似值标记为 `≈16:9`。`1k/2k/4k` 跟随当前选择的画面比例，动态引用导致比例未知时不编造固定比例。画布创作栏、创作节点和工作流参数共用显示逻辑，API 参数值保持原样。

## 复制粘贴

- 画布、工作流支持 `Ctrl/Cmd+C`、`Ctrl/Cmd+V`，工具栏提供复制／粘贴按钮；`Ctrl/Cmd+D` 继续创建就近副本。
- 粘贴到当前视野，重复粘贴错开位置。生成新节点 ID，保留相对布局，操作可撤销／重做。
- 输入框和可编辑文字保持原生剪贴板行为；普通文字、图片的画布粘贴入口保留。
- 画布复制素材引用、便签、创作参数和选中节点之间的连线。运行卡片粘贴为草稿；没有步骤定义的运行卡片粘贴为便签。任务 ID、执行状态和提交回执不进入剪贴板，不自动发起 API 请求。
- 工作流复制处理节点、附属备注、参数、多参考绑定与连线端口；独立备注也可复制。输入／输出接口保持唯一。同一工作流保留仍存在的外部引用；跨工作流只保留选中节点之间的绑定，断开的外部引用由校验提示补齐。
- 支持同一后台、同一创作归属下跨画布／跨工作流粘贴，画布与工作流的节点格式分别处理。素材仍引用同一资源，不重复上传；步骤引用同一版本，后续配置 API 仍默认创建独立副本。
- 原生复制事件写入专用 MIME 和文本备用格式；按钮使用系统剪贴板。浏览器禁止剪贴板权限时提示使用快捷键。

## 待运行验证

- TODO：授权后验证各新增 Edit 模型的真实 API 请求、图片数量、质量／尺寸选项与异步恢复；本轮未发送计费请求。
- TODO：授权后验证模型列表的 OpenAI 兼容／自定义路径、错误响应、断网／超时及内嵌与独立模式。
- TODO：授权后验证快捷键／按钮、跨画布、跨工作流、多参考绑定、备注、撤销／重做及任务副本不重复提交。
