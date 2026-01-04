# Browser Bridge 技术设计文档

本文档详细描述了 PeroCore 中 Browser Bridge (浏览器桥接器) 的设计与实现方案。该功能旨在让 AI Agent (Pero) 能够实时观察并控制用户的浏览器（Edge/Chrome），实现诸如“登录网站并发评论”等高级自动化任务。

## 1. 架构概述

Browser Bridge 采用 **WebSocket 双向通信** 架构，包含三个核心组件：

1.  **Pero Backend (Server)**:
    -   基于 FastAPI 提供 WebSocket Endpoint (`/ws/browser`).
    -   维护 `BrowserBridgeService`，负责管理连接、发送指令、接收页面状态。
    -   提供 Tool 接口 (`browser_click`, `browser_type`, `browser_open_url`) 给 Agent 调用。

2.  **Browser Extension (Client)**:
    -   安装在用户浏览器（Chrome/Edge）中的扩展程序。
    -   **Background Script**: 维持与 Pero Backend 的 WebSocket 长连接。
    -   **Content Script**: 注入到每个网页中，负责 DOM 操作（点击、输入）和页面内容提取（HTML -> Markdown）。

3.  **Agent (LLM)**:
    -   通过调用工具发送指令。
    -   通过 Context 实时获取当前页面内容的 Markdown 摘要。

## 2. 通信协议

### 2.1 消息格式 (JSON)

所有消息均包含 `type` 和 `data` 字段。

#### Server -> Client (指令)
```json
{
  "type": "command",
  "data": {
    "requestId": "req-123456",
    "command": "click", // 或 "type", "open_url"
    "target": "登录按钮", // 元素描述或选择器
    "text": "", // type 命令需要的文本
    "url": "", // open_url 命令需要的网址
    "wait_for_page_info": true // 是否等待页面刷新/加载完成
  }
}
```

#### Client -> Server (反馈)
**1. 页面信息更新 (Page Info Update)**
```json
{
  "type": "pageInfoUpdate",
  "data": {
    "markdown": "# Bilibili 首页...",
    "url": "https://www.bilibili.com/",
    "title": "哔哩哔哩"
  }
}
```

**2. 命令执行结果 (Command Result)**
```json
{
  "type": "command_result",
  "data": {
    "requestId": "req-123456",
    "status": "success", // 或 "error"
    "message": "点击成功",
    "error": "未找到元素" // 仅在 status=error 时存在
  }
}
```

## 3. 核心组件实现

### 3.1 BrowserBridgeService (Python)
-   **单例模式**：全局只有一个实例，管理所有连接。
-   **连接池**：`connected_clients: List[WebSocket]`。
-   **命令队列**：使用 `asyncio.Future` 来实现同步等待。当 Agent 调用工具时，Service 发出 WebSocket 消息，并 `await` 直到收到 Client 的 `command_result` 和随后的 `pageInfoUpdate`。

### 3.2 Browser Extension (JS)
-   **Manifest V3**: 符合最新的浏览器扩展标准。
-   **Markdown 提取**: 使用简单的 DOM 遍历算法，优先提取 `h1-h6`, `p`, `button`, `input`, `a` 标签，过滤 `script`, `style`。
-   **元素定位**: 使用简单的文本匹配或 CSS 选择器来定位 Agent 描述的元素（例如 Agent 说“点击登录”，插件会在页面寻找包含“登录”文本的按钮）。

## 4. 安全性考量
-   WebSocket 仅监听 `localhost`，防止外部恶意控制。
-   扩展程序权限限制在必要的 `activeTab` 和 `scripting`。

## 5. 开发计划
1.  创建 `services/browser_bridge_service.py`。
2.  修改 `main.py` 挂载 WebSocket 路由。
3.  开发浏览器扩展的基础代码。
4.  集成到 `agent_service.py` 和 `tools`。
