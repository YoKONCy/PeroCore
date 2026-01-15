
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field

class QQMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    msg_id: str = Field(index=True)
    session_id: str = Field(index=True) # 群号或用户 ID
    session_type: str # group 或 private
    sender_id: str
    sender_name: str
    content: str
    timestamp: datetime = Field(default_factory=datetime.now)
    raw_event_json: str = Field(default="{}")

class QQUser(SQLModel, table=True):
    user_id: str = Field(primary_key=True)
    nickname: str
    remark: Optional[str] = None
    last_seen: datetime = Field(default_factory=datetime.now)

class QQGroup(SQLModel, table=True):
    group_id: str = Field(primary_key=True)
    group_name: str
    last_active: datetime = Field(default_factory=datetime.now)
