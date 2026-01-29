import logging
import sys
import os
from typing import Optional

def configure_logging(level: int = logging.INFO, log_file: Optional[str] = None):
    """
    配置 PeroCore 的全局日志记录。
    
    Args:
        level: 日志级别（默认：logging.INFO）
        log_file: 可选的日志文件路径
    """
    
    # 定义格式
    log_format = "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"
    
    # 创建处理器
    handlers = []
    
    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter(log_format, date_format))
    handlers.append(console_handler)
    
    # 文件处理器（如果请求）
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setFormatter(logging.Formatter(log_format, date_format))
        handlers.append(file_handler)

    # 配置根日志记录器
    logging.basicConfig(
        level=level,
        handlers=handlers,
        force=True # 覆盖现有配置
    )
    
    # 静音嘈杂的库
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("multipart").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    
    # Silence ML libraries
    logging.getLogger("transformers").setLevel(logging.ERROR)
    logging.getLogger("sentence_transformers").setLevel(logging.ERROR)

    # 确保 PeroCore 日志记录器至少为 INFO
    logging.getLogger("pero").setLevel(level)

    print(f"[System] Logging initialized at level {logging.getLevelName(level)}")
