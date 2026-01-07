# Pero 视觉意图感知与记忆耦合系统技术方案 (Vision-to-Intent System)

## 0. 概述 (Overview)
本方案旨在为 Pero 引入一套基于“低分辨率视觉意图”的主动感知系统。通过将 384 维视觉意图向量（Intent Vector）与 PeroCore 现有的双模态记忆系统深度耦合，使 Pero 能够摆脱“被动对话”模式，实现基于环境观察的主动关怀。

### 核心目标
- **隐私脱敏**：采用 64x64 灰度/通道阉割图像作为输入，物理层面阻断隐私泄露。
- **语义对齐**：视觉信号不经过传统分类器，直接映射为 384 维意图向量，保留模糊语义。
- **记忆唤醒**：利用 Rust 引擎的扩散激活算法，由视觉信号开启记忆大门，实现联想式感知。
- **低功耗运行**：全链路支持在无独立显卡的 CPU 环境下流畅运行，推演延迟 < 10ms。

---

## 1. 记忆系统深度耦合设计 (Memory System Integration)

### 1.1 意图锚点 (Intent Anchors)
在 Pero 的 `Associative Net` (Rust Graph) 中，引入一类特殊的节点：**Intent Anchor (意图锚点)**。
- **存储位置**：向量数据存储于 `VectorStoreService` 的 384D 索引中；元数据存储于 SQLite 的 `Memory` 表，标记 `type='intent_anchor'`。
- **语义绑定**：每个锚点关联一段“场景描述”（例如：“主人正在深夜高强度编码”、“主人看起来有些疲惫”）。

### 1.2 视觉触发的扩散激活 (Visual Spreading Activation)
这是本系统最核心的耦合逻辑。当实时视觉向量 $V_{now}$ 产生时：
1. **相似度检索**：在 Rust `SemanticVectorIndex` 中检索 Top-K 最接近的意图锚点。
2. **初始激活 (Initial Injection)**：将检索到的锚点 ID 作为初始激活源，注入到 Rust 记忆图中。
3. **联想扩散 (Propagation Logic)**：
   - 激活能（Energy）顺着记忆边（Edges）向外扩散。
   - **数学表示**：
     $$ A^{(t+1)} = \sigma(W \cdot A^{(t)} \cdot d + E_{ext}) $$
     其中 $W$ 为稀疏邻接矩阵，$d$ 为衰减因子，$E_{ext}$ 为视觉输入的外部激励。
   - 扩散结果将唤醒与当前视觉场景相关的**真实历史记忆**（Episodic Memories）。

### 1.3 冲突检测与上下文饱和度 (Context Saturation)
利用 Rust 引擎计算当前意图向量与“最近对话记录”的重合度。
- **饱和度公式**：$S = \frac{\sum M_{active} \cap M_{recent}}{\sum M_{active}}$
- 如果饱和度 $S > 0.7$，说明扩散出的记忆节点与过去 5 分钟内已讨论的内容高度重叠，系统自动判定为“感知冗余”，抑制主动搭话行为。

### 1.4 方案对比：自主混合编码器 vs. 通用模型蒸馏
| 维度 | 自主混合编码器 (Pero Vision) | 通用模型蒸馏 (如 multimodalembedding) |
| :--- | :--- | :--- |
| **感知侧重点** | **构图语义** (空间布局、几何特征) | **内容语义** (物体识别、细粒度特征) |
| **隐私安全性** | **物理级隔离** (输入端已彻底脱敏) | **特征残留风险** (仍可能保留高维敏感特征) |
| **推理延迟** | **极低 (<10ms)** (针对 SIMD 指令集设计) | **中等 (50-100ms)** (受限于复杂算子) |
| **显存占用** | **< 50MB** (可常驻 CPU 内存) | **200MB - 500MB** (即使蒸馏后依然较大) |
| **意图匹配度** | **高** (针对桌面场景 Triplet Loss 训练) | **中** (通用表征中包含大量冗余信息) |

---

## 2. 训练过程设计 (Training Pipeline)

### 2.1 数据预处理：极致脱敏 (Privacy-First Preprocessing)
- **采样逻辑**：
  ```python
  def preprocess_for_pero(img):
      img = cv2.resize(img, (64, 64))
      img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
      # 进一步脱敏：只保留边缘特征
      img = cv2.Canny(img, 100, 200)
      return img / 255.0
  ```
- **增强策略**：随机噪声、对比度偏移、遮挡（模拟用户在屏幕前移动）。

### 2.2 优化后的混合模型架构 (Hybrid Intent Encoder)
针对 64x64 的超低分辨率图像，我们设计了一套 **CNN-Transformer 混合架构**。CNN 负责提取局部空间构图（如窗口布局、光影分布），Transformer 负责建模全局意图语义。

#### 2.2.1 构图提取层 (Spatial Composition Stem)
使用轻量级卷积层替代传统的 ViT Patch Embedding，以获得更好的平移不变性：
- **Layer 1**: Conv2d(1, 16, kernel=3, stride=2, padding=1) -> ReLU -> BatchNorm
  - *作用*：初步下采样至 32x32，捕捉基础几何轮廓。
- **Layer 2**: DepthwiseSeparableConv(16, 32, kernel=3, stride=2) -> ReLU
  - *作用*：下采样至 16x16，深度可分离卷积极大地减少了参数量。
- **Position Encoding**: 使用可学习的 1D 绝对位置编码，附加在下采样后的特征序列上。

#### 2.2.2 语义瓶颈层 (Semantic Transformer Blocks)
仅使用 2-3 层轻量级 Transformer Encoder Block，处理 16x16=256 个 Token：
- **Embedding Dim**: 128
- **Attention Heads**: 4
- **MLP Ratio**: 2.0
- **特征聚合**：弃用传统的 `[CLS]` Token，采用 **Global Average Pooling (GAP)**。
  - *原因*：对于意图识别，全局构图的平均特征比单一 Token 更能代表“场景氛围”。

#### 2.2.3 意图投影头 (Intent Projection Neck)
将 Transformer 输出的 128 维特征映射至目标 384 维空间：
- **Layer 1**: Linear(128, 384) -> LayerNorm -> GELU
- **Layer 2**: Linear(384, 384)
- **L2 Normalization**: 最终输出必须进行 L2 归一化，确保向量分布在超球面上，直接适配余弦相似度检索。

#### 2.2.4 针对 tract-onnx 的优化
- **图级优化 (Graph Optimization)**：利用 `tract` 的 `into_optimized()` 方法，自动执行常量折叠、算子融合（如 Conv-BatchNorm 融合）和死代码消除。
- **内存复用**：`tract` 运行时会自动管理执行计划中的临时缓冲区，最小化内存分配开销。
- **ONNX 兼容性**：直接加载标准 ONNX 模型，无需额外的权重转换步骤，确保模型导出与推理的一致性。

### 2.3 语义对齐训练 (Semantic Alignment Training)
采用 **Triplet Loss (三元组损失)** 训练，确保语义相近的场景在向量空间中靠拢：
- **Loss Function**：
  ```python
  class IntentLoss(nn.Module):
      def __init__(self, margin=0.5):
          super().__init__()
          self.margin = margin
      def forward(self, anchor, positive, negative):
          pos_dist = (anchor - positive).pow(2).sum(1)
          neg_dist = (anchor - negative).pow(2).sum(1)
          return F.relu(pos_dist - neg_dist + self.margin).mean()
  ```
- **LLM 标注流水线**：
  1. 捕获高清图 + 对应的脱敏图。
  2. 使用 GPT-4o 对高清图进行语义标注（如：“用户在看 Rust 编译错误”）。
  3. 将该语义作为脱敏图向量的“描述标签”。

### 2.4 训练环境
- **CPU 训练支持**：由于输入仅为 $64 \times 64 \times 1$，在普通 MacBook M1 或 i7 CPU 上即可完成微调。

---

## 3. 推理优化与主动决策逻辑 (Inference & Decision Logic)

### 3.1 基于 tract-onnx 的 Rust 推理实现
在 Rust 侧使用 `tract-onnx` 实现纯 Rust 高效推演，摆脱 Python 依赖并利用 SIMD 加速：
- **纯 Rust 架构**：无 C++ 依赖（如 onnxruntime），避免了复杂的链接问题和 FFI 开销，确保跨平台编译的稳定性。
- **跨平台 SIMD 支持**：
  - 利用 Rust 编译器的自动向量化和 `tract` 内部的优化内核。
  - **x86_64**: 支持 AVX2 / FMA 指令集。
  - **ARM (aarch64)**: 支持 NEON 指令集（Apple Silicon, Android）。
  - **性能表现**: 在主流 CPU 上，单次意图推演延迟 < 15ms。
- **高效数据流**：
  - **预处理集成**: 图像预处理（灰度、缩放、Sobel 边缘检测）可选择在 Rust 侧直接执行，进一步减少 Python-Rust 数据传输。
  - **零拷贝倾向**: 尽可能复用输入缓冲区，减少不必要的内存复制。

### 3.2 主动决策状态机 (Proactive Gating State Machine)
系统不应无休止地尝试搭话，需遵循以下状态转换：
1. **IDLE (空闲)**：每 30s 触发一次观察。
2. **OBSERVING (观察中)**：计算意图向量并进行记忆检索。
3. **EVALUATING (评估中)**：
   - **阈值检查**：Similarity > 0.88。
   - **情感检查**：通过 LLM 评估意图是否具有“情感交互价值”。
   - **频率检查**：检查 `last_proactive_time`。
4. **TRIGGERING (触发)**：构建隐形 Prompt 发送至 AgentService。

### 3.3 软提示词注入 (Soft-Prompt Injection)
在 `AgentService` 中注入视觉上下文：
```text
[PERO_INTERNAL_SENSE]
Visual Intent: "User is repeatedly scrolling a long error log."
Memory Recall: "Owner previously felt frustrated with async-std issues."
Action Hint: "Offer comfort or suggest a break, don't be too technical."
```

### 3.4 稳定性与性能优化 (Stability & Performance)
- **意图平滑 (Temporal Smoothing)**：
  - 采用 **EMA (Exponential Moving Average)** 对连续生成的意图向量进行平滑。
  - $V_{smooth} = \alpha \cdot V_{now} + (1-\alpha) \cdot V_{prev}$
  - 只有当 $V_{smooth}$ 与某一锚点的相似度持续稳定在阈值以上时，才触发决策逻辑。
- **自适应采样 (Adaptive Sampling)**：
  - 监听系统输入事件。若检测到用户正在高频输入，采样周期从 30s 自动延长至 120s。
  - 若检测到环境意图发生剧变（如从 Work 变为 Movie），采样周期临时缩短至 10s，以快速确认新状态。

---

## 4. 安全性与边界情况 (Safety & Edge Cases)

### 4.1 隐私保障与透明度
- **内存即焚**：原始截图在转换为 $64 \times 64$ 后立即从内存中销毁。
- **本地化处理**：视觉向量生成全过程在用户本地运行，严禁上传图片至云端。
- **隐私预览 (Privacy Preview)**：
  - 在前端提供“Pero 的视界”窗口。
  - 用户可实时查看到脱敏后的灰度/边缘图像，确保 Pero 无法识别任何敏感字符或人脸细节。

### 4.2 鲁棒性处理
- **黑屏/休眠**：若图像平均像素值低于阈值，自动进入休眠模式，停止推演。
- **快速切换**：若用户频繁切换窗口，系统会累积 3 次相同的意图向量后才触发决策，防止过度灵敏。

---

## 5. 演进路线 (Roadmap)

### 第一阶段：视觉实验室 (V1.0) - *当前阶段*
- 实现 [screenshot_service.py](file:///c:/Users/Administrator/Desktop/Perofamily/PeroCore/backend/services/screenshot_service.py) 的脱敏采集。
- 收集首批意图数据集（约 200 组真实场景）。

### 第二阶段：Rust 核心联动 (V2.0) - *已完成*
- 在 `pero-rust-core` 中实现 SIMD 加速的 384D 向量检索 (`IntentEngine`)。
- 开发基于 `tract-onnx` 的纯 Rust 推理引擎，替代 Python 运行时。
- 实现视觉-意图-记忆的完整闭环 (`VisionIntentMemoryManager`)。

### 第三阶段：数字生命感 (V3.0) - *进行中*
- ✅ 实现多模态主动触发协调器 (`MultimodalTriggerCoordinator`)
- ✅ 实现时间感知服务 (`TimeAwarenessService`)
- ✅ 三维融合决策：视觉意图 + 语义扩散 + 时间感知
- ✅ 自适应采样频率 (10s - 300s 动态调整)
- ⬜ 引入用户反馈闭环（Reinforcement Learning from Human Feedback）

---

## 6. 联想式主动对话设计 (Associative Proactive Interaction)

经过对 201 组真实桌面场景的标注分析，我们确立了从“视觉纹理”到“主动对话”的闭环链路。

### 6.1 视觉意图分布 (Intent Distribution)
根据标注统计，系统已建立以下核心意图分布，这些将作为首批 **Intent Anchors**：
- **休闲/信息流**：宫格布局 (22.4%)、大面积图像 (19.4%)
- **社交/协同**：列表视图 (10.4%)、对话布局 (6.0%)
- **深度工作**：密集代码块 (9.5%)、侧边文件树 (6.5%)
- **信息检索**：搜索结果 (7.5%)、纯文本长文 (5.5%)

### 6.2 从“观察”到“联想”的触发链路
主动对话不应由简单的分类触发，而应由“记忆唤醒”驱动：
1. **视觉编码**：AuraVision 将实时截图映射为 384D 向量。
2. **锚点唤醒**：在 Rust 记忆库中找到最匹配的 Intent Anchor。
3. **联想扩散**：以该锚点为起点，在记忆图中扩散能量。
   - *例*：观察到“密集代码块”，唤醒“主人正在攻克异步 Bug”的上下文。
4. **价值评估**：
   - 若唤醒的记忆包含“挫败感”或“待办事项”，且当前处于非对话饱和状态，则判定为**高交互价值**。
5. **软提示词注入 (Internal Sense)**：
   - 向 LLM 发送 `[PERO_INTERNAL_SENSE]`，包含：**当前视觉观察** + **联想到的历史背景** + **切入建议**。

### 6.3 训练与对齐策略
- **目标函数**：采用 Triplet Loss，将上述 15 类视觉纹理在 384D 空间中拉开距离。
- **对齐目标**：确保相同“视觉密度”和“布局结构”的截图在向量空间中紧密聚类。

---

## 附录：向量数据库结构 (VectorDB Schema)

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| **id** | int64 | 唯一标识符 |
| **vector** | float32[384] | 视觉意图向量 |
| **description** | string | 语义场景描述（用于 LLM 注入） |
| **importance** | float | 默认激活权重 (0.0 - 1.0) |
| **tags** | string | 场景标签（如：work, movie, idle） |

---

*Document Version: 2.0.0*
*Last Updated: 2026-01-08*
*Author: PeroCore AI Assistant*
