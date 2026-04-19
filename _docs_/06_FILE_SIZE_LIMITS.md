# 文件大小与拆分规范

> **版本**：0.1.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 全项目

---

## 1. 参考上限

> 以下行数为**柔性指导**，不是死板的硬限。超过时应考虑拆分，但如果逻辑内聚性强、拆分反而增加复杂度，允许适当超出。

| 类型 | 参考行数 | 超过后建议拆分 |
|---|---|---|
| Vue SFC (`.vue`) | **~400 行** | 提取 composable / 子组件 |
| TypeScript Service (`.ts`) | **~500 行** | 按职责拆分为多个文件 |
| Electron 主进程模块 | **~300 行** | 按功能域拆分文件 |
| Router 文件 | **~300 行** | 按子资源拆分 |
| Repository 文件 | **~400 行** | 按操作类型拆分 |

---

## 2. 现有巨型文件拆分方案

以下为 PeroCore v1 中需要在迁移过程中拆分的文件。

### 2.1 `Pet3DView.vue` (2,517行) → 6 个模块

```
views/
  Pet3DView.vue              (~200行, 模板 + 组装)
composables/pet/
  usePetState.ts             (状态管理: mood/vibe/mind/agent)
  usePetVoice.ts             (VAD + PTT + 音频编码 + Gateway 交互)
  usePetBubble.ts            (气泡 UI 逻辑、自动消失、展开)
  usePetAppearance.ts        (模型切换 + 外观菜单 + 服装)
  usePetAudio.ts             (音频播放 + 唇同步 + 队列)
```

### 2.2 `DashboardView.vue` (2,793行) → 容器 + 子 Tab

```
views/
  DashboardView.vue          (~100行, 仅 Tab 容器)
components/dashboard/tabs/
  OverviewTab.vue
  ModelConfigTab.vue
  MemoriesTab.vue
  LogsTab.vue
  MaintenanceTab.vue
  VoiceTab.vue
  AgentTab.vue
```

### 2.3 `ChatInterface.vue` (2,192行) → 5 个模块

```
components/chat/
  ChatInterface.vue          (~250行, 容器布局)
  MessageList.vue            (消息渲染列表)
  MessageItem.vue            (单条消息)
  ChatInputBar.vue           (输入栏 + 表情 + 附件)
  ChatToolbar.vue            (工具栏)
composables/chat/
  useChat.ts                 (消息发送/接收/重试)
  useChatScroll.ts           (滚动锚定与无限加载)
  useChatFiles.ts            (文件上传/拖放)
```

### 2.4 `LauncherView.vue` (2,571行) → 4 个模块

```
views/
  LauncherView.vue           (~200行, 布局容器)
composables/launcher/
  useLauncherProgress.ts     (进度管理 + 状态机)
  useLauncherDownload.ts     (下载逻辑 + 重试)
  useLauncherEnv.ts          (环境检测)
components/launcher/
  LauncherProgress.vue       (进度条组件)
  LauncherStatus.vue         (状态显示)
```

### 2.5 后端 `reflection_service.py` (1,932行) → 6 个模块

```
services/memory/
  reflectionService.ts           (~200行, 入口调度器)
  maintenance/
    clusterAnalyzer.ts           (思维簇聚类)
    memoryConsolidator.ts        (记忆合并)
    preferenceExtractor.ts       (偏好提取)
  dream/
    dreamGenerator.ts            (梦境生成)
    diaryGenerator.ts            (桌面日记)
  scan/
    lonelyScanService.ts         (孤独记忆扫描)
```

### 2.6 后端 `main.py` (1,145行) → 入口 + 定时任务

```
app.ts                           (~150行, Hono 入口 + 路由注册)
lifecycle/
  startup.ts                     (启动初始化序列)
  cron/
    weeklyReport.ts              (周报生成)
    dreamTrigger.ts              (梦境触发)
    memoryMaintenance.ts         (记忆维护)
    lonelyScan.ts                (孤独记忆扫描)
    triggerCheck.ts              (提醒/话题触发)
    cleanup.ts                   (临时文件清理)
```

### 2.7 `electron/main/index.ts` (1,013行) → 按职责拆分

```
electron/main/
  index.ts                       (~100行, 纯启动入口)
  ipcBridge.ts                   (IPC 注册)
  appLifecycle.ts                (窗口创建、退出处理)
  backendProcess.ts              (后端进程管理)
```

---

*本文档由 Carola 整理，适用于 PeroCore-TS 文件大小规范。*
