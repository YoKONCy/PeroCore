# PeroCore-TS 前端迁移状态深度分析

> **分析日期**: 2026-04-20 05:27 · **分析人**: Carola 🐱

---

## 📊 前端总体规模对比

| 维度 | v1 (PeroCore) | v2 (PeroCore-TS) | 完成率 |
|------|---------------|-------------------|--------|
| **Views (页面)** | 7 个, **~22K 行** | 5 个, **~1.1K 行** | ~5% |
| **Components** | 12 子目录, **~10K 行** | 8 子目录, **~3.5K 行** | ~35% |
| **Composables** | dashboard/ + useStronghold | chat/ + 4 通用 hooks | ~40% |
| **API 层** | gateway.ts (Protobuf) + assets.ts | Transport + ApiClient + 8 模块 | ✅ 80% |
| **Stores** | 无 Pinia (状态散布各组件) | 4 个 Pinia Store | ✅ 新增 |
| **Pixel UI 组件库** | 无 (内联样式) | **17 个组件** | ✅ 新增 |
| **路由** | router/ | router/ (5 路由) | ✅ 完成 |

---

## 🔍 逐模块深度分析

### 1. Views (页面层) — ⚠️ 严重不足

| 页面 | v1 规模 | v2 现状 | 差距分析 |
|------|---------|---------|----------|
| **DashboardView** | 2,568 行 (80K bytes) | 322 行 (**容器+Tab切换已实装**) | ✅ 容器重构完成；Tabs 见下 |
| **ChatView** | ChatModeView 390 行 | 275 行 (含 ChatContainer 嵌入) | ✅ 基本结构有 |
| **WorkView** | 419 行 | 289 行 | ✅ IDE 布局结构有 |
| **StrongholdView** | 694 行 (29K bytes) | 224 行 (AgentPanel+FacilitySidebar) | ⚠️ 仅骨架 |
| **LauncherView** | 2,421 行 (112K bytes!) | **16 行** (纯占位) | ❌ 几乎空壳 |
| **Pet3DView** | 2,208 行 (68K bytes) | **不存在** | ❌ 完全缺失 |
| **MainWindow** | 146 行 | 不存在 (App.vue 承担) | ✅ 已重构 |

### 2. Dashboard Tabs — ⚠️ 大多是 placeholder

| Tab | v1 规模 | v2 现状 | 实际内容 |
|-----|---------|---------|----------|
| **OverviewTab** | 865 行 | 102 行 | ⚠️ 有卡片布局但数据硬编码 |
| **MemoriesTab** | 512 行 | **42 行** | ❌ 纯 placeholder，只有搜索框 |
| **ModelConfigTab** | 574 行 | **36 行** | ❌ 纯 placeholder，只有按钮 |
| **LogsTab** | ~300 行 | 48 行 | ❌ placeholder |
| **McpTab** | ~200 行 | 40 行 | ❌ placeholder |
| **TasksTab** | ~250 行 | 32 行 | ❌ placeholder |
| **UserSettingsTab** | ~300 行 | 36 行 | ❌ placeholder |
| **VoiceTab** | 756 行 | 35 行 | ❌ placeholder |
| **ResetTab** | ~150 行 | 76 行 | ⚠️ 有交互但简化 |

### 3. Chat 系统 — ✅ 相对完善

| 组件 | v1 规模 | v2 现状 | 评估 |
|------|---------|---------|------|
| **ChatContainer** | 内嵌 ChatInterface 1,991 行 | 199 行 | ✅ 容器拆分良好 |
| **MessageBubble** | 内嵌 | 198 行 | ✅ 独立组件 |
| **MessageSegment** | 内嵌 | 161 行 | ✅ 分段渲染 |
| **InputBar** | 内嵌 | 181 行 | ✅ 独立组件 |
| **CommandOverlay** | 无 | 119 行 | ✅ 新增 |
| **ConfirmOverlay** | 无 | 202 行 | ✅ 新增 |
| **ThinkingIndicator** | 内嵌 | 38 行 | ✅ 独立 |
| **composables/chat/** | 无 | 5 个文件 (~620 行) | ✅ 新增: scroll/stream/input/visibility |

### 4. 基础设施层 — ✅ 完善

| 模块 | v1 | v2 | 状态 |
|------|-----|-----|------|
| **Transport** | gateway.ts (Protobuf) | transport.ts (3.6K) | ✅ HTTP/WS 抽象 |
| **ApiClient** | 无系统化 | client.ts + 8 模块 | ✅ 统一封装 |
| **SSE Stream** | 无 | stream.ts (3.6K) | ✅ 新增 |
| **Error Handling** | 无 | errors.ts + errors.test.ts | ✅ 新增 |
| **Pinia Stores** | 无 (全局变量!) | 4 个 Store | ✅ 新增 |
| **Router** | 有 | index.ts (1K) | ✅ |

### 5. Pixel UI 组件库 — ✅ 新增亮点

v2 **全新** 构建了 17 个像素风 UI 组件（v1 没有组件库）:

| 组件 | 大小 | 功能 |
|------|------|------|
| PButton | 2.6K | 按钮 (primary/ghost/danger) |
| PInput | 1.4K | 输入框 |
| PTextarea | 3.7K | 多行文本 |
| PSelect | 6K | 下拉选择 |
| PSlider | 4.9K | 滑块 |
| PSwitch | 2.9K | 开关 |
| PCheckbox | 2.8K | 复选框 |
| PDialog | 3.8K | 对话框 |
| PCard | 1.1K | 卡片 |
| PImageViewer | 4.7K | 图片查看器 |
| PDatePicker | 2.1K | 日期选择 |
| PInputNumber | 3K | 数字输入 |
| PBadge | 1.6K | 徽章 |
| PTooltip | 3.1K | 工具提示 |
| PEmpty | 3.5K | 空态 |
| PixelIcon | 11.5K | 图标系统 (内置 SVG) |
| ContextMenu | 2.9K | 右键菜单 |

### 6. 缺失的大块 ❌

| 缺失模块 | v1 规模 | 严重度 | 说明 |
|----------|---------|--------|------|
| **LauncherView** | 2,421 行 | 🔴 高 | 启动器/首屏，用户第一印象 |
| **Pet3DView** | 2,208 行 | 🔴 高 | 3D 宠物 — 核心交互入口 |
| **BedrockAvatar** | 1,037 行 | 🔴 高 | 3D 头像渲染 + Live2D/Three.js |
| **AvatarRenderer** | 514 行 | 🔴 高 | 3D 渲染引擎 |
| **VoiceConfigPanel** | 756 行 | 🟡 中 | 语音配置 |
| **OnboardingOverlay** | 488 行 | 🟡 中 | v2 有 (190 行) 但内容简化 |
| **Dashboard Tabs 内容** | ~3,500 行 | 🟡 中 | 9 个 Tab 中 8 个是 placeholder |
| **Markdown 渲染 (完整)** | ~400 行 | 🟡 中 | v2 有 AsyncMarkdown (164 行) 但功能精简 |
| **Terminal 组件** | ~300 行 | 🟢 低 | v2 无 |
| **settings/ 面板** | ~1,000 行 | 🟢 低 | v2 无独立设置面板 |
| **modals/ 各种弹窗** | ~800 行 | 🟢 低 | v2 只有通用 PModal/PToast |

---

## 📊 前端完成率综合评估

```
基础设施 (Transport/Client/Store/Router)  ████████████████░░░░  80%
Pixel UI 组件库 (17 个)                    ████████████████████ 100% ✨
Chat 系统 (核心对话体验)                    ██████████████████░░  90%
Dashboard 容器                             ████████████████████ 100%
Dashboard Tab 内容                         ██░░░░░░░░░░░░░░░░░░  10%
Overlays/Modal                             ████████████████░░░░  80%
IDE/Work 模式                              ██████████████░░░░░░  70%
Stronghold (据点)                          ████████░░░░░░░░░░░░  40%
LauncherView (启动器)                      ░░░░░░░░░░░░░░░░░░░░   1%
Pet3DView + 3D Avatar                     ░░░░░░░░░░░░░░░░░░░░   0%
语音/TTS/ASR 界面                          ░░░░░░░░░░░░░░░░░░░░   0%
Electron 壳层                              ░░░░░░░░░░░░░░░░░░░░   0%
────────────────────────────────────────
前端综合                                    ████████░░░░░░░░░░░░  ~35%
```

---

## 🎯 前端剩余工作量评估

### 第一波: 核心对话体验可用 (~3 天)

> [!IMPORTANT]
> 这些是让产品「能用」的最低限度

| 任务 | 预估行数 | 说明 |
|------|---------|------|
| ChatContainer 接入真实 SSE 流 | ~100 行改 | 对接后端 /api/chat/stream |
| Dashboard OverviewTab 接入真实数据 | ~200 行 | 替换硬编码数据 |
| ModelConfigTab 实装 | ~400 行 | 模型列表 CRUD + Provider 配置表单 |
| MemoriesTab 实装 | ~350 行 | 记忆列表 + 搜索 + 详情弹窗 |
| UserSettingsTab 实装 | ~200 行 | 用户名/主题/语言 等基础设置 |

### 第二波: 完整仪表盘 + 设置 (~5 天)

| 任务 | 预估行数 | 说明 |
|------|---------|------|
| 剩余 Dashboard Tabs (4 个) | ~1,200 行 | Logs/Tasks/Voice/MCP |
| LauncherView 实装 | ~800 行 | 启动流程 + 后端连接检查 + 动画 |
| OnboardingOverlay 完善 | ~300 行 | 引导步骤 + API Key 配置 |
| VoiceConfigPanel | ~400 行 | TTS/ASR 配置面板 |
| StrongholdView 群聊 | ~500 行 | 群聊/据点完整交互 |

### 第三波: 进阶功能 (~8 天)

| 任务 | 预估行数 | 说明 |
|------|---------|------|
| Pet3DView + 3D Avatar | ~1,500 行 | Three.js / Live2D 渲染 |
| AvatarRenderer | ~500 行 | 3D 引擎封装 |
| 完整 Markdown 渲染 | ~300 行 | 代码高亮/LaTeX/Mermaid |
| Terminal 组件 | ~300 行 | xterm.js 集成 |
| Electron 壳层 | ~1,500 行 | IPC bridge + 窗口管理 + 后端进程管理 |

### 总预估

| 阶段 | 行数 | 天数 | 结果 |
|------|------|------|------|
| 第一波 | ~1,250 行 | 3 天 | ✅ 核心可用 |
| 第二波 | ~3,200 行 | 5 天 | ✅ 完整体验 |
| 第三波 | ~4,100 行 | 8 天 | ✅ 全功能 |
| **合计** | **~8,550 行** | **~16 天** | 前端完工 |

---

## 💡 现状总结

**前端确实还处于「内容填充期」**，你说得完全对喵！

### 已建好的 ✅ (地基层 ~65%)
- Transport 抽象 + ApiClient + SSE 流解析
- 4 个 Pinia Store (Agent/Config/Session/Notification)
- 17 个 Pixel UI 组件 (全新组件库!)
- Chat 系统 7 个组件 + 5 个 composable
- 路由 + 5 个 View 容器壳
- Overlays: FileSearch/Lyric/Onboarding/ReAct/Spotlight

### 需要填充的 ❌ (业务层 ~35%)
- **8/9 个 Dashboard Tab 是 placeholder** (只有标题和图标)
- **LauncherView 只有 16 行** (纯 "正在启动...")
- **Pet3DView + BedrockAvatar 完全不存在** (v1 合计 3,759 行)
- **语音配置/设置面板 完全缺失**
- **所有 Tab 都标着 `TODO: 接入 xxxApi`**

> [!WARNING]
> 前端是目前整个项目的 **最大短板**。后端 95% 完成、前端只有 ~35%。
> 按当前节奏需要约 **16 个工作日** 才能把前端内容全部填满。
