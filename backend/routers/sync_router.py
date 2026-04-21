import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from core.desktop_auth import desktop_auth_required, verify_desktop_api_key
from core.config_manager import get_config_manager
from database import get_session
from models import Config
from services.core.sync_service import sync_service

router = APIRouter(prefix="/api/sync", tags=["Sync"])


class SyncConfig(BaseModel):
    enabled: bool
    mode: str  # "client" or "server"
    url: str
    token: str


@router.get("/config")
async def get_sync_config():
    """获取当前同步配置"""
    return {
        "enabled": sync_service.enabled,
        "mode": sync_service.mode,
        "url": sync_service.cloud_url,
        "token": sync_service.cloud_token,
    }


@router.post("/config")
async def update_sync_config(
    config: SyncConfig,
    session: Session = Depends(get_session),  # noqa: B008
):
    """更新同步配置"""
    try:
        # 更新数据库
        configs_to_update = {
            "cloud_sync_enabled": str(config.enabled).lower(),
            "cloud_sync_mode": config.mode,
            "cloud_sync_url": config.url,
            "cloud_sync_token": config.token,
        }

        for key, value in configs_to_update.items():
            db_config = session.exec(select(Config).where(Config.key == key)).first()
            if not db_config:
                db_config = Config(key=key, value=value)
                session.add(db_config)
            else:
                db_config.value = value
                session.add(db_config)

        session.commit()

        # 重载配置管理器（内存缓存）
        cm = get_config_manager()
        await cm.load_from_db()

        # 重载同步服务
        await sync_service.reload()

        return {"status": "success", "message": "配置已更新，服务已重载"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from None


@router.get("/status")
async def get_sync_status():
    """获取连接状态"""
    status = "disconnected"
    if sync_service.running:
        if sync_service.mode == "server":
            status = "listening"
        elif sync_service.client and sync_service.client.websocket:
            # 基础检查，建议gateway_client暴露is_connected
            status = "connected"

    return {
        "running": sync_service.running,
        "mode": sync_service.mode,
        "status": status,
        "last_sync": "N/A",  # TODO: 追踪同步时间
    }


@router.get("/server-info")
async def get_server_info(_: None = Depends(verify_desktop_api_key)):
    """(Server模式) 获取本机连接信息"""
    # 读取本地Gateway Token
    token = ""
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.environ.get(
            "PERO_DATA_DIR", os.path.join(current_dir, "..", "data")
        )
        token_path = os.path.join(data_dir, "gateway_token.json")
        if os.path.exists(token_path):
            with open(token_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                token = data.get("token", "")
    except Exception:
        pass

    # 猜测IP（前端应显示localhost或询问用户），返回端口很有用
    return {
        "port": int(os.environ.get("PORT", "9120")),
        "token": token,
        "desktop_auth_required": desktop_auth_required(),
    }
