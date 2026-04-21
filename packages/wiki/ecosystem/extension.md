# 浏览器插件 (Browser Extension) - Pero Browser Bridge

Pero 浏览器插件是一个关键的生态组件，它充当了 AI 助手与外部 Web 世界之间的“桥梁”。通过该插件，AI 可以实时感知用户正在浏览的内容，并能模拟人类操作进行网页交互。

## 1. 核心架构 (Core Architecture)

浏览器插件采用 **WebSocket** 协议与 Pero 后端（`BrowserBridgeService`）进行双向实时通信。

- **前端 (Extension)**: 运行在 Chrome/Edge 浏览器中，负责网页内容的提取和模拟操作。
- **后端 (PeroCore)**: 负责发送指令并接收网页分析结果。

```mermaid
graph LR
    A[浏览器页面] <--> B[Content Script]
    B <--> C[Background SW]
    C <-->|WebSocket| D[Pero 后端]
```

## 2. 关键组件 (Key Components)

### 2.1. 后台脚本 (Background Service Worker)

位于 `browser_extension/background.js`。

- **连接管理**: 维护与 `ws://localhost:9120/ws/browser` 的长连接。
- **重连机制**: 使用指数退避算法和 `chrome.alarms` 确保连接在浏览器重启或网络波动后自动恢复。
- **指令分发**: 接收来自后端的 `open_url`、`back`、`refresh` 等浏览器层级指令。

### 2.2. 内容脚本 (Content Script)

位于 `browser_extension/content_script.js`。

- **网页简化 (Markdown)**: 自动提取页面中的标题、段落、链接和按钮，并将其转化为精简的 Markdown 格式。这有助于减少 LLM 的 Token 消耗并提高理解准确度。
- **元素定位**: 使用一套强大的混合定位算法（XPath、CSS Selector、文本匹配、ARIA 标签），确保能精准找到交互目标。
- **模拟操作**: 执行 `click` (点击)、`type` (输入)、`scroll` (滚动) 等动作。

## 3. 核心功能 (Core Features)

### 3.1. 网页内容感知 (Web Awareness)

当用户切换标签页或页面内容更新时，插件会自动将简化的 Markdown 内容推送到 Pero 后端。Pero 可以借此：

- 理解当前网页的上下文。
- 总结长文章或查找关键信息。
- 辅助用户填写表单或进行搜索。

### 3.2. 远程控制 (Remote Control)

Pero 可以像操作“自动驾驶”一样控制浏览器：

- **导航**: 访问特定 URL、前进、后退、刷新。
- **交互**: 点击按钮、在输入框输入文本、滚动页面。
- **状态反馈**: 插件执行完指令后，会实时返回执行结果（成功/失败）及更新后的页面快照。

## 4. 后端服务集成 (Backend Integration)

后端通过 `backend/services/interaction/browser_bridge_service.py` 管理所有插件连接。

- **指令发送**: `send_command(command, target, text, url)`。
- **超时处理**: 指令执行拥有 30 秒的超时保护，确保系统不会因网页卡死而挂起。
- **清理机制**: 自动清理超过 30 秒无心跳的死连接。

## 5. 开发者指南 (Developer Guide)

### 5.1. 安装插件

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`。
2. 开启右上角的 **“开发者模式”**。
3. 点击 **“加载解压缩的扩展程序”**。
4. 选择项目根目录下的 `browser_extension` 文件夹。

### 5.2. 调试与日志

- **后台日志**: 在插件管理页面点击“Service Worker”查看。
- **内容脚本日志**: 在目标网页的控制台 (F12) 查看。
- **后端日志**: 查看 Pero 后端控制台中带有 `[BrowserBridge]` 前缀的输出。
