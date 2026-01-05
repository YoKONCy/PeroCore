from dataclasses import dataclass, field
from typing import List, Optional, Literal
from datetime import datetime

@dataclass
class SocialMessage:
    """
    Represents a single message in the social context.
    """
    msg_id: str
    sender_id: str
    sender_name: str
    content: str
    timestamp: datetime
    platform: str = "qq"
    raw_event: dict = field(default_factory=dict)
    images: List[str] = field(default_factory=list) # List of image URLs

@dataclass
class SocialSession:
    """
    Represents a social session (Group or Private chat).
    """
    session_id: str  # group_id or user_id
    session_type: Literal["group", "private"]
    session_name: str = ""
    
    # Message Buffer
    buffer: List[SocialMessage] = field(default_factory=list)
    
    # State Machine
    state: Literal["observing", "summoned", "active"] = "observing"
    last_active_time: datetime = field(default_factory=datetime.now)
    
    # Timer handle (to cancel if new message arrives)
    flush_timer_task: Optional[object] = None # asyncio.Task

    def add_message(self, msg: SocialMessage):
        self.buffer.append(msg)
        self.last_active_time = datetime.now()

    def clear_buffer(self):
        self.buffer.clear()
