# Arca 开发与接入说明

> 本文承接 Arca 的工程细节。用户向概览与快速上手见 [README](./README.md)。

---

## 1. 三层边界

| 层 | 入口 | 职责 |
| --- | --- | --- |
| infOS 兼容层 | `packages/backend/src/applications/arcaIntegration.ts`、`arcaCollaboration.ts`；Electron 的 `arcaLifetime.ts`、`arcaSurface.ts` | 启停与实例归属、宿主认证、角色任务编排、原会话交付、受限页面桥接 |
| 子应用兼容层 | `src/applicationHost.ts`、`manifest.ts`、各 Provider、`hostControl.ts`、`browserSurface.ts`、`collaborationAuthority.ts` | 协议与实际能力对应、会话校验、任务授权、发现、页面托管、桌面存活绑定 |
| 子应用本体 | `src/application.ts`、`officeService.ts`、`officeTasks.ts`、`modelClient.ts`、`modelRepository.ts`、`@infos/document-engine` | 文稿权威、办公事务、资源、持久任务、本地 API 执行与加密凭据 |

业务内核不导入 infOS 私有后端，不读取宿主地址或桌面存活凭据。本地模型请求由 `modelClient.ts` 执行，不经过能力 Provider。

## 2. 独立运行

开发时分别使用 `pnpm --filter @infos/arca dev:client` 和 `pnpm --filter @infos/arca dev:standalone`，再打开后台输出的文稿链接。独立后台默认 HTTP 端口为 7365；`--port=0` 可使用随机端口。WebSocket 端口由后台分配并写入页面入口。

已有客户端资源时使用 `src/main.ts --standalone`；发行 Host 使用同目录的 `ui/`。`--dev-ui` 显式使用开发前端。没有客户端资源时返回清晰的资源缺失状态，不自动连接 infOS。

可用配置：`ARCA_DATA_PATH`、`ARCA_DISCOVERY_PATH`、`ARCA_UI_ROOT`、`--port`、`--loopback-port`。旧的 `INFOS_ARCA_DATA_PATH` 和 `INFOS_ARCA_DISCOVERY_PATH` 保留兼容。独立模式不绑定 Kernel 或桌面归属。

## 3. 挂载与生命周期

- 托管启动由通用进程控制器执行；Electron 主进程把桌面存活凭据分别交给 Daemon 与 Arca 后台。桌面正常退出或连接意外断开都会回收托管后台。
- 启停与桌面归属变更串行处理。关闭先阻止对应实例的新协作，再撤销运行中任务的授权、取消角色任务、请求认证控制面退出；超时保留进程信号兜底。
- Arca 自身合并重复退出请求，并设置 8 秒强退时限。启动失败会回滚传输、任务、数据库、发现记录和数据目录锁。
- 外部发现实例标记为 `adopted`；宿主退出不终止外部实例。采用外部实例进行角色协作时，需要让宿主的数据路径与发现路径指向该实例；控制凭据只在兼容层读取。
- 同一数据目录只允许一个 Host。异常退出的锁仅在确认原 PID 已不存在后回收。

## 4. 任务与角色协作

`application.task` 实际提供 `task.submit/get/list/cancel/retry`。提交使用 `office.collaborate` 类型与稳定幂等标识，查询返回 `ApplicationTaskSnapshot`。旧 `office.task.*` 作为兼容入口保留。

角色协作的授权记录绑定实例、角色、文稿、基础修订和范围。授权与提案 ID 一一对应；角色不能指定另一任务的提案。选区上下文只暴露选中文字，替换由权威端保留选区外的文字与格式。章节修改不能越过授权章节。

任务报告成功前，由 Arca 权威端确认其绑定提案并验证版本和操作。用户取消、应用停止或实例更换后，迟到调用不再获得有效授权。已完成、待人工审阅的提案会保留。

从对话打开 Arca 时记录原 Thread 和角色。该角色的协作成果通过宿主持久投递服务回到原对话；交付再次校验角色归属和会话状态。消息、投递结算和会话事件同事务提交。没有来源对话时只保留任务通知，不猜测目标会话。

角色也可通过需审批的 `arca_collaborate` 工具直接发起文稿任务；后续读写工具只对该任务绑定的授权生效，后台任务不能嵌套创建另一项文稿任务。

## 5. 验证状态

本次仅进行源码目测 review，未运行程序、构建、测试或程序性静态检查。新增和调整的回归用例尚未执行；独立入口、桌面崩溃回收、模型请求及实际会话交付仍需运行验收。
