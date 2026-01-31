# 项目简介 (Introduction)

PeroCore 是一个运行在您桌面上的智能 AI 伴侣核心。它不仅仅是一个聊天机器人，更是一个深度集成到操作系统、拥有长期记忆与视觉感知能力的智能体。

## 技术架构 (Architecture)

PeroCore 采用现代化的 **Electron + Python** 双进程架构，结合了 Web 前端的灵活性与 Python AI 生态的强大能力。

### 前端 (Frontend / Electron)

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white) ![Vue.js](https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vue.js&logoColor=4FC08D) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white) ![Element Plus](https://img.shields.io/badge/Element%20Plus-409EFF?style=for-the-badge&logo=element-plus&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) ![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)

- **职责**: 负责用户界面渲染、窗口管理、系统托盘以及 Python 后端进程的生命周期管理。

### 后端 (Backend / Python)

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white) ![SQLModel](https://img.shields.io/badge/SQLModel-000000?style=for-the-badge&logo=postgresql&logoColor=white)

- **职责**: 处理自然语言理解、记忆检索、视觉分析、NIT 工具执行以及所有复杂的 AI 逻辑。

### 底层核心 (Low-level Core / Rust)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) ![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)

- **Rust Core (pero_memory_core)**: 高性能意图-记忆扩散引擎 (SIMD 加速)。
- **NIT Runtime**: 高性能解释器扩展 (PyO3 绑定)。
- **Terminal Auditor**: 终端指令审计模块 (Wasm 沙箱)。

### 通信机制 (Communication)
- **Gateway**: 系统内置一个 GO 语言编写的高性能网关，负责前后端之间的流量分发、鉴权与长连接管理。
- **协议**: 采用 HTTP/2 与 WebSocket 进行实时全双工通信。

## 核心系统 (Core Systems)

PeroCore 由多个相互协作的智能子系统构成：

### 🧠 KDN 记忆系统 (Knowledge Diffusion Network)
不同于传统的 RAG（检索增强生成），KDN 实现了**扩散激活 (Spreading Activation)** 算法。它模拟人脑的联想机制，能够根据当前上下文“激活”相关的记忆节点，从而找回跨越时间与话题的深层逻辑关联，而非仅仅依赖关键词匹配。

### 👁️ AuraVision 视觉意图
隐私优先的视觉感知系统。AuraVision 能够实时分析屏幕内容，但在输入模型前会将图像降采样至极低分辨率（如 64x64），仅提取用户状态（如“正在编程”、“观看视频”、“空闲”）而不读取具体的文本内容，确保您的隐私安全。

### 🛠️ NIT 协议 (Non-invasive Integration Tools)
专为 AI 设计的非侵入式工具集成协议。NIT 允许 PeroCore 通过标准化的接口调用外部工具与脚本，支持复杂的流水线操作、多步依赖执行与错误自愈，赋予 AI 真正的“行动力”。

### 🎭 MDP 系统 (Model-Driven Prompting)
基于模型驱动的提示工程架构。MDP 将复杂的 Prompt 拆解为模块化的组件（如角色设定、能力描述、上下文规则），并根据当前的交互场景动态组装。这使得 PeroCore 能够流畅地在不同角色（如“工作模式”与“社交模式”）之间切换。

### 💬 社交模式 (Social Mode)
通过集成 **NapCat** (基于 OneBot 11 协议)，PeroCore 能够连接到您的社交账号（如 QQ），在群聊中以独立的身份参与互动，实现真正的“伴侣”体验。
