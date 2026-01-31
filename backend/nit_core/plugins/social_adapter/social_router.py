from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from .social_service import get_social_service
import logging
import json

router = APIRouter(prefix="/api/social", tags=["social"])
logger = logging.getLogger(__name__)

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    service = get_social_service()
    
    # Check if social mode is enabled
    if not service.enabled:
        await websocket.close(code=1008, reason="Social mode disabled")
        return

    service.active_ws = websocket
    logger.info("[Social] WebSocket connected from NapCat.")
    
    try:
        while True:
            data = await websocket.receive_text()
            # 仅打印简短日志证明收到数据，避免刷屏
            if len(data) > 0:
                # 尝试简单解析一下类型，方便调试
                try:
                    preview = json.loads(data)
                    ptype = preview.get("post_type", "unknown")
                    if ptype != "meta_event": # 忽略心跳
                        logger.info(f"[Social-WS] 收到事件: {ptype}, length={len(data)}")
                except:
                    logger.debug(f"[Social-WS] 收到数据: {len(data)} chars")
            
            # Dispatch to service for async processing
            # We assume handle_raw_event is fire-and-forget or returns quickly
            await service.handle_raw_event(data)
            
    except WebSocketDisconnect:
        logger.info("[Social] WebSocket disconnected.")
        service.active_ws = None
    except Exception as e:
        logger.error(f"[Social] WebSocket error: {e}", exc_info=True)
        if service.active_ws == websocket:
            service.active_ws = None
