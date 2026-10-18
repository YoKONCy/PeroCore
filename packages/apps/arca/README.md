# Arca

> infOS 的可独立运行办公套件：文稿、资源、版本、审阅与本地模型由应用自身持有；既可独立运行，也可接入 infOS 由 AI 角色协作编辑。

---

## 它能做什么

- **文稿写作与编辑**：以文稿为权威对象，围绕它组织资源、版本与审阅，修订可追溯。
- **资源与版本**：文稿、资源、版本、审阅统一由应用自身管理。
- **本地模型**：应用自身可发起本地模型请求，凭据由应用加密保存。
- **本地协作任务**：应用自身的协作任务与桌面存活绑定，独立运行时也完整可用。
- **接入 infOS 后**：可由 AI 角色协作编辑文稿——协作授权绑定到实例、角色、文稿、基础修订与范围，成果回到原对话；角色也可通过 `arca_collaborate` 工具发起文稿任务。

## 快速上手

### 在 infOS 里
- **Electron**：从新标签页的「Arca」卡片打开；运行、连接与诊断在 Arca 自身的「设置 → 连接与运行」。
- **浏览器部署**：从状态栏的应用入口打开。

### 独立运行（不需要 infOS）
```bash
pnpm --filter @infos/arca dev:client       # 打开 Arca 客户端
pnpm --filter @infos/arca dev:standalone   # 启动独立后台（会打印文稿链接）
```
> 独立后台默认 HTTP 端口 **7365**；`--port=0` 使用随机端口。独立模式不绑定 Kernel 或桌面归属。

---

## 架构一览

| 层 | 职责 |
| :-- | :-- |
| **infOS 兼容层** | 启停与实例归属、宿主认证、角色任务编排、原会话交付、受限页面桥接 |
| **子应用兼容层** | 协议与实际能力对应、会话校验、任务授权、发现、页面托管、桌面存活绑定 |
| **子应用本体** | 文稿权威、办公事务、资源、持久任务、本地 API 执行与加密凭据 |

业务内核**不导入 infOS 私有后端，不读取宿主地址或桌面存活凭据**。本地模型请求由应用自身执行，不经过能力 Provider。

## 目录结构

```
packages/apps/arca/
├── src/               # 子应用后台：Host、办公事务、模型、能力与协作权威
├── client/            # Vue 客户端：文稿工作台
├── tests/             # 业务与生命周期测试
└── app.manifest.json  # Application 声明
```

## 本地开发

- 客户端：`pnpm --filter @infos/arca dev:client`
- 独立后台：`pnpm --filter @infos/arca dev:standalone`
- 已有客户端资源时可用 `src/main.ts --standalone`（发行 Host 使用同目录 `ui/`；`--dev-ui` 显式使用开发前端）。

环境变量、生命周期、协作授权与验证细节见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 深入文档

- 本包工程细节 → [DEVELOPMENT.md](./DEVELOPMENT.md)
- 通用子应用接入模型 → [.docs/A10_APPLICATION_INTEGRATION.md](../../../.docs/A10_APPLICATION_INTEGRATION.md)
- AIOS 架构基线 → [.docs/A09_AIOS_ARCHITECTURE.md](../../../.docs/A09_AIOS_ARCHITECTURE.md)

## 验证状态

本次仅进行源码目测 review，**未运行程序、构建、测试或程序性静态检查**；独立入口、桌面崩溃回收、模型请求及实际会话交付仍需运行验收。
