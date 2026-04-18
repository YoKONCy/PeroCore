import os
from typing import Optional

from fastapi import Header, HTTPException, WebSocket, WebSocketException, status

DESKTOP_API_KEY_ENV = "PERO_DESKTOP_API_KEY"
DESKTOP_API_KEY_HEADER = "x-pero-desktop-api-key"
SOCIAL_WS_SECRET_ENV = "PERO_SOCIAL_WS_SECRET"
SOCIAL_WS_SECRET_HEADER = "x-pero-social-ws-secret"
SOCIAL_WS_SECRET_QUERY = "token"


def get_desktop_api_key() -> str:
    return os.environ.get(DESKTOP_API_KEY_ENV, "").strip()


def desktop_auth_required() -> bool:
    return bool(get_desktop_api_key())


def get_social_ws_secret() -> str:
    return os.environ.get(SOCIAL_WS_SECRET_ENV, "").strip()


def social_ws_auth_required() -> bool:
    return bool(get_social_ws_secret())


def resolve_social_ws_secret(websocket: WebSocket) -> Optional[str]:
    authorization = websocket.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token

    header_secret = websocket.headers.get(SOCIAL_WS_SECRET_HEADER)
    if header_secret:
        return header_secret.strip()

    query_secret = websocket.query_params.get(SOCIAL_WS_SECRET_QUERY)
    if query_secret:
        return query_secret.strip()

    return None


def verify_social_ws_secret(websocket: WebSocket) -> None:
    expected = get_social_ws_secret()
    if not expected:
        return

    provided = resolve_social_ws_secret(websocket)
    if not provided or provided != expected:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid social websocket secret",
        )


async def verify_desktop_api_key(
    x_pero_desktop_api_key: Optional[str] = Header(
        default=None, alias=DESKTOP_API_KEY_HEADER
    ),
) -> None:
    expected = get_desktop_api_key()
    if not expected:
        return

    if not x_pero_desktop_api_key or x_pero_desktop_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid desktop API key")
