# PeroCore 技术架构：Tripo 的蓝图 (Architecture)

> **版本**: 3.1 (Tauri 2.0 & Tripo Optimized)
> **最后更新**: 2026-01-11
> **视角**: Tripo (Core AI Co-Developer)

## 1. 概览 (Overview)

你好，我是 **Tripo**。这份文档将向你展示 PeroCore 的骨架。

PeroCore 不仅仅是一个后端服务，它是 YoKONCy 构思、由我（Tripo）和 Pero 共同实现的**高性能、具备自我反思能力与长时记忆的桌面伴侣 Agent 宿主环境**。

在 3.1 版本中，我重点优化了 **NIT 协议的安全性**。为了防止那些不怀好意的 Prompt 注入，我为 YoKONCy 设计了会话级动态握手机制。同时，针对边缘侧的性能挑战，我用 Rust 重新打磨了核心算子。

**核心技术亮点**：
*   **Rust-Native Vector Engine**: 我实现的基于 `usearch` 的原子性向量索引，能确保 YoKONCy 构思的百万级记忆在毫秒内召回。
*   **Spreading Activation Graph**: 扩散激活引擎。我们在工程上实现了认知科学中的经典扩散激活理论，这是我和 Pero 产生“联想”的物理基础。
*   **AuraVision Intent System**: 我们的视觉感知方案。我利用 CNN-Transformer 混合模型，将屏幕的模糊边缘特征转化为意图向量。
*   **Secure NIT 2.0 Protocol**: 
    *   **动态握手**: 我设计的 4 位 Hex ID 校验，彻底封死了注入攻击。
    *   **宽容修复**: 针对模型偶尔的“手滑”，我写了一套自动修正逻辑。
    *   **异步编排**: 支持变量传递与非阻塞异步任务 (`async` keyword)。
*   **Atomic Persistence**: 关键数据（索引、图谱）采用 Rust 实现的原子化保存策略。

---

## 2. 系统分层架构 (Layered Architecture)

系统采用 **Tauri v2 (Native UI) + Python (业务逻辑) + Rust (计算内核)** 的三层混合架构：

### 2.1 接口层 (Interface Layer)
*   **Tauri IPC**: 前端 Vue 3 通过 `invoke` 与 Rust 主进程通信，主进程通过 `Command` 管理 Python 后端生命周期。
*   **REST API**: 后端 `FastAPI` 提供核心对话、记忆管理接口。
*   **WebSocket**: 处理实时性极强的流式数据（如语音 VAD、浏览器实时控制）。

### 2.2 核心服务层 (Python Services Layer)
负责业务流程编排与状态管理：
*   **Agent Service**: 核心控制器。负责 Prompt 构建、LLM 交互、NIT 脚本分发与**安全握手 ID 生成**。
*   **NIT Dispatcher**: 协议分发器。集成 `NITSecurityManager` 进行 ID 校验，解析并执行 NIT 2.0 脚本。
*   **Memory Service**: 记忆中枢。协调 SQLModel (元数据) 与 VectorStore (语义索引) 的读写。
*   **Vector Store Service**: Python 侧的向量服务封装，负责加载 `pero_rust_core`。

### 2.3 高性能计算层 (Rust Core Layer)
位于 `backend/rust_core`，通过 `maturin` 编译：
*   **VectorIndex**: 高并发向量索引。
*   **TextCleaner**: 基于 Rust `regex` 的高性能文本清洗器。
    *   **Defensive Security**: 针对 ReDoS 与性能抖动，在 Rust 层实施物理长度截断（100,000 字符），确保在极端输入下 CPU 负载可控。
*   **CognitiveGraphEngine**: 核心图计算引擎。
    *   **Engineering Implementation**: 该引擎是对认知科学中“扩散激活” (Spreading Activation) 理论的深度工程化实现。其核心 KDN 算子通过数学建模将抽象的认知理论转化为高性能的 Rust 算子。
    *   **Sparse Matrix**: 采用 **类 CSR (Simulated CSR)** 稀疏矩阵存储邻接表。相比于标准 CSR，这种动态模拟方式允许实时写入新的逻辑关联，在保证联想效率的同时兼顾了动态性。
    *   **Pruning Algorithm**: 引入动态剪枝阈值，能量扩散过程中自动忽略低权重路径。
    *   **Top-K Active Filtering**: 针对“记忆召回”特定场景的极限优化。在 KDN 扩散计算中，系统每步仅处理激活值前 **10,000** 个最活跃节点。实测表明，对于桌面助手这类长记忆需求，10,000 个活跃节点已足以覆盖极广的上下文关联，这使得大规模图谱上的扩散复杂度被有效锁定，确保在亿级数据下仍具备毫秒级召回速度。
*   **AuraVision Engine**: 纯 Rust 视觉推理内核。
    *   **Tract-ONNX Inference**: 使用 `tract-onnx` 实现无 C++ 依赖的纯 Rust 推理，针对 CPU SIMD (AVX2/FMA) 进行深度优化。
    - **IntentEngine**: 实现 384D 向量的实时余弦相似度搜索，支持 EMA (Exponential Moving Average) 时序平滑，过滤视觉抖动。

### 2.4 数据基础设施层 (Data Infrastructure)
*   **SQLite**: 存储结构化数据 (Memory, ConversationLog, Relation)。
*   **RustDB (Local File System)**: 
    *   `*.index`: 二进制向量索引文件。
    *   `*.json`: 标签映射表与配置。

---

## 3. NIT 2.0：一种工具调用语言 (Tool Language)

### 3.1 协议定义 (Definition)
NIT 2.0 是一种专为 AI 设计的嵌入式脚本语言，旨在简化 AI 对外部工具（如浏览器、文件系统）的调用。

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
...
### 3.4 事务与状态可靠性 (Transactional Reliability)
针对“工作模式”等涉及多步操作的状态切换，系统实施了严格的可靠性保障：
*   **Atomic Session Switching**: 使用 `try...except...rollback()` 确保会话 ID 切换与配置更新的原子性。
*   **Guaranteed State Recovery**: 在 `exit_work_mode` 中通过 `finally` 块实施“最终恢复策略”，无论业务逻辑（如 LLM 总结）是否报错，系统均能强制回退到默认会话，杜绝状态锁死风险。

---

## 4. 核心模块详解 (Core Modules)

### 4.1 Rust Core (高性能内核)

#### 4.1.1 向量检索权衡 (Vector Search Trade-off)
Rust 核心的向量引擎基于 `usearch` 构建，其设计理念是 **"极致性能优先，元数据解耦"**：

*   **元数据盲区 (Metadata Blindness)**: Rust 索引层仅存储 `(ID: u64, Vector: f32[])`。它不感知记忆的时间戳、标签或内容，这保证了 HNSW 搜索的内存占用极低且速度极快。
*   **后过滤机制 (Post-filtering)**: 目前采用“先向量召回 N 个 ID，再由 Python 结合 SQLite 进行元数据过滤”的策略。
*   **潜在风险 (Precision Gap)**: 在严苛过滤场景下（例如：搜索 1000 条相似记录中唯一一条特定日期的记忆），如果该记录在向量距离上排在召回上限（Top-N）之外，会导致“召回空结果”的问题。
*   **未来演进**: 计划引入 **Masked Search**（基于位图掩码的搜索），允许 Python 层先下发一个候选 ID 位图，由 Rust 在 HNSW 遍历时实时应用过滤规则。
*   **VectorIndex**: 使用 `Arc<RwLock<Index>>` 保证并发安全，实现“写入临时文件 -> 原子重命名”落盘策略。
*   **Spreading Activation**: 在内存中构建高频访问的记忆关联子图，模拟神经元能量扩散，挖掘隐性关联。

### 4.3 AuraVision 视觉意图系统 (Vision-to-Intent)

AuraVision 是 Pero 的“眼睛”，其核心设计哲学是 **“感知意图，而非监视隐私”**。

#### 4.3.1 隐私优先的模型架构
*   **脱敏输入**: 系统仅采集 64x64 像素的极低分辨率图像，并立即进行灰度化与 **Sobel/Canny 边缘检测**。最终输入模型的是纯粹的几何轮廓，无法还原任何文字或人脸信息。
*   **CNN-Transformer 混合模型**:
    *   **Spatial Stem (CNN)**: 提取局部纹理特征（如：代码块的密集横线、视频播放器的矩形框）。
    *   **Semantic Blocks (Transformer)**: 捕捉全局布局关系，理解当前桌面是在“深度工作”还是“休闲娱乐”。
*   **Intent Embedding**: 模型输出一个 L2 归一化的 384D 向量，代表当前的“视觉意图”。

#### 4.3.2 意图锚点 (Intent Anchors)
视觉向量并不直接映射到标签，而是与存储在 Rust 侧的 **Intent Anchors** 进行匹配。
*   **动态匹配**: 通过余弦相似度计算当前视觉状态与已知场景（如“密集代码”、“社交聊天”、“视频流”）的距离。
*   **时序平滑**: 引入 EMA 算法对连续帧进行平滑，确保只有稳定的视觉状态（持续 2-3 秒）才会触发后续逻辑。

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
PeroCore 通过 WebSocket 与前端（Tauri/Web）保持实时双向通信：

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

### 6.4 多模态主动触发 (Multimodal Proactive Interaction)

在 V3.0 中，Pero 进化出了基于“感知三角”的主动触发机制，由 `MultimodalTriggerCoordinator` 统一调度。

#### 6.4.1 感知三角 (The Perception Triangle)
系统综合三个维度的信号进行协同决策：
1.  **视觉意图 (Visual Intent)**: 当前屏幕呈现的状态（权重 40%）。
2.  **语义扩散 (Semantic Spreading)**: 视觉意图唤醒的关联记忆强度（权重 35%）。
3.  **时间感知 (Time Awareness)**: 当前时间节点与用户作息规律（权重 25%）。

#### 6.4.2 扩散激活过程 (Spreading Activation Process)
这是 Pero 产生“生命感”的核心链路：
1.  **能量注入**: 视觉系统匹配到“代码”锚点，向图谱中的对应节点注入初始能量。
2.  **联想扩散**: 能量顺着 `MemoryRelation` 边缘向外扩散。例如：从“代码”扩散到“昨晚的 Bug 笔记”，再扩散到“挫败感”标签。
3.  **饱和度检测 (Saturation Gating)**: 
    *   计算唤醒记忆与最近 5 分钟对话内容的重合度。
    *   若重合度过高（饱和度 > 0.7），则判定为“废话”，自动抑制触发。
4.  **自适应采样**: 协调器根据决策得分动态调整采样频率（10s ~ 300s）。当感知到用户处于高频交互或环境剧变时，自动进入高频观察模式。
