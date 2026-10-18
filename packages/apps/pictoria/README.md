# Pictoria

> infOS 的绘图创作子应用：在 **自由画布 + 工作流** 上做图像 / 视频创作，也能脱离 infOS 独立运行。

---

## 它能做什么

- **自由画布**：把图片、GIF、视频、音频和文字便签拖进画布，自由平移缩放、框选多选、拖动调整大小、复制删除、撤销重做、适应视图。
- **一键执行步骤**：选中素材后就近显示可用「步骤」——图像生成／编辑、抠图、超分、视频生成、LLM 分析等；按步骤输入 schema 填写要求，后台执行，结果就近落回画布。
- **工作流编辑器**：把多个步骤连成有向流程（串行／并行／子工作流），声明输入输出与使用说明，验证后「发布」为画布和 Agent 都能调用的步骤。
- **资源库**：提示词库、素材库、成品库三合一；搜索分页、素材标签／收藏、成品自动归档与「最终稿」标记、参数溯源与再次编辑。
- **内置与自定义服务**：内置 AtlasCloud 图像生成／编辑（可选 Nano Banana Pro、Seedream 5.0 Pro）；自定义服务／步骤可用 JSON 导入。
- **任务不中断**：创作请求提交后由独立宿主执行，关闭页面不会取消任务；重新打开可按项目找回已提交的任务。
- **可被 AI 调用**：主 Agent 通过单一 `pictoria` 工具提交创作，结果自动回到发起任务的对话。

## 快速上手

### 在 infOS 里
- **Electron**：从新标签页的「Pictoria」卡片打开画布。
- **浏览器部署**：从状态栏的应用入口打开。
- 打开后即为自由画布，可从工具栏切换项目、资源库与工作流编辑器。

### 独立运行（不需要启动 infOS）
```bash
pnpm --filter @infos/pictoria dev:client      # 打开 Pictoria 客户端
pnpm --filter @infos/pictoria dev:standalone  # 启动独立后台（会打印画布链接）
```
> 独立模式按后台输出的画布链接连接，不依赖 infOS 登录或模型配置。

---

## 架构一览

Pictoria 采用与 Arca 同方向的「自治子应用」接入模型，分三层：

| 层 | 职责 |
| :-- | :-- |
| **infOS 兼容层** | 工具投影、调用归属、受限模型桥接、素材输入、结果回传原会话／社交通道 |
| **子应用兼容层** | 声明 Endpoint／Offer／Requirement／Tool，Node 协议与本地鉴权 HTTP |
| **子应用主体** | 项目、步骤、工作流、执行、素材、提示词与独立数据迁移 |

子应用**不导入 infOS 私有后端，不直接修改主 Thread**；infOS **不打开 Pictoria 的数据库**，双方只经过公开端点和资源桥接。Arca 与 Pictoria 共用声明驱动的 Application 控制器 / 能力投影 / Federation。

## 目录结构

```
packages/apps/pictoria/
├── src/               # 子应用后台：宿主入口、领域与业务、数据迁移
├── client/            # Vue 客户端：画布、工作流编辑器、资源库、配置
├── tests/             # 业务边界与协议测试
└── app.manifest.json  # Application 声明
```

## 本地开发

- 客户端：`pnpm --filter @infos/pictoria dev:client`
- 独立后台：`pnpm --filter @infos/pictoria dev:standalone`
- 根目录 `pnpm start` 会同时拉起 Arca 与 Pictoria，并在 Pictoria 就绪后启动 Electron。

端口、环境变量、宿主 API、业务契约与发行细节见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 深入文档

- 本包工程细节与协议契约 → [DEVELOPMENT.md](./DEVELOPMENT.md)
- 通用子应用接入模型 → [.docs/A10_APPLICATION_INTEGRATION.md](../../../.docs/A10_APPLICATION_INTEGRATION.md)
- AIOS 架构基线 → [.docs/A09_AIOS_ARCHITECTURE.md](../../../.docs/A09_AIOS_ARCHITECTURE.md)

## 验证状态

画布、三种资源库、工作流编辑器、AtlasCloud 配置页与独立入口均已接入源码；本轮仅做人工源码审阅，**未运行构建、测试、类型／模板检查、应用启动或真实绘图请求**。
