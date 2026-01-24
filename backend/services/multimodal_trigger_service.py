"""
多模态主动触发协调器 (Multimodal Trigger Coordinator)

第三阶段核心组件：统一调度三个感知维度
1. 视觉意图 (Visual Intent) - 来自 AuraVisionService
2. 语义扩散 (Semantic Spreading) - 来自 CognitiveGraphEngine
3. 时间感知 (Time Awareness) - 来自 TimeAwarenessService

设计原则:
- 三维融合：视觉、语义、时间形成"感知三角"
- 自适应采样：根据用户状态动态调整采样频率
- 协同决策：单一维度高分可触发，多维度共振时增强

版本: 1.0.0
"""

import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from enum import Enum
from loguru import logger

from services.time_awareness_service import (
    TimeAwarenessService, TimeContext, TimePhase, TimeEvent,
    time_awareness_service
)


class TriggerMode(Enum):
    """触发模式"""
    SILENT = "silent"           # 沉默 - 只记录不触发
    HINT = "hint"               # 暗示 - UI 微动作
    INTERNAL = "internal"       # 内化 - 存入感知日志,等用户说话时带入
    PROACTIVE = "proactive"     # 主动 - 直接发起对话


@dataclass
class ModalityScore:
    """单模态得分"""
    name: str
    score: float               # 0-1
    confidence: float          # 置信度 0-1
    description: str           # 描述 (用于 LLM 注入)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MultimodalDecision:
    """多模态融合决策"""
    should_trigger: bool
    mode: TriggerMode
    final_score: float         # 综合得分
    
    # 各模态分数
    visual_score: Optional[ModalityScore] = None
    semantic_score: Optional[ModalityScore] = None
    time_score: Optional[ModalityScore] = None
    
    # 决策理由
    reasoning: str = ""
    
    # 注入 LLM 的完整上下文
    context_for_llm: str = ""
    
    # 唤醒的记忆 ID 列表 (来自语义扩散)
    activated_memory_ids: List[int] = field(default_factory=list)


class MultimodalTriggerCoordinator:
    """
    多模态主动触发协调器
    
    核心职责:
    1. 接收三个模态的感知信号
    2. 融合计算最终触发决策
    3. 生成注入 LLM 的上下文
    4. 管理采样频率
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        # === 配置参数 ===
        # 触发阈值
        self.visual_threshold = 0.85
        self.semantic_threshold = 0.6
        self.time_threshold = 0.7
        self.combined_threshold = 0.75  # 综合得分阈值
        
        # 融合权重
        self.weights = {
            "visual": 0.4,
            "semantic": 0.35,
            "time": 0.25
        }
        
        # 采样频率配置 (秒)
        self.sample_interval_default = 30
        self.sample_interval_min = 10
        self.sample_interval_max = 300
        self.current_sample_interval = self.sample_interval_default
        
        # 状态追踪
        self.last_trigger_time: Optional[datetime] = None
        self.trigger_cooldown = timedelta(minutes=5)  # 触发后冷却时间
        
        self.session_start_time = datetime.now()
        self.consecutive_low_scores = 0  # 连续低分次数
        self.consecutive_high_similarity = 0  # 连续高相似度次数 (用于防抖)
        
        # 感知日志 (Internal Sense 模式使用)
        self.perception_log: List[Dict[str, Any]] = []
        self.max_perception_log_size = 10
        
        # 时间感知服务
        self.time_service = time_awareness_service
        
        self._initialized = True
        logger.info("[MultimodalCoordinator] 协调器初始化完成")
    
    def update_session_start(self):
        """更新会话开始时间 (用户开始活跃时调用)"""
        self.session_start_time = datetime.now()
    
    def compute_decision(
        self,
        visual_result: Optional[Dict[str, Any]] = None,
        semantic_memories: Optional[List[int]] = None,
        semantic_scores: Optional[Dict[int, float]] = None,
        force_time_check: bool = True
    ) -> MultimodalDecision:
        """
        计算多模态融合决策
        
        Args:
            visual_result: 来自 VisionIntentMemoryManager.process_visual_input 的结果
            semantic_memories: 语义扩散唤醒的记忆 ID 列表
            semantic_scores: 记忆 ID -> 激活分数的映射
            force_time_check: 是否强制进行时间检查
        
        Returns:
            MultimodalDecision: 融合后的决策
        """
        current_time = datetime.now()
        
        # === 1. 时间感知 ===
        time_context = self.time_service.get_time_context(
            session_start=self.session_start_time
        )
        time_score = self._compute_time_score(time_context)
        
        # 检查是否应该抑制 (深夜等)
        should_suppress, suppress_reason = self.time_service.should_suppress_proactive(
            time_context.phase
        )
        
        # === 2. 视觉意图 ===
        visual_score = self._compute_visual_score(visual_result)
        
        # === 3. 语义扩散 ===
        semantic_score = self._compute_semantic_score(semantic_memories, semantic_scores)
        
        # === 4. 融合计算 ===
        final_score = self._fuse_scores(visual_score, semantic_score, time_score)
        
        # === 5. 决策逻辑 ===
        decision = self._make_decision(
            final_score=final_score,
            visual_score=visual_score,
            semantic_score=semantic_score,
            time_score=time_score,
            time_context=time_context,
            should_suppress=should_suppress,
            suppress_reason=suppress_reason,
            current_time=current_time
        )
        
        # === 6. 更新采样频率 ===
        self._update_sample_interval(decision)
        
        # === 7. 记录感知日志 ===
        if decision.mode == TriggerMode.INTERNAL:
            self._log_perception(decision)
        
        return decision
    
    def _compute_time_score(self, time_context: TimeContext) -> ModalityScore:
        """计算时间维度得分"""
        if not time_context.events:
            return ModalityScore(
                name="time",
                score=0.0,
                confidence=1.0,
                description="无特殊时间事件"
            )
        
        # 取最高重要性事件
        top_event = time_context.events[0]
        
        return ModalityScore(
            name="time",
            score=top_event.importance,
            confidence=0.9,
            description=top_event.description,
            metadata={
                "event_type": top_event.event_type,
                "phase": time_context.phase.value,
                "trigger_hint": top_event.trigger_hint
            }
        )
    
    def _compute_visual_score(self, visual_result: Optional[Dict[str, Any]]) -> ModalityScore:
        """计算视觉维度得分"""
        if visual_result is None:
            return ModalityScore(
                name="visual",
                score=0.0,
                confidence=0.0,
                description="无视觉输入"
            )
        
        # 从 VisionProcessResult 提取数据
        similarity = visual_result.get("top_similarity", 0.0)
        description = visual_result.get("top_description", "未知场景")
        saturation = visual_result.get("saturation", 0.0)
        
        # 饱和度惩罚: 如果饱和度高,说明最近聊过,降低得分
        saturation_penalty = saturation * 0.3
        adjusted_score = max(0.0, similarity - saturation_penalty)
        
        return ModalityScore(
            name="visual",
            score=adjusted_score,
            confidence=similarity,  # 原始相似度作为置信度
            description=f"观察到: {description}",
            metadata={
                "raw_similarity": similarity,
                "saturation": saturation,
                "anchor_id": visual_result.get("top_anchor_id")
            }
        )
    
    def _compute_semantic_score(
        self,
        activated_ids: Optional[List[int]],
        scores: Optional[Dict[int, float]]
    ) -> ModalityScore:
        """计算语义扩散维度得分"""
        if not activated_ids:
            return ModalityScore(
                name="semantic",
                score=0.0,
                confidence=0.0,
                description="无记忆被唤醒"
            )
        
        # 计算唤醒记忆的平均激活强度
        if scores:
            avg_score = sum(scores.get(mid, 0) for mid in activated_ids) / len(activated_ids)
            max_score = max(scores.get(mid, 0) for mid in activated_ids)
        else:
            avg_score = 0.5
            max_score = 0.5
        
        # 唤醒数量也是一个信号 (唤醒的越多,关联性越强)
        count_bonus = min(len(activated_ids) / 10, 0.2)  # 最多加 0.2
        
        final_score = min(1.0, avg_score + count_bonus)
        
        return ModalityScore(
            name="semantic",
            score=final_score,
            confidence=max_score,
            description=f"唤醒了 {len(activated_ids)} 条相关记忆",
            metadata={
                "count": len(activated_ids),
                "avg_activation": avg_score,
                "max_activation": max_score
            }
        )
    
    def _fuse_scores(
        self,
        visual: ModalityScore,
        semantic: ModalityScore,
        time: ModalityScore
    ) -> float:
        """融合三个模态的得分"""
        # 加权平均
        weighted_sum = (
            visual.score * self.weights["visual"] +
            semantic.score * self.weights["semantic"] +
            time.score * self.weights["time"]
        )
        
        # 共振加成: 如果多个模态同时高分,额外加分
        high_count = sum([
            visual.score > 0.7,
            semantic.score > 0.5,
            time.score > 0.6
        ])
        
        resonance_bonus = 0.0
        if high_count >= 3:
            resonance_bonus = 0.15  # 三维共振
        elif high_count >= 2:
            resonance_bonus = 0.08  # 双维共振
        
        return min(1.0, weighted_sum + resonance_bonus)
    
    def _make_decision(
        self,
        final_score: float,
        visual_score: ModalityScore,
        semantic_score: ModalityScore,
        time_score: ModalityScore,
        time_context: TimeContext,
        should_suppress: bool,
        suppress_reason: str,
        current_time: datetime
    ) -> MultimodalDecision:
        """做出最终决策"""
        
        # 冷却检查
        in_cooldown = False
        if self.last_trigger_time:
            if current_time - self.last_trigger_time < self.trigger_cooldown:
                in_cooldown = True
        
        # 决策逻辑
        if should_suppress:
            mode = TriggerMode.SILENT
            should_trigger = False
            reasoning = f"抑制触发: {suppress_reason}"
        
        elif in_cooldown:
            # 在冷却期, 使用 INTERNAL 模式记录感知
            mode = TriggerMode.INTERNAL if final_score > 0.5 else TriggerMode.SILENT
            should_trigger = False
            reasoning = "处于冷却期,感知已记录"
        
        elif final_score >= self.combined_threshold:
            # 高分触发
            mode = TriggerMode.PROACTIVE
            should_trigger = True
            reasoning = f"综合得分 {final_score:.2f} 超过阈值"
            self.last_trigger_time = current_time
        
        elif visual_score.score >= self.visual_threshold:
            # 视觉单独突破
            mode = TriggerMode.PROACTIVE
            should_trigger = True
            reasoning = f"视觉得分 {visual_score.score:.2f} 单独突破"
            self.last_trigger_time = current_time
        
        elif time_score.score >= self.time_threshold:
            # 时间事件驱动
            mode = TriggerMode.PROACTIVE
            should_trigger = True
            reasoning = f"时间事件驱动: {time_score.description}"
            self.last_trigger_time = current_time
        
        elif final_score > 0.5:
            # 中等分数, 记录但不触发
            mode = TriggerMode.INTERNAL
            should_trigger = False
            reasoning = f"中等活跃度 ({final_score:.2f}), 感知已记录"
        
        else:
            mode = TriggerMode.SILENT
            should_trigger = False
            reasoning = f"活跃度不足 ({final_score:.2f})"
        
        # 生成 LLM 上下文
        context_for_llm = self._build_llm_context(
            visual_score, semantic_score, time_score, time_context
        )
        
        return MultimodalDecision(
            should_trigger=should_trigger,
            mode=mode,
            final_score=final_score,
            visual_score=visual_score,
            semantic_score=semantic_score,
            time_score=time_score,
            reasoning=reasoning,
            context_for_llm=context_for_llm,
            activated_memory_ids=semantic_score.metadata.get("memory_ids", [])
        )
    
    def _build_llm_context(
        self,
        visual: ModalityScore,
        semantic: ModalityScore,
        time: ModalityScore,
        time_context: TimeContext
    ) -> str:
        """构建注入 LLM 的上下文"""
        lines = ["[INTERNAL_SENSE]"]
        
        # 时间上下文
        lines.append(time_context.to_prompt_segment())
        lines.append("")
        
        # 视觉观察
        if visual.score > 0:
            lines.append(f"Visual Observation: {visual.description}")
            lines.append(f"  Confidence: {visual.confidence:.2f}")
        
        # 语义共振
        if semantic.score > 0:
            lines.append(f"Memory Resonance: {semantic.description}")
            lines.append(f"  Activation Strength: {semantic.score:.2f}")
        
        # 时间提示
        if time.score > 0 and time.metadata.get("trigger_hint"):
            lines.append(f"Time Hint: {time.metadata['trigger_hint']}")
        
        lines.append("")
        lines.append("Consider these observations. If you have something meaningful to say, speak naturally.")
        lines.append("If the owner seems focused or you have nothing valuable to add, output <NOTHING>.")
        
        return "\n".join(lines)
    
    def _update_sample_interval(self, decision: MultimodalDecision):
        """根据决策结果自适应调整采样频率"""
        if decision.should_trigger:
            # 触发后, 短暂加快采样以追踪后续
            self.current_sample_interval = self.sample_interval_min
            self.consecutive_low_scores = 0
        
        elif decision.final_score < 0.3:
            # 连续低分, 降低采样频率
            self.consecutive_low_scores += 1
            if self.consecutive_low_scores >= 5:
                self.current_sample_interval = min(
                    self.current_sample_interval * 1.5,
                    self.sample_interval_max
                )
        
        else:
            # 正常状态
            self.consecutive_low_scores = 0
            # 渐进恢复到默认频率
            if self.current_sample_interval < self.sample_interval_default:
                self.current_sample_interval = min(
                    self.current_sample_interval + 5,
                    self.sample_interval_default
                )
    
    def _log_perception(self, decision: MultimodalDecision):
        """记录感知日志 (用于 INTERNAL 模式)"""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "score": decision.final_score,
            "visual": decision.visual_score.description if decision.visual_score else None,
            "semantic": decision.semantic_score.description if decision.semantic_score else None,
            "time": decision.time_score.description if decision.time_score else None,
        }
        
        self.perception_log.append(entry)
        
        # 限制日志大小
        if len(self.perception_log) > self.max_perception_log_size:
            self.perception_log = self.perception_log[-self.max_perception_log_size:]
    
    def get_recent_perceptions(self, limit: int = 5) -> List[Dict[str, Any]]:
        """获取最近的感知记录 (用于用户下次说话时带入)"""
        return self.perception_log[-limit:]
    
    def clear_perception_log(self):
        """清空感知日志 (用户交互后清空)"""
        self.perception_log = []
    
    def get_current_sample_interval(self) -> int:
        """获取当前采样间隔 (秒)"""
        return int(self.current_sample_interval)
    
    def configure(
        self,
        visual_threshold: float = None,
        combined_threshold: float = None,
        trigger_cooldown_minutes: int = None,
        weights: Dict[str, float] = None
    ):
        """动态配置协调器参数"""
        if visual_threshold is not None:
            self.visual_threshold = visual_threshold
        if combined_threshold is not None:
            self.combined_threshold = combined_threshold
        if trigger_cooldown_minutes is not None:
            self.trigger_cooldown = timedelta(minutes=trigger_cooldown_minutes)
        if weights is not None:
            self.weights.update(weights)
        
        logger.info(f"[MultimodalCoordinator] 配置已更新")


# 全局单例
multimodal_coordinator = MultimodalTriggerCoordinator()
