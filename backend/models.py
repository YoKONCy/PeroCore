from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel
from sqlalchemy import Text, Column

def get_local_now():
    """获取当前本地时间"""
    return datetime.now()

def get_local_timestamp():
    """获取当前本地毫秒时间戳"""
    return datetime.now().timestamp() * 1000

class Memory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    tags: str = ""  # 逗号分隔的标签
    clusters: Optional[str] = None # 逗号分隔的思维簇 (Thinking Clusters)
    
    # --- 权重与情感 ---
    importance: int = 1  # 0-10
    base_importance: float = 1.0  # 初始重要性 (1.0 - 10.0), 由 Scorer 评定
    access_count: int = 0         # 被回忆次数
    last_accessed: datetime = Field(default_factory=get_local_now) # 最后被激活时间
    sentiment: str = "neutral"    # 情感极性 (happy, sad, neutral, angry, etc.)

    # --- 时间主轴 (Linked List) ---
    timestamp: float = Field(default_factory=get_local_timestamp)
    realTime: str = "" # 现实时间字符串
    prev_id: Optional[int] = Field(default=None, foreign_key="memory.id")
    next_id: Optional[int] = Field(default=None, foreign_key="memory.id")

    # --- 基础元数据 ---
    msgTimestamp: Optional[str] = None # 绑定消息时间戳
    source: str = "desktop" # 记忆来源 (desktop, ide, mobile, qq, etc.)
    type: str = "event" # 记忆类型 (event, fact, preference, promise, etc.)
    agent_id: str = Field(default="pero", index=True) # 所属 Agent ID (多 Agent 隔离)

    # --- 向量数据 ---
    # 存储向量 JSON (例如: "[0.123, -0.456, ...]")
    embedding_json: str = Field(default="[]", sa_column=Column(Text))

class MemoryRelation(SQLModel, table=True):
    """
    记忆关联表 (The Chain-Net)
    存储记忆之间的动态关联，构成知识图谱
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="memory.id", index=True)
    target_id: int = Field(foreign_key="memory.id", index=True)
    
    relation_type: str = "associative" # associative(联想), causal(因果), thematic(主题), temporal(时序), contradictory(矛盾)
    strength: float = 0.5 # 关联强度 (0.0 - 1.0)
    description: Optional[str] = None # 关联描述 (例如 "都提到了喜欢吃拉面")
    agent_id: str = Field(default="pero", index=True) # 所属 Agent ID
    
    created_at: datetime = Field(default_factory=get_local_now)


class ConversationLog(SQLModel, table=True):
    """
    存储原始对话记录 (Raw History Logs)
    不同设备的对话记录通过 source 隔离
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True) # 会话ID
    source: str = Field(index=True) # 来源环境 (desktop, ide, qq, etc.)
    role: str # user, assistant, system, tool
    content: str
    raw_content: Optional[str] = Field(default=None, sa_column=Column(Text)) # 存储未过滤的原始内容 (包含 Thinking/NIT)
    timestamp: datetime = Field(default_factory=get_local_now)
    metadata_json: str = "{}" # 存储额外元数据
    pair_id: Optional[str] = Field(default=None, index=True) # 成对绑定ID
    
    # Scorer 提取的元数据
    sentiment: Optional[str] = None
    importance: Optional[int] = None
    memory_id: Optional[int] = Field(default=None, foreign_key="memory.id")

    # Scorer 状态跟踪
    analysis_status: str = Field(default="pending") # pending, processing, completed, failed
    retry_count: int = Field(default=0)
    last_error: Optional[str] = None
    
    agent_id: str = Field(default="pero", index=True) # 所属 Agent ID (多 Agent 隔离)
    


class PetState(SQLModel, table=True):
    """存储 Agent 的状态（情绪、心理活动等），即长记忆的一部分"""
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_id: str = Field(default="pero", index=True)
    mood: str = "开心"
    vibe: str = "活泼"
    mind: str = "正在想主人..."
    
    # 新增：交互类触发器 (存储为 JSON 字符串)
    click_messages_json: str = "{}" # 包含 head, chest, body 的点击语
    idle_messages_json: str = "[]"  # 挂机语列表
    back_messages_json: str = "[]"  # 回归语列表
    
    updated_at: datetime = Field(default_factory=get_local_now)

class GroupChatRoom(SQLModel, table=True):
    id: str = Field(primary_key=True) # UUID
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=get_local_now)
    creator_id: str # 'user' or agent_id

class GroupChatMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: str = Field(foreign_key="groupchatroom.id", index=True)
    agent_id: str = Field(index=True) # 'user' or agent_id
    joined_at: datetime = Field(default_factory=get_local_now)
    role: str = "member" # member, admin, host

class GroupChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: str = Field(foreign_key="groupchatroom.id", index=True)
    sender_id: str = Field(index=True) # 'user' or agent_id
    content: str = Field(sa_column=Column(Text))
    role: str # user, assistant, system
    timestamp: datetime = Field(default_factory=get_local_now)
    mentions_json: str = "[]" # List of mentioned agent_ids
    
    updated_at: datetime = Field(default_factory=get_local_now)

class ScheduledTask(SQLModel, table=True):
    """存储 <REMINDER> 和 <TOPIC>"""
    id: Optional[int] = Field(default=None, primary_key=True)
    type: str  # "reminder" or "topic"
    time: str  # YYYY-MM-DD HH:mm:ss
    content: str
    is_triggered: bool = False
    created_at: datetime = Field(default_factory=get_local_now)
    agent_id: str = Field(default="pero", index=True) # 所属 Agent ID

class Config(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # 新增：是否启用反思模型
    # reflection_enabled: bool (stored as string "true"/"false")
    # reflection_model_id: int (stored as string)
    
    # 新增：是否启用辅助模型（用于文件搜索分析等）
    # aux_model_enabled: bool (stored as string "true"/"false")
    # aux_model_id: int (stored as string)

class AIModelConfig(SQLModel, table=True):
    """
    模型卡配置
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True) # 显示名称，唯一标识，如 "对话模型"
    
    # 基础配置
    model_id: str # 实际模型ID，如 "gpt-4", "claude-3-opus"
    provider: str = Field(default="openai") # "openai", "gemini", "anthropic" etc.
    provider_type: str = "global" # "global" (继承全局) 或 "custom" (独立配置)
    
    # 独立配置 (当 provider_type == 'custom' 时使用)
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    
    # 模型参数
    temperature: float = 0.7
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = True
    is_multimodal: bool = False # Deprecated: Use enable_vision instead
    enable_vision: bool = Field(default=False)
    enable_voice: bool = Field(default=False) # Voice Input
    enable_video: bool = Field(default=False)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class VoiceConfig(SQLModel, table=True):
    """
    语音功能配置 (STT/TTS)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    type: str # "stt" or "tts"
    name: str = Field(unique=True, index=True) # 显示名称，如 "Whisper Local", "Azure TTS"
    provider: str # "local_whisper", "edge_tts", "openai_compatible", "azure", etc.
    
    # API 配置
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    model: Optional[str] = None # 模型名称，如 "whisper-1", "tts-1"
    
    # 额外配置 (JSON string)
    config_json: str = "{}" 
    
    is_active: bool = False # 是否为当前启用
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class MaintenanceRecord(SQLModel, table=True):
    """存储记忆秘书维护记录，用于撤回"""
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=get_local_now)
    
    # 统计信息
    preferences_extracted: int = 0
    important_tagged: int = 0
    consolidated: int = 0
    cleaned_count: int = 0
    
    # 变更详情 (JSON 字符串)
    created_ids: str = "[]" # 新生成的记忆 ID 列表
    deleted_data: str = "[]" # 被删除记忆的完整数据备份，用于恢复
    modified_data: str = "[]" # 修改前记忆的数据备份

class MCPConfig(SQLModel, table=True):
    """
    MCP 服务器配置
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True) # 显示名称
    type: str = "stdio" # "stdio" 或 "sse"
    
    # stdio 配置
    command: Optional[str] = None
    args: str = "[]" # JSON 数组字符串
    env: str = "{}" # JSON 对象字符串
    
    # sse 配置
    url: Optional[str] = None
    
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class AgentProfile(SQLModel, table=True):
    """
    Agent 角色配置 (Multi-Agent Support)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    role: str = Field(index=True) # "user", "assistant", "system"
    name: str = Field(unique=True, index=True) # 角色名，如 "Pero" 或自定义 Agent 名
    avatar: Optional[str] = None # 头像 URL 或路径
    description: Optional[str] = None # 角色描述
    
    # 个性化配置
    system_prompt: Optional[str] = None # 专属 System Prompt
    voice_config_id: Optional[int] = Field(default=None, foreign_key="voiceconfig.id")
    
    is_active: bool = False # 是否为当前激活角色
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
