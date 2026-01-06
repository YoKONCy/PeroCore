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

# 转换为绝对路径，确保 aiosqlite 能正确识别 Windows 路径
abs_db_path = db_path.resolve()
# 在 Windows 上，aiosqlite 需要 sqlite:////C:/path/to/db (4个斜杠)
# 或者使用 Path.as_uri() 的变体
DATABASE_URL = f"sqlite+aiosqlite:///{abs_db_path.as_posix()}"
if os.name == 'nt':
    # Windows 特殊处理：确保路径以 / 开头，例如 /C:/Users/...
    path_str = abs_db_path.as_posix()
    if not path_str.startswith('/'):
        path_str = '/' + path_str
    DATABASE_URL = f"sqlite+aiosqlite://{path_str}"

from sqlalchemy import event

engine = create_async_engine(
    DATABASE_URL, 
    echo=False, # 生产环境建议关闭详细 log 以提升性能
    future=True,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True
)

@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000") # 5秒忙碌等待
    cursor.execute("PRAGMA cache_size=-20000") # 20MB 缓存
    cursor.close()

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
