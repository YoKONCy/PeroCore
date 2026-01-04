import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel, create_engine
from sqlmodel.ext.asyncio.session import AsyncSession
from pathlib import Path
import shutil

# 定义数据库路径
# 旧路径: 用户主目录
old_db_path = Path.home() / ".perocore" / "perocore.db"

# 新路径: 项目内部 backend/data
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
new_db_path = DATA_DIR / "perocore.db"

# 自动迁移逻辑
if old_db_path.exists() and not new_db_path.exists():
    print(f"[Database] Migrating from {old_db_path} to {new_db_path}...")
    try:
        shutil.move(str(old_db_path), str(new_db_path))
        print("[Database] Migration successful.")
    except Exception as e:
        print(f"[Database] Migration failed: {e}. Using old path as fallback.")
        db_path = old_db_path
    else:
        db_path = new_db_path
elif new_db_path.exists():
    # 如果新路径已经存在，直接使用
    db_path = new_db_path
else:
    # 都不存在，初始化新路径
    db_path = new_db_path

DATABASE_URL = f"sqlite+aiosqlite:///{db_path}"

engine = create_async_engine(DATABASE_URL, echo=True, future=True)

async def init_db():
    async with engine.begin() as conn:
        # 运行同步模式的创建表操作
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_session() -> AsyncSession:
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
