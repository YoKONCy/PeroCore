
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
    is_summarized: bool = Field(default=False) # 新增：标记该消息是否已被总结过

class QQUser(SQLModel, table=True):
    user_id: str = Field(primary_key=True)
    nickname: str
    remark: Optional[str] = None
    last_seen: datetime = Field(default_factory=datetime.now)

class QQGroup(SQLModel, table=True):
    group_id: str = Field(primary_key=True)
    group_name: str
    last_active: datetime = Field(default_factory=datetime.now)

class SocialMemory(SQLModel, table=True):
    """
    社交专用长记忆表
    只存储会话总结 (Conversation Summary)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str # 记忆内容 (80字左右的总结)
    
    # 元数据
    created_at: datetime = Field(default_factory=datetime.now)
    source_session_id: str = Field(index=True) # 来源会话ID (群号或QQ号)
    source_session_type: str # group 或 private
    
    # 关键词 (用于串线)
    keywords: str = "" # 逗号分隔的关键词，如 "上海,漫展,UserB"
    
    # 向量备份
    embedding_json: str = "[]" 
    
    # 关联消息范围 (用于溯源)
    msg_start_id: Optional[int] = None # 对应 QQMessage.id
    msg_end_id: Optional[int] = None

class SocialMemoryRelation(SQLModel, table=True):
    """
    社交记忆关联表 (The Social Web)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="socialmemory.id", index=True)
    target_id: int = Field(foreign_key="socialmemory.id", index=True)
    
    relation_type: str = "thematic" # thematic(主题关联), temporal(时序), mentioned(提及)
    strength: float = 0.5 # 关联强度
    
    created_at: datetime = Field(default_factory=datetime.now)

class SocialDailyReport(SQLModel, table=True):
    """
    社交日报归档
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    date_str: str = Field(index=True) # YYYY-MM-DD
    content: str # 日报全文 (Markdown)
    
    # 统计数据
    total_messages: int = 0
    active_groups: str = "" # 活跃群组列表
    new_friends: int = 0
    
    created_at: datetime = Field(default_factory=datetime.now)
