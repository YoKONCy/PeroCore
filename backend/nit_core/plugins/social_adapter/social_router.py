import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, WebSocketException, status

from core.desktop_auth import (
    SOCIAL_WS_SECRET_HEADER,
    SOCIAL_WS_SECRET_QUERY,
    social_ws_auth_required,
    verify_social_ws_secret,
)

from .social_service import get_social_service

router = APIRouter(prefix="/api/social", tags=["social"])
logger = logging.getLogger(__name__)


@router.get("/status")
async def get_social_status():
    service = get_social_service()
    status = await service.get_connection_status()
    return {
        "enabled": service.enabled,
        "ws_auth_required": social_ws_auth_required(),
        "ws_auth_header": SOCIAL_WS_SECRET_HEADER,
        "ws_auth_query": SOCIAL_WS_SECRET_QUERY,
        **status,
    }


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    service = get_social_service()

    # 检查社交模式是否启用
    if not service.enabled:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Social mode disabled",
        )

    verify_social_ws_secret(websocket)
    await websocket.accept()

    # [多 Agent 支持] 从请求头中提取 X-Self-ID
    # NapCat 发送 X-Self-ID 以指示此连接属于哪个 QQ 账号。
    x_self_id = websocket.headers.get("x-self-id")

    # 注册连接
    service.register_connection(x_self_id, websocket)

    if x_self_id:
        logger.info(f"[Social] WebSocket 已连接 QQ: {x_self_id}")
    else:
        logger.info("[Social] WebSocket 已连接 (无 X-Self-ID，作为默认/回退连接)。")

    try:
        while True:
            data = await websocket.receive_text()
            # 仅打印简短日志证明收到数据，避免刷屏
            if len(data) > 0:
                # 尝试简单解析一下类型，方便调试
                try:
                    preview = json.loads(data)
                    ptype = preview.get("post_type")

                    # 尝试细化事件类型的显示
                    sub_type = ""
                    if ptype:
                        # 标准 OneBot 事件
                        if ptype == "meta_event":
                            sub_type = f" ({preview.get('meta_event_type', '')})"
                        elif ptype == "notice":
                            sub_type = f" ({preview.get('notice_type', '')})"
                        elif ptype == "request":
                            sub_type = f" ({preview.get('request_type', '')})"
                    else:
                        # 无 post_type，可能是 API 响应或其他
                        if "status" in preview:
                            ptype = "api_response"
                            echo_info = (
                                f", echo: {preview.get('echo')}"
                                if "echo" in preview
                                else ""
                            )
                            sub_type = f" (status: {preview.get('status')}{echo_info})"
                        else:
                            ptype = "unknown"
                            # 记录键名以供调试
                            keys = list(preview.keys())
                            sub_type = f" (keys: {keys})"

                    if ptype != "meta_event":  # 忽略心跳
                        logger.info(
                            f"[Social-WS] 收到事件: {ptype}{sub_type}, length={len(data)}"
                        )
                    else:
                        # 对于心跳，仅使用 debug 级别，防止刷屏
                        logger.debug(
                            f"[Social-WS] 收到心跳: {preview.get('meta_event_type')}"
                        )
                except Exception:
                    logger.debug(f"[Social-WS] 收到数据: {len(data)} chars")

            # 分发给服务进行异步处理
            await service.handle_raw_event(data)

    except WebSocketDisconnect:
        logger.info(f"[Social] WebSocket 已断开连接 (QQ: {x_self_id})。")
        service.unregister_connection(x_self_id)
    except Exception as e:
        service.record_error(e)
        logger.error(f"[Social] WebSocket 错误: {e}", exc_info=True)
        if x_self_id:
            service.unregister_connection(x_self_id)
        elif service.active_ws == websocket:
            service.active_ws = None
