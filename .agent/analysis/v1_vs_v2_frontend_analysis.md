# PeroCore v1 (JS) vs PeroCore-TS v2 前端深度交叉分析报告

> 📅 分析时间: 2026-04-22 02:06
> 🐱 分析者: Carola

---

## 1. 核心差异总览

| 维度 | v1 (PeroCore) | v2 (PeroCore-TS) | 差距评估 |
|:---|:---|:---|:---|
| **CSS 框架** | TailwindCSS 3.4 + PostCSS | 纯 Vanilla CSS + CSS Variables | ⚠️ **关键差距** |
| **LauncherView** | 2572 行，完整控制面板 | 739 行，简化启动卡片 | 🔴 **严重缩水** |
| **Pet3DView** | 2518 行, 68KB，全功能 | 555 行, 14KB，精简重构 | 🟡 逻辑已拆分到 composables |
| **DashboardView** | 80KB, 完整控制台 | 11KB, 骨架 | 🔴 **严重缩水** |
| **ChatView** | 不存在(在 Pet3DView 内) | 419 行, 独立页面 | 🟢 v2 新增 |
| **启动流程** | Launcher → 启动后端 → 隐藏 Launcher → 拉起 Pet3D | Launcher → 检查 → 直接跳 ChatView | 🔴 **流程错误** |

---

## 2. 🔴 最严重问题：启动流程完全不同

### v1 的正确流程
```
Electron 启动
  → LauncherView (主控制面板, 窗口一直存在)
    → [首次] EULA 弹窗 → 接受
    → [首次] 新手引导 OnboardingOverlay
    → 用户点击 "启动 Pero" 大按钮
      → invoke('start_backend') 启动 Python 后端
      → invoke('start_napcat') 启动 NapCat (如启用)
      → 后端就绪后, Launcher 窗口自动隐藏
      → invoke('create-pet-window') 拉起 Pet3DView 窗口
        → Pet3D 是桌面上透明悬浮的 3D 角色！
        → 从 Pet3D 上的工具按钮可以打开:
          • 💬 ChatView (聊天窗口)
          • ⚙️ DashboardView (控制面板)
```

**v1 路由表** ([index.ts](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/router/index.ts)):
```typescript
// 注意：v1 **没有** /chat 路由！聊天集成在 Pet3DView 内
{ path: '/', redirect: '/launcher' },
{ path: '/launcher', component: LauncherView },
{ path: '/pet-3d', component: Pet3DView },
{ path: '/dashboard', component: DashboardView },
```

### v2 的当前流程 (❌ 错误)
```
Electron 启动
  → LauncherView (简化卡片)
    → 自动检查 5 项 (400ms 后开始)
    → 自动就绪 → 用户点 "进入"
    → router.push('/chat')  ← ❌ 直接跳到 ChatView
    → 再也回不到 Launcher
```

### ❗ 核心问题
v2 的 [handleEnter()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/views/LauncherView.vue#41-47) 直接 `router.push('/chat')`，完全跳过了 v1 的核心流程：
1. **缺少后端启动步骤** — v1 会通过 IPC 调用 `start_backend` / `start_napcat`，v2 完全没有
2. **缺少 Pet3D 窗口拉起** — v1 的核心是 Pet3D 桌宠，v2 完全不拉起
3. **Launcher 的角色被简化** — v1 的 Launcher 是一个完整控制面板(可回退)，v2 只是一次性启动卡片

---

## 3. 🔴 CSS 框架缺失导致的样式坍塌

### v1: TailwindCSS 3.4 驱动
- [style.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/style.css) 580 行 → 以 `@tailwind base/components/utilities` 开头
- 所有 View 组件使用 Tailwind utility classes 内联样式 (如 `bg-sky-50`, `flex`, `p-6`, `text-xl`)
- [tailwind.config.js](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/tailwind.config.js) 定义了自定义 `moe` 色板
- 80% 的样式信息在 `class="..."` 中，不在 `<style>` 块里

### v2: 纯 Vanilla CSS
- [style.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/style.css) 263 行 + [tokens.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/assets/tokens.css) 188 行 → 只有像素风组件类和 CSS Reset
- **没有 Tailwind utility classes** — 所有 `bg-sky-50`, `flex`, `p-6` 等 v1 的 class 全部无效
- 样式在 `<style scoped>` 中手写

### ⚠️ 问题
v1 的所有 View 模板都**极度依赖** Tailwind utilities:
```html
<!-- v1 LauncherView 中的一行代码 -->
<div class="bg-white pixel-border-mint p-6 transition-all group pixel-hover-lift press-effect">
```
上面这行中：
- `bg-white` → Tailwind ✅
- `pixel-border-mint` → 自定义 CSS ✅
- `p-6` → Tailwind ✅
- `transition-all` → Tailwind ✅
- `group` → Tailwind ✅
- `pixel-hover-lift` → 自定义 CSS ✅
- `press-effect` → 自定义 CSS ✅

如果照搬 v1 模板到 v2, **Tailwind 的 utility classes 全部失效**，只剩自定义 CSS。

---

## 4. View 文件逐页对比

### 4.1 LauncherView

| 特性 | v1 (2572 行, 112KB) | v2 (739 行, 19KB) |
|:---|:---|:---|
| 侧边导航栏 (首页/角色/插件/工具/环境) | ✅ 完整 5 标签 | ❌ 无 |
| CPU/内存/运行状态面板 | ✅ 实时 IPC 轮询 | ❌ 无 |
| 大型启动按钮 + 后端控制 | ✅ 启动/停止后端 | ❌ 只有"进入"按钮 |
| Agent 角色管理(列表/切换/启禁用) | ✅ 完整 CRUD | ❌ 无 |
| 插件管理(列表/指令集) | ✅ 完整 | ❌ 无 |
| 环境检测(Python/Node/VC++/NapCat等) | ✅ 丰富卡片 | ❌ 无 |
| 工具箱(Everything搜索/加密工具) | ✅ | ❌ 无 |
| EULA 弹窗 | ✅ (Teleport) | ✅ (Teleport) |
| 新手引导 OnboardingOverlay | ✅ | ✅ |
| Steam 用户状态 | ✅ | ❌ 无 |
| 像素装饰贴纸(猫/星/心/气泡) | ✅ 80+ 行装饰 | ❌ 无 |
| 自适应缩放 (scale) | ✅ | ❌ 无 |
| 状态栏(后端/NapCat连接) | ✅ | ❌ 无 |
| 日志终端面板 | ✅ | ❌ 无 |

### 4.2 Pet3DView

| 特性 | v1 (2518 行, 68KB) | v2 (555 行, 14KB) |
|:---|:---|:---|
| BedrockAvatar 3D 角色渲染 | ✅ | ✅ |
| 对话气泡 + ReAct 进度显示 | ✅ 极丰富 | ✅ 简化 |
| 语音系统 (VAD + PTT) | ✅ 内嵌800+行 | ✅ 拆分到 composables |
| 歌词模式 LyricOverlay | ✅ | ❌ 无 |
| 外观控制菜单(角色/服装/动作) | ✅ | ✅ FeatureControls |
| UI 缩放 + 鼠标穿透 | ✅ | ✅ |
| 文件搜索 FileSearchModal | ✅ | ❌ 无 |
| 聊天输入 + 工具按钮 | ✅ 97行工具栏 | ✅ PetOverlayUI |
| 从桌宠打开 Chat/Dashboard 窗口 | ✅ [openChatWindow()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/views/Pet3DView.vue#1631-1634), [openDashboard()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/views/Pet3DView.vue#1635-1638) | ❌ 无 |
| 情绪/氛围/内心 状态标签 | ✅ | ✅ |
| 双模式 (面板/独立窗口) | ❌ 仅独立窗口 | ✅ 支持两种模式 |

> **评价**: Pet3DView 的重构质量最好！逻辑拆分到了 6 个 composables (`usePetState`, `usePetBubble`, `usePetWindow`, `usePetGateway`, `usePetVoice`, `usePetAudio`)，结构更清晰。但缺少 LyricOverlay、FileSearchModal、以及**从 Pet3D 拉起其他窗口的功能**。

### 4.3 DashboardView

| 特性 | v1 (80KB, 巨型文件) | v2 (11KB, 骨架) |
|:---|:---|:---|
| 11 个 Tab 标签 | ✅ (Overview/Logs/Model/MCP/NapCat/Memories/Voice/Tasks/Terminal/Reset/UserSettings) | ❌ 可能只有骨架 |
| 子组件文件 | 11 个 `tabs/*.vue` 文件 | 极少 |

### 4.4 ChatView

| 特性 | v1 | v2 (419 行) |
|:---|:---|:---|
| 独立 ChatView | ❌ 不存在 | ✅ |
| 聊天在哪里 | 内嵌在 Pet3DView 的气泡中 | 独立页面 + ChatContainer |
| Agent 列表侧边栏 | ❌ | ✅ |

---

## 5. 组件层面对比

### 5.1 UI 组件库

| 组件 | v1 (`components/ui/`) | v2 (`components/pixel/`) | 状态 |
|:---|:---|:---|:---|
| PixelIcon | ✅ 11KB | ✅ 11KB | ✅ 已搬迁 |
| PButton | ✅ 3.5KB | ✅ 2.6KB | ✅ |
| PCard | ✅ 4KB | ✅ 1.1KB | 🟡 缩小 |
| PCheckbox | ✅ | ✅ | ✅ |
| PDatePicker | ✅ | ✅ | ✅ |
| PEmpty | ✅ | ✅ | ✅ |
| PImageViewer | ✅ | ✅ | ✅ |
| PInput | ✅ | ✅ | ✅ |
| PInputNumber | ✅ | ✅ | ✅ |
| PModal | ✅ 4.5KB | ❌ (改为 PDialog) | 🟡 |
| PSelect | ✅ | ✅ | ✅ |
| PSlider | ✅ | ✅ | ✅ |
| PSwitch | ✅ | ✅ | ✅ |
| PTextarea | ✅ | ✅ | ✅ |
| PTooltip | ✅ | ✅ | ✅ |
| ContextMenu | ✅ | ✅ | ✅ |
| NotificationManager | ✅ | ❌ 移到 `notification/` | 🟡 |
| PetNotificationManager | ✅ 5.7KB | ❌ 缺失 | 🔴 |

### 5.2 独有组件

**v1 有但 v2 缺失**:
- `components/onboarding/onboardingScripts.js` → v2 有对应 `launcher/onboardingScripts.ts`
- `components/settings/VoiceConfigPanel.vue` → v2 ❌
- `components/chat/LyricOverlay.vue` → v2 有但在 `overlays/` 目录
- `components/dashboard/tabs/` (11个标签组件) → v2 数量严重不足

**v2 新增**:
- [components/pixel/PBadge.vue](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/components/pixel/PBadge.vue) — v1 没有
- [components/overlays/ReActViewer.vue](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/components/overlays/ReActViewer.vue) — v1 内嵌在 Pet3DView
- [components/overlays/SpotlightMask.vue](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/components/overlays/SpotlightMask.vue) — 引导高亮遮罩

---

## 6. 样式系统对比

### v1 的 CSS 架构
```
TailwindCSS 3.4  ←— 提供 95% 的 utility classes
  ↓
style.css (580行)  ←— 自定义像素风组件类 (pixel-border-*, pixel-btn-*, 动画等)
  ↓
各 View 的 class="..." ←— 混合使用 Tailwind utilities + 自定义 classes
```

### v2 的 CSS 架构
```
tokens.css (188行)  ←— CSS Custom Properties (色彩/间距/字体令牌)
  ↓
style.css (263行)  ←— CSS Reset + 像素风组件类 (从 v1 搬迁)
  ↓
各 View 的 <style scoped>  ←— 手写所有布局/排版样式
```

### 缺失的样式

v1 [style.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/style.css) 中有但 v2 **缺失** 的关键样式类:

| 类名 | 功能 | v2 状态 |
|:---|:---|:---|
| `.pixel-border-sky` | 天蓝色像素边框 | ❌ 缺失！ |
| `.pixel-border-pink` | 粉色像素边框 | ❌ 缺失 |
| `.pixel-border-amber` | 琥珀色像素边框 | ❌ 缺失 |
| `.pixel-border-emerald` | 翠绿色像素边框 | ❌ 缺失 |
| `.pixel-border-mint` | 薄荷色像素边框 | ❌ 缺失 |
| `.pixel-border-yellow` | 黄色像素边框 | ❌ 缺失 |
| `.pixel-border-indigo` | 靛蓝色像素边框 | ❌ 缺失 |
| `.pixel-border-dark` | 深色像素边框 | ❌ 缺失 |
| `.pixel-border-sm-dark` | 深色小型像素边框 | ❌ 缺失 |
| `.pixel-border` | 通用像素边框 | ❌ 缺失 |
| `.pixel-border-moe` | Moe 风格像素边框 | ❌ 缺失 |
| `.pixel-card-moe` | Moe 风格卡片 | ❌ 缺失 |
| `.pixel-btn-moe-pink` | Moe 粉色按钮 | ❌ 缺失 |
| `.pixel-bg-moe` | Moe 渐变背景 | ❌ 缺失 |
| `.pixel-btn-yellow` | 黄色按钮 | ❌ 缺失 |
| `.pixel-btn-red` | 红色按钮 | ❌ 缺失 |
| `.transition-pixel` | 像素步进过渡 | ❌ 缺失 |
| `.animate-pixel-shake` | 像素抖动动画 | ❌ 缺失 |
| `.animate-pixel-bg-float` | 背景浮动动画 | ❌ 缺失 |
| `.animate-pixel-star` | 星星闪烁 | ❌ 缺失 |
| `.animate-pixel-bubble` | 气泡漂浮 | ❌ 缺失 |

> v2 的 [style.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/style.css) 只搬迁了 `.pixel-border-sm`, `.pixel-btn-sky`, `.pixel-btn-pink`, `.pixel-card`, `.pixel-glass` — **不到 v1 的 1/3**。

---

## 7. 修复优先级建议

### P0 — 紧急 (阻塞核心流程)

1. **修正启动流程**: [handleEnter()](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore-TS/packages/frontend/src/views/LauncherView.vue#41-47) 不应 `router.push('/chat')`
   - 应该通过 IPC 调用启动后端服务
   - 启动成功后**隐藏 Launcher 窗口**
   - 通过 IPC 让主进程拉起 [Pet3DView](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/router/index.ts#5-6) 窗口 (桌宠)
   - Pet3DView 才是核心入口，Chat/Dashboard 从 Pet3D 拉起

2. **补全像素风边框样式**: 从 v1 [style.css](file:///c:/Users/Administrator/OneDrive/%E6%A1%8C%E9%9D%A2/workspace/PeroCore/src/style.css) 搬迁所有 `pixel-border-*` 到 v2

### P1 — 重要 (功能完整性)

3. **LauncherView 功能恢复**: 最小化恢复 Agent 列表 + 启动/停止按钮 + 环境检测
4. **Pet3DView 窗口拉起**: 从 Pet3D 打开 Chat/Dashboard 窗口的 IPC 调用
5. **补全缺失动画类**: `animate-pixel-shake`, `animate-pixel-bg-float`, `animate-pixel-star`, `animate-pixel-bubble`

### P2 — 增强 (视觉品质)

6. **Dashboard Tabs 搬迁**: 逐步搬迁 v1 的 11 个 Dashboard Tab
7. **LyricOverlay 恢复**: 歌词模式显示
8. **PetNotificationManager 恢复**: 桌宠通知系统

---

## 8. 结论

> [!CAUTION]
> **v2 前端是一个严重未完成的半成品**。架构重构（monorepo + Vanilla CSS + composables 拆分）的方向是正确的，但内容搬迁只完成了约 **30%**。最致命的问题是**启动流程完全错误** — 把 ChatView 当成了核心入口，而 v1 的核心入口是 Pet3DView (3D 桌宠)。

