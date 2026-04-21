"""
系统状态与杂项 Router
从 main.py 提取的 /api/ping, /health, /api/system/*, /api/open-path,
/api/gateway/token, /api/stats/overview, /api/configs/*, /api/configs/waifu-texts 路由
"""

import json
import logging
import os
import subprocess
from datetime import datetime
from typing import Dict, Optional

import psutil
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.desktop_auth import (
    DESKTOP_API_KEY_HEADER,
    DESKTOP_API_KEY_COOKIE,
    DESKTOP_API_KEY_QUERY,
    clear_desktop_auth_cookie,
    desktop_auth_required,
    has_valid_desktop_api_key,
    resolve_desktop_api_key,
    set_desktop_auth_cookie,
    verify_desktop_api_key,
)
from database import get_session
from models import (
    Config,
    ConversationLog,
    Memory,
    PetState,
    ScheduledTask,
)

router = APIRouter(prefix="/api/system", tags=["system"])


current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
logger = logging.getLogger(__name__)


def _request_is_secure(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"

    forwarded_ssl = request.headers.get("x-forwarded-ssl", "")
    if forwarded_ssl:
        return forwarded_ssl.strip().lower() == "on"

    return request.url.scheme == "https"


@router.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "desktop_auth_required": desktop_auth_required(),
        "desktop_auth_header": DESKTOP_API_KEY_HEADER,
        "desktop_auth_cookie": DESKTOP_API_KEY_COOKIE,
        "desktop_auth_query": DESKTOP_API_KEY_QUERY,
    }


class DesktopAuthValidateRequest(BaseModel):
    api_key: str = ""


@router.get("/auth/status")
async def get_desktop_auth_status(request: Request):
    provided = resolve_desktop_api_key(request)
    authorized = has_valid_desktop_api_key(provided)
    return {
        "authorized": authorized,
        "desktop_auth_required": desktop_auth_required(),
        "desktop_auth_header": DESKTOP_API_KEY_HEADER,
        "desktop_auth_cookie": DESKTOP_API_KEY_COOKIE,
        "desktop_auth_query": DESKTOP_API_KEY_QUERY,
    }


@router.post("/auth/validate")
async def validate_desktop_auth(
    payload: DesktopAuthValidateRequest,
    request: Request,
    response: Response,
):
    if not desktop_auth_required():
        return {
            "valid": True,
            "desktop_auth_required": False,
            "desktop_auth_header": DESKTOP_API_KEY_HEADER,
            "desktop_auth_cookie": DESKTOP_API_KEY_COOKIE,
            "desktop_auth_query": DESKTOP_API_KEY_QUERY,
        }

    provided = (payload.api_key or "").strip()
    if not has_valid_desktop_api_key(provided):
        error_response = JSONResponse(
            status_code=401,
            content={"detail": "Invalid desktop API key"},
        )
        clear_desktop_auth_cookie(error_response, secure=_request_is_secure(request))
        return error_response

    set_desktop_auth_cookie(response, provided, secure=_request_is_secure(request))

    return {
        "valid": True,
        "desktop_auth_required": True,
        "desktop_auth_header": DESKTOP_API_KEY_HEADER,
        "desktop_auth_cookie": DESKTOP_API_KEY_COOKIE,
        "desktop_auth_query": DESKTOP_API_KEY_QUERY,
    }


@router.get("/system/status")
async def get_system_status():
    try:
        cpu_percent = psutil.cpu_percent(interval=None)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        return {
            "cpu": {"percent": cpu_percent, "count": psutil.cpu_count()},
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "percent": memory.percent,
                "used": memory.used,
            },
            "disk": {"total": disk.total, "used": disk.used, "percent": disk.percent},
            "boot_time": psutil.boot_time(),
        }
    except Exception as e:
        print(f"获取系统状态错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class OpenPathRequest(BaseModel):
    path: str


@router.post("/open-path")
async def open_path(payload: OpenPathRequest):
    """打开本地文件或文件夹"""
    path = payload.path
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")

    path = os.path.normpath(path)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Path does not exist")

    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        try:
            if os.path.isfile(path):
                subprocess.Popen(
                    ["explorer", "/select,", path], startupinfo=startupinfo
                )
            else:
                os.startfile(path)
        except Exception:
            try:
                os.startfile(path)
            except Exception as inner_e:
                print(f"打开路径 {path} 时出错: {inner_e}")
                raise HTTPException(status_code=500, detail=str(inner_e)) from inner_e
    else:
        subprocess.Popen(["xdg-open", path])

    return {"status": "success", "message": f"Opened {path}", "data": {"path": path}}


@router.get("/gateway/token")
async def get_gateway_token_api(
    _: None = Depends(verify_desktop_api_key),
    session: AsyncSession = Depends(get_session),
):
    """获取 Gateway Token (用于前端连接 Gateway)"""
    try:
        token_stmt = select(Config).where(Config.key == "frontend_access_token")
        token_result = await session.exec(token_stmt)
        token_config = token_result.first()
        if token_config and token_config.value:
            return {"token": token_config.value}

        data_dir = os.environ.get("PERO_DATA_DIR", os.path.join(current_dir, "data"))
        token_path = os.path.join(data_dir, "gateway_token.json")
        if os.path.exists(token_path):
            with open(token_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {"token": data.get("token")}
        raise HTTPException(status_code=404, detail="Token not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


from schemas import StatsOverviewResponse


@router.get("/stats/overview", response_model=StatsOverviewResponse)
async def get_overview_stats(
    agent_id: Optional[str] = None,
    session: AsyncSession = Depends(get_session),  # noqa: B008
):
    """
    获取概览页面的统计数据（总数），解耦渲染数量和显示数量。
    """
    try:
        mem_statement = select(func.count()).select_from(Memory)
        if agent_id:
            mem_statement = mem_statement.where(Memory.agent_id == agent_id)
        mem_count = (await session.exec(mem_statement)).one()

        log_statement = select(func.count()).select_from(ConversationLog)
        if agent_id:
            log_statement = log_statement.where(ConversationLog.agent_id == agent_id)
        log_count = (await session.exec(log_statement)).one()

        task_statement = select(func.count()).select_from(ScheduledTask)
        if agent_id:
            task_statement = task_statement.where(ScheduledTask.agent_id == agent_id)
        task_count = (await session.exec(task_statement)).one()

        return {
            "total_memories": mem_count,
            "total_logs": log_count,
            "total_tasks": task_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取统计概览失败: {str(e)}")


# --- 配置 ---


@router.get("/config", deprecated=True, summary="历史兼容接口，请使用 /api/configs")
async def get_configs(session: AsyncSession = Depends(get_session)):  # noqa: B008
    configs = (await session.exec(select(Config))).all()
    return {c.key: c.value for c in configs}


@router.post("/config", deprecated=True, summary="历史兼容接口，请使用 /api/configs")
async def update_config(
    configs: Dict[str, str],
    session: AsyncSession = Depends(get_session),  # noqa: B008
):
    # [检查] 工作模式下阻止启用不兼容模式
    try:
        current_session = (
            await session.exec(select(Config).where(Config.key == "current_session_id"))
        ).first()
        is_work_mode = current_session and current_session.value.startswith("work_")

        if is_work_mode:
            blocking_modes = [
                "lightweight_mode",
                "companion_mode",
                "aura_vision_enabled",
            ]
            name_map = {
                "lightweight_mode": "轻量模式",
                "companion_mode": "陪伴模式",
                "aura_vision_enabled": "主动视觉模式",
            }

            for key, value in configs.items():
                if key in blocking_modes:
                    is_enabling = str(value).lower() == "true"
                    if is_enabling:
                        raise HTTPException(
                            status_code=403,
                            detail=f"无法启用{name_map.get(key, key)}：当前处于工作模式（会话隔离中）。请先退出工作模式。",
                        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Config] 工作模式检查失败: {e}")

    for key, value in configs.items():
        config_obj = await session.get(Config, key)
        if config_obj:
            config_obj.value = str(value)
        else:
            config_obj = Config(key=key, value=str(value))
            session.add(config_obj)

    await session.commit()

    # 刷新 Embedding Service 状态
    try:
        from services.core.embedding_service import embedding_service

        await embedding_service.refresh_config(session)
    except Exception as e:
        print(f"[Config] 刷新 Embedding Service 失败: {e}")

    return {"status": "success"}


# --- 系统重置 ---


@router.post("/system/reset")
async def reset_system(session: AsyncSession = Depends(get_session)):  # noqa: B008
    """一键恢复出厂设置：清理所有记忆、对话记录、状态和任务，但保留模型配置"""
    try:
        await session.exec(delete(ConversationLog))
        await session.exec(delete(ScheduledTask))
        await session.exec(delete(Memory))
        await session.exec(delete(PetState))

        keep_configs = [
            "current_model_id",
            "reflection_model_id",
            "reflection_enabled",
            "global_llm_api_key",
            "global_llm_api_base",
            "frontend_access_token",
        ]
        await session.exec(delete(Config).where(Config.key.not_in(keep_configs)))

        default_state = PetState()
        session.add(default_state)

        await session.commit()
        return {
            "status": "success",
            "message": "系统已成功恢复出厂设置喵！",
            "data": {},
        }
    except Exception as e:
        await session.rollback()
        import traceback

        print(f"重置系统时出错: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"恢复出厂设置失败: {str(e)}"
        ) from e
