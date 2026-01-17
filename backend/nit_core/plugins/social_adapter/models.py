from dataclasses import dataclass, field
from typing import List, Optional, Literal
from datetime import datetime

@dataclass
class SocialMessage:
    """
    表示社交上下文中的单条消息。
    """
    msg_id: str
    sender_id: str
    sender_name: str
    content: str
    timestamp: datetime
    platform: str = "qq"
    raw_event: dict = field(default_factory=dict)
    images: List[str] = field(default_factory=list) # 图片 URL 列表

@dataclass
class SocialSession:
    """
    表示一个社交会话（群聊或私聊）。
    """
    session_id: str  # group_id or user_id
    session_type: Literal["group", "private"]
    session_name: str = ""
    
    # 消息缓冲区
    buffer: List[SocialMessage] = field(default_factory=list)
    
    # 状态机
    state: Literal["observing", "summoned", "active"] = "observing"
    last_active_time: datetime = field(default_factory=datetime.now)
    
    # 定时器句柄（如果新消息到达则取消）
    flush_timer_task: Optional[object] = None # asyncio.Task

    def add_message(self, msg: SocialMessage):
        self.buffer.append(msg)
        self.last_active_time = datetime.now()

    def clear_buffer(self):
        self.buffer.clear()
