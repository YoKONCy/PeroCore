from fastapi import APIRouter, WebSocket

from core.desktop_auth import verify_desktop_websocket_api_key
from services.interaction.browser_bridge_service import browser_bridge_service

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/browser")
async def websocket_browser_endpoint(websocket: WebSocket):
    """
    浏览器桥接 WebSocket 终点
    用于实现与浏览器插件或外部脚本的通信
    """
    verify_desktop_websocket_api_key(websocket)
    await browser_bridge_service.connect(websocket)


@router.websocket("/ws/gateway")
async def websocket_gateway_endpoint(websocket: WebSocket):
    """
    Gateway Hub WebSocket 终点
    核心实时消息分发中心喵！✨
    """
    verify_desktop_websocket_api_key(websocket)
    from services.core.gateway_hub import gateway_hub

    await gateway_hub.handle_connection(websocket)
