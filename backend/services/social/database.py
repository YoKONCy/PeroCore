
import os
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from .models_db import QQMessage, QQUser, QQGroup

# 使用绝对路径确保数据库文件位置正确
# 默认存储在 backend/data 目录下，名为 social_storage.db
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 使用新的数据库文件名以避免锁定问题
DATABASE_FILE = os.path.join(BASE_DIR, "data", "social_storage_v2.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DATABASE_FILE}"

social_engine = create_async_engine(DATABASE_URL, echo=False)

async def init_social_db():
    """初始化社交数据库表"""
    async with social_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_social_db_session():
    """获取社交数据库会话"""
    async_session = sessionmaker(
        social_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
