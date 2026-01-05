# PeroCore 技术架构文档 (Technical Architecture)

> **版本**: 3.1 (Security Hardening & NIT 2.0 Enhanced)
> **最后更新**: 2026-01-05
> **适用范围**: 核心开发者与架构师

## 1. 概览 (Overview)

PeroCore 是 Perofamily 项目的核心后端服务，定位为一个**高性能、具备自我反思能力与长时记忆的桌面伴侣 Agent 宿主环境**。

在 3.1 版本中，系统在保持 Rust Core 高性能计算内核的基础上，重点强化了 **NIT 协议的安全性与鲁棒性**。引入了会话级动态握手机制（Session-Scoped Dynamic Handshake）和参数自愈系统（Parameter Healing System），有效解决了 Agent 幻觉导致的恶意调用风险及参数类型错误问题。

**核心技术亮点**：
*   **Rust-Native Vector Engine**: 自研基于 `usearch` + `RwLock` 的轻量级、原子性 HNSW 向量索引，支持百万级记忆毫秒级召回。
*   **Spreading Activation Graph**: 基于 Rust 实现的扩散激活引擎，模拟人脑的“联想发散”过程。
*   **Secure NIT 2.0 Protocol**: 
    *   **动态握手**: 每次请求生成唯一的 4 位 Hex ID (`<nit-A1B2>`)，防止历史 Prompt 注入攻击。
    *   **宽容修复**: 智能参数类型转换引擎，自动修正 Agent 的“手滑”错误（如将数字传为字符串）。
    *   **异步编排**: 支持变量传递与非阻塞异步任务 (`async` keyword)。
*   **Atomic Persistence**: 关键数据（索引、图谱）采用 Rust 实现的原子化保存策略。

---

## 2. 系统分层架构 (Layered Architecture)

系统采用 **Python (业务/调度) + Rust (计算/安全)** 的混合架构：

### 2.1 接口层 (Interface Layer)
*   **REST API**: `FastAPI` 提供对话、记忆查询、状态管理的标准接口。
*   **WebSocket**: 
    *   `/ws/voice`: 音频流实时处理通道。
    *   `/ws/browser`: 浏览器操作指令通道。

### 2.2 核心服务层 (Python Services Layer)
负责业务流程编排与状态管理：
*   **Agent Service**: 核心控制器。负责 Prompt 构建、LLM 交互、NIT 脚本分发与**安全握手 ID 生成**。
*   **NIT Dispatcher**: 协议分发器。集成 `NITSecurityManager` 进行 ID 校验，解析并执行 NIT 2.0 脚本。
*   **Memory Service**: 记忆中枢。协调 SQLModel (元数据) 与 VectorStore (语义索引) 的读写。
*   **Vector Store Service**: Python 侧的向量服务封装，负责加载 `pero_rust_core`。

### 2.3 高性能计算层 (Rust Core Layer)
位于 `backend/rust_core`，通过 `maturin` 编译为 Python 扩展模块 (`pero_rust_core`)：
*   **VectorIndex**: 封装 `usearch`，提供线程安全的 HNSW 索引，支持原子写。
*   **SpreadingActivationEngine**: 内存图计算引擎，处理记忆节点的能量扩散算法。
*   **TextCleaner**: 基于 Rust `regex` 的高性能文本清洗器。

### 2.4 数据基础设施层 (Data Infrastructure)
*   **SQLite**: 存储结构化数据 (Memory, ConversationLog, Relation)。
*   **RustDB (Local File System)**: 
    *   `*.index`: 二进制向量索引文件。
    *   `*.json`: 标签映射表与配置。

---

## 3. NIT 2.0 协议与安全机制 (NIT Protocol & Security)

### 3.1 协议格式 (Script Format)
NIT 2.0 是一种专为 Agent 设计的嵌入式 DSL，支持变量、函数调用与异步任务。

```nit
<nit-A1B2>  <!-- 动态生成的安全标签 -->
# 1. 同步调用与变量赋值
$user_data = search_memory(query="用户的喜好")

# 2. 参数引用
$summary = llm_refine(context=$user_data, instruction="总结要点")

# 3. 异步非阻塞调用 (后台执行，不阻塞对话流)
async save_to_long_term_memory(content=$summary)

# 4. 浏览器操作 (连续指令)
browse_open(url="https://example.com")
browse_click(selector="#login-btn")
</nit-A1B2>
```

### 3.2 安全握手机制 (Security Handshake)
为了防止 Prompt Injection 攻击或模型幻觉导致的错误调用，NIT 引入了**请求级动态握手**：

1.  **生成 ID**: `AgentService` 在每轮对话开始时，通过 `NITSecurityManager.generate_random_id()` 生成一个 4 位 Hex ID (e.g., "A1B2")。
2.  **Prompt 注入**: `SystemPromptPreprocessor` 将此 ID 注入到 System Prompt 中，要求模型必须使用 `<nit-A1B2>` 包裹脚本。
3.  **校验拦截**: `NITDispatcher` 解析标签时，验证后缀 ID 是否与当前会话 ID 匹配。
    *   **匹配**: 执行脚本。
    *   **不匹配**: 拦截执行，返回安全警告。
    *   **无后缀**: (Legacy Mode) 记录警告但允许执行（兼容旧版 Prompt）。

### 3.3 参数宽容修复 (Forgiving Parameter Healing)
针对 LLM 常犯的参数类型错误，`NITBridge` 实现了智能修复逻辑：

*   **String -> Number**: 自动将 "5", "3.14" 转换为 `int` 或 `float`。
*   **Fuzzy Boolean**: 将 "yes", "true", "on", "1" 统一转换为 `True`。
*   **JSON Repair**: 尝试修复损坏的 JSON 字符串（如单引号替换）。

---

## 4. 核心模块详解 (Core Modules)

### 4.1 Rust Core (高性能内核)
*   **VectorIndex**: 使用 `Arc<RwLock<Index>>` 保证并发安全，实现“写入临时文件 -> 原子重命名”落盘策略。
*   **Spreading Activation**: 在内存中构建高频访问的记忆关联子图，模拟神经元能量扩散，挖掘隐性关联。

### 4.2 Memory System (双模态记忆)
| 组件 | 技术栈 | 职责 |
| :--- | :--- | :--- |
| **Semantic Cortex** | **Rust VectorIndex** | 负责“模糊联想”。存储 Embedding，提供 Top-K 搜索。 |
| **Episodic Store** | **SQLite** | 负责“精准回忆”。存储完整文本、时间戳与元数据。 |
| **Associative Net** | **Rust Graph** | 负责“逻辑推理”。Rust 引擎加载热点子图进行实时计算。 |

---

## 5. 开发指南 (Development)

### 5.1 Rust Core 编译
```bash
cd backend/rust_core
maturin develop --release
```

### 5.2 目录结构
```
PeroCore/
├── backend/
│   ├── nit_core/           # NIT 协议核心
│   │   ├── security.py     # 安全握手管理器
│   │   ├── dispatcher.py   # 协议分发与校验
│   │   ├── bridge.py       # MCP 桥接与参数修复
│   │   └── ...
│   ├── rust_core/          # Rust 源码 (lib.rs)
│   ├── services/           # 业务服务
│   └── ...
```

---

## 6. 交互与扩展子系统 (Interaction & Extension Subsystems)

### 6.1 前端交互架构 (Frontend Interaction)
PeroCore 通过 WebSocket 与前端（Electron/Web）保持实时双向通信：

*   **Browser Bridge** (`/ws/browser`): 
    *   **协议**: JSON-RPC 风格。
    *   **功能**: 接收 NIT 2.0 的 `browser_*` 指令，执行打开网页、点击、滚动、DOM 提取等操作。
*   **Voice Stream** (`/ws/voice`): 
    *   **协议**: 二进制/JSON 混合流。
    *   **功能**: 实时传输麦克风音频数据（Blob），服务端进行 VAD（语音活动检测）与 STT（语音转文字），并下发 TTS 音频流与状态更新（thinking/speaking/idle）。

### 6.2 语音合成流水线 (TTS Pipeline)
语音服务 (`TTSService`) 实现了多引擎切换与情感化后处理：

*   **多引擎支持**:
    *   **Edge TTS**: 默认免费引擎，低延迟，支持 `zh-CN-XiaoyiNeural` 等高质量语音。
    *   **OpenAI Compatible**: 兼容 SiliconFlow/OpenAI 接口，支持更高质量的模型（如 `fish-speech` 等）。
*   **情感化后处理 (Cute Mode)**:
    *   通过 `Parselmouth` (Praat) 对生成的音频进行共振峰（Formant）调整，提升音色的“可爱度”与亲和力，使其更符合“电子女儿”的人设。
*   **生命周期管理**: 自动清理临时音频文件，防止磁盘占用无限增长。

### 6.3 社交媒体集成 (Social Integration)
社交服务 (`SocialService`) 赋予了 Pero 主动社交的能力：

*   **主动思考循环 (Random Thought Loop)**:
    *   后台驻留 `_random_thought_worker` 协程，每隔 30~120 分钟随机唤醒。
    *   **环境感知**: 检查当前时间（避开深夜 00:00-08:00）与最近会话状态。
    *   **决策模型**: 调用 LLM 进行“内心独白”决策，判断是否向用户发起闲聊（如“PASS”或生成内容）。
*   **每日总结 (Daily Summary)**:
    *   每日自动回顾前一天的对话记录，生成摘要并存入长期记忆，用于增强跨日连续性体验。
*   **统一消息适配 (OneBot 11)**:
    *   通过 WebSocket (`/api/social/ws`) 连接 NapCat/OneBot 适配器，实现对 QQ/Telegram 等平台的统一收发支持。
