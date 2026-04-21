# 项目简介 (Introduction)

> **"Technology should not be cold. We build memories, not just databases."**

欢迎来到 PeroCore 的世界。

PeroCore 是 **“萌动链接：PeroperoChat”** 应用的核心引擎，也是一个永久开源免费，以社区共创的形式驱动的项目。
我们没有将 AI 当成一个冰冷的工具，而是尝试赋予 AI **“温度”** 与 **“灵魂”**。PeroCore 的诞生源于我们对“伙伴”最朴素的渴望：一个能记住你的偏好、理解你的情绪、甚至能主动关怀你的伙伴。

## 核心愿景 (Vision)

- **从“搜索”到“联想”**：基于自研的图扩散算子，PeroCore 能够像人脑一样实现逻辑联想，而非死板的向量检索。
- **从“被动”到“主动”**：通过 AuraVision 视觉引擎，它能感知你的桌面状态，在你需要时递上一句鼓励或安慰。
- **从“工具”到“羁绊”**：通过 NIT 协议，它在与你的互动中不断进化，学习如何成为更懂你的那个“人”。

## 技术架构 (Architecture)

PeroCore 采用现代化的 **Electron + Python** 架构。通过 内嵌于后端的 Gateway Hub 实现多端同步，并使用 Rust 搭建了核心的高性能计算层。

### 前端 (Frontend / Electron)

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white) ![Vue.js](https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vue.js&logoColor=4FC08D) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white) ![Element Plus](https://img.shields.io/badge/Element%20Plus-409EFF?style=for-the-badge&logo=element-plus&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) ![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)

- **职责**: 构建 Pero 的“躯壳”。负责极致的 UI 渲染、流畅的窗口管理以及对后端进程的精准生命周期控制。

### 后端 (Backend / Python)

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white) ![SQLModel](https://img.shields.io/badge/SQLModel-000000?style=for-the-badge&logo=postgresql&logoColor=white)

- **职责**: Pero 的“思维中枢”。承载 MDP 提示词工程、记忆检索逻辑、视觉分析意图以及复杂的 NIT 工具调度。

### 底层核心 (Low-level Core / Rust)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) ![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)

- **Rust Core**: 提供毫秒级响应的图扩散记忆算子，通过 SIMD 加速让“联想”瞬间发生。
- **NIT Runtime**: 为 AI 打造的指令解释器，让 Agent 调用工具像呼吸一样自然。
- **Terminal Auditor**: 安全沙箱，保护系统安全的同时赋予 AI 操作终端的能力。

### 通信机制 (Communication)

![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socket.io&logoColor=white)

- **Gateway Hub**: 内嵌于 Python 后端的 WebSocket 消息路由器，负责全双工流量分发与鉴权，它是连接 Pero 与用户各端设备的“神经纤维”。
- **协议**: 基于 Protobuf 的深度定制协议栈，支持状态实时同步与指令下发。
