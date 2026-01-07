"""
时间感知服务 (Time Awareness Service)

实现时间维度的主动触发能力:
1. 时间节点敏感度 (Time Node Sensitivity)
   - 深夜关怀 (Late Night Care)
   - 早晨问候 (Morning Greeting)
   - 纪念日提醒 (Anniversary Reminder)

2. 周期性行为检测 (Periodic Behavior Detection)
   - 用户作息规律
   - 异常熬夜检测

3. 时间上下文注入 (Time Context Injection)
   - 为其他模态提供时间背景

版本: 1.0.0
"""

import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
from loguru import logger


class TimePhase(Enum):
    """一天中的时间阶段"""
    DEEP_NIGHT = "deep_night"    # 00:00 - 05:00 深夜
    DAWN = "dawn"                # 05:00 - 07:00 黎明
    MORNING = "morning"          # 07:00 - 09:00 早晨
    FORENOON = "forenoon"        # 09:00 - 12:00 上午
    NOON = "noon"                # 12:00 - 14:00 中午
    AFTERNOON = "afternoon"      # 14:00 - 18:00 下午
    EVENING = "evening"          # 18:00 - 21:00 傍晚
    NIGHT = "night"              # 21:00 - 00:00 夜晚


@dataclass
class TimeEvent:
    """时间事件"""
    event_type: str           # 事件类型
    description: str          # 描述 (用于注入 LLM)
    importance: float         # 重要性 (0-1)
    trigger_hint: str         # 触发建议
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TimeContext:
    """时间上下文"""
    current_time: datetime
    phase: TimePhase
    weekday: int              # 0=周一, 6=周日
    is_weekend: bool
    is_holiday: bool          # 节假日 (简化实现)
    events: List[TimeEvent] = field(default_factory=list)
    
    def to_prompt_segment(self) -> str:
        """转换为可注入 LLM 的提示词片段"""
        phase_names = {
            TimePhase.DEEP_NIGHT: "深夜",
            TimePhase.DAWN: "黎明",
            TimePhase.MORNING: "早晨",
            TimePhase.FORENOON: "上午",
            TimePhase.NOON: "中午",
            TimePhase.AFTERNOON: "下午",
            TimePhase.EVENING: "傍晚",
            TimePhase.NIGHT: "夜晚",
        }
        
        weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        
        lines = [
            f"Time Phase: {phase_names.get(self.phase, 'Unknown')} ({self.current_time.strftime('%H:%M')})",
            f"Day: {weekday_names[self.weekday]}" + (" (Weekend)" if self.is_weekend else ""),
        ]
        
        if self.events:
            lines.append("Time Events:")
            for event in self.events:
                lines.append(f"  - {event.description} (Importance: {event.importance:.2f})")
        
        return "\n".join(lines)


class TimeAwarenessService:
    """
    时间感知服务
    
    核心功能:
    1. 识别当前时间阶段
    2. 检测时间节点事件 (熬夜、纪念日等)
    3. 提供时间上下文给多模态协调器
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
        
        # 用户作息统计 (简化版, 实际应从数据库读取)
        self.user_sleep_hour_estimate = 23  # 估计的入睡时间
        self.user_wake_hour_estimate = 7    # 估计的起床时间
        
        # 上次检查时间
        self.last_check_time: Optional[datetime] = None
        
        # 已触发的事件 (防止重复触发)
        self.triggered_today: set = set()
        
        # 特殊日期 (简化版, 实际应从配置或数据库读取)
        self.special_dates: Dict[Tuple[int, int], str] = {
            (1, 1): "新年第一天",
            (2, 14): "情人节",
            (5, 1): "劳动节",
            (10, 1): "国庆节",
            (12, 25): "圣诞节",
            # 可以从用户记忆中提取更多个人纪念日
        }
        
        self._initialized = True
        logger.info("[TimeAwareness] 服务初始化完成")
    
    def get_time_phase(self, dt: datetime = None) -> TimePhase:
        """获取当前时间阶段"""
        if dt is None:
            dt = datetime.now()
        
        hour = dt.hour
        
        if 0 <= hour < 5:
            return TimePhase.DEEP_NIGHT
        elif 5 <= hour < 7:
            return TimePhase.DAWN
        elif 7 <= hour < 9:
            return TimePhase.MORNING
        elif 9 <= hour < 12:
            return TimePhase.FORENOON
        elif 12 <= hour < 14:
            return TimePhase.NOON
        elif 14 <= hour < 18:
            return TimePhase.AFTERNOON
        elif 18 <= hour < 21:
            return TimePhase.EVENING
        else:
            return TimePhase.NIGHT
    
    def detect_late_night_activity(self, current_time: datetime) -> Optional[TimeEvent]:
        """检测深夜活动 (熬夜检测)"""
        phase = self.get_time_phase(current_time)
        
        if phase == TimePhase.DEEP_NIGHT:
            hour = current_time.hour
            
            # 根据时间深度调整重要性
            if hour >= 2:
                importance = 0.9
                description = f"主人在凌晨 {hour} 点还没休息，这已经很晚了"
                hint = "温柔地关心主人是否需要休息，但不要强迫"
            elif hour >= 1:
                importance = 0.7
                description = f"已经凌晨 {hour} 点了，主人还在忙碌"
                hint = "可以轻声询问是否遇到棘手的问题"
            else:
                importance = 0.5
                description = "午夜时分，主人仍在电脑前"
                hint = "如果主人不是在做重要的事，可以建议休息"
            
            return TimeEvent(
                event_type="late_night_activity",
                description=description,
                importance=importance,
                trigger_hint=hint,
                metadata={"hour": hour}
            )
        
        return None
    
    def detect_morning_greeting(self, current_time: datetime) -> Optional[TimeEvent]:
        """检测早晨问候时机"""
        phase = self.get_time_phase(current_time)
        
        # 只在早晨阶段触发
        if phase != TimePhase.MORNING:
            return None
        
        # 检查是否已经问候过 (每天只问候一次)
        today_key = f"morning_greeting_{current_time.date()}"
        if today_key in self.triggered_today:
            return None
        
        # 标记为已触发
        self.triggered_today.add(today_key)
        
        weekday = current_time.weekday()
        is_weekend = weekday >= 5
        
        if is_weekend:
            description = "周末的早晨，主人打开了电脑"
            hint = "可以用轻松的语气问好，不需要太正式"
        else:
            description = "新的一天开始了，主人打开了电脑准备工作"
            hint = "可以问候早安，顺便提及今天是否有特别的计划"
        
        return TimeEvent(
            event_type="morning_greeting",
            description=description,
            importance=0.6,
            trigger_hint=hint,
            metadata={"is_weekend": is_weekend}
        )
    
    def detect_special_date(self, current_time: datetime) -> Optional[TimeEvent]:
        """检测特殊日期"""
        month, day = current_time.month, current_time.day
        
        if (month, day) in self.special_dates:
            date_name = self.special_dates[(month, day)]
            
            # 每个特殊日期每天只提一次
            today_key = f"special_date_{current_time.date()}"
            if today_key in self.triggered_today:
                return None
            
            self.triggered_today.add(today_key)
            
            return TimeEvent(
                event_type="special_date",
                description=f"今天是{date_name}",
                importance=0.8,
                trigger_hint=f"可以在合适的时机祝福主人{date_name}快乐",
                metadata={"date_name": date_name}
            )
        
        return None
    
    def detect_long_session(self, current_time: datetime, session_start: datetime = None) -> Optional[TimeEvent]:
        """检测长时间工作"""
        if session_start is None:
            return None
        
        duration = current_time - session_start
        hours = duration.total_seconds() / 3600
        
        if hours >= 4:
            return TimeEvent(
                event_type="long_session",
                description=f"主人已经连续工作了 {hours:.1f} 小时",
                importance=0.7,
                trigger_hint="建议主人休息一下，活动一下身体",
                metadata={"hours": hours}
            )
        elif hours >= 2:
            return TimeEvent(
                event_type="long_session",
                description=f"主人已经工作了 {hours:.1f} 小时",
                importance=0.4,
                trigger_hint="可以在适当时机提醒主人喝水或伸展",
                metadata={"hours": hours}
            )
        
        return None
    
    def get_time_context(self, session_start: datetime = None) -> TimeContext:
        """
        获取完整的时间上下文
        
        Args:
            session_start: 会话开始时间 (用于检测长时间工作)
        
        Returns:
            TimeContext: 包含时间阶段和所有活跃事件
        """
        current_time = datetime.now()
        phase = self.get_time_phase(current_time)
        weekday = current_time.weekday()
        is_weekend = weekday >= 5
        is_holiday = False  # 简化实现, 可以接入节假日 API
        
        # 收集所有活跃的时间事件
        events = []
        
        # 检测各类事件
        late_night = self.detect_late_night_activity(current_time)
        if late_night:
            events.append(late_night)
        
        morning = self.detect_morning_greeting(current_time)
        if morning:
            events.append(morning)
        
        special = self.detect_special_date(current_time)
        if special:
            events.append(special)
        
        if session_start:
            long_session = self.detect_long_session(current_time, session_start)
            if long_session:
                events.append(long_session)
        
        # 按重要性排序
        events.sort(key=lambda e: e.importance, reverse=True)
        
        # 更新检查时间
        self.last_check_time = current_time
        
        # 清理过期的已触发记录 (跨天重置)
        self._cleanup_triggered()
        
        return TimeContext(
            current_time=current_time,
            phase=phase,
            weekday=weekday,
            is_weekend=is_weekend,
            is_holiday=is_holiday,
            events=events
        )
    
    def _cleanup_triggered(self):
        """清理过期的已触发记录"""
        today = datetime.now().date()
        to_remove = set()
        
        for key in self.triggered_today:
            # 提取日期部分
            if "_" in key:
                parts = key.rsplit("_", 1)
                if len(parts) == 2:
                    try:
                        date_str = parts[1]
                        event_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                        if event_date < today:
                            to_remove.add(key)
                    except ValueError:
                        pass
        
        self.triggered_today -= to_remove
    
    def should_suppress_proactive(self, phase: TimePhase) -> Tuple[bool, str]:
        """
        判断当前时间是否应该抑制主动触发
        
        Returns:
            (should_suppress, reason)
        """
        if phase == TimePhase.DEEP_NIGHT:
            return True, "深夜时段，除非紧急情况否则不主动打扰"
        
        return False, ""


# 全局单例
time_awareness_service = TimeAwarenessService()
