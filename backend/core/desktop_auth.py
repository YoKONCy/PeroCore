import os
from typing import Optional

from fastapi import Header, HTTPException, Request, Response, WebSocket, WebSocketException, status

DESKTOP_API_KEY_ENV = "PERO_DESKTOP_API_KEY"
DESKTOP_API_KEY_HEADER = "x-pero-desktop-api-key"
DESKTOP_API_KEY_QUERY = "api_key"
DESKTOP_API_KEY_COOKIE = "pero_desktop_auth"
SOCIAL_WS_SECRET_ENV = "PERO_SOCIAL_WS_SECRET"
SOCIAL_WS_SECRET_HEADER = "x-pero-social-ws-secret"
SOCIAL_WS_SECRET_QUERY = "token"
PUBLIC_DESKTOP_AUTH_PATHS = frozenset(
    {
        "/api/system/health",
        "/api/system/ping",
        "/api/system/auth/status",
        "/api/system/auth/validate",
        "/web-unlock",
    }
)


def _resolve_auth_value(
    authorization: str = "",
    header_value: Optional[str] = None,
    query_value: Optional[str] = None,
    cookie_value: Optional[str] = None,
) -> Optional[str]:
    if authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()
        if bearer_token:
            return bearer_token

    if header_value:
        trimmed_header = header_value.strip()
        if trimmed_header:
            return trimmed_header

    if query_value:
        trimmed_query = query_value.strip()
        if trimmed_query:
            return trimmed_query

    if cookie_value:
        trimmed_cookie = cookie_value.strip()
        if trimmed_cookie:
            return trimmed_cookie

    return None


def get_desktop_api_key() -> str:
    return os.environ.get(DESKTOP_API_KEY_ENV, "").strip()


def desktop_auth_required() -> bool:
    return bool(get_desktop_api_key())


def request_requires_desktop_auth(request: Request) -> bool:
    if not desktop_auth_required():
        return False

    path = request.url.path
    if path in PUBLIC_DESKTOP_AUTH_PATHS:
        return False

    if path.startswith("/api/"):
        return True

    return path == "/" or path == "/web" or path.startswith("/web/")


def resolve_desktop_api_key(request: Request) -> Optional[str]:
    return _resolve_auth_value(
        authorization=request.headers.get("authorization", "").strip(),
        header_value=request.headers.get(DESKTOP_API_KEY_HEADER),
        query_value=request.query_params.get(DESKTOP_API_KEY_QUERY),
        cookie_value=request.cookies.get(DESKTOP_API_KEY_COOKIE),
    )


def resolve_desktop_api_key_websocket(websocket: WebSocket) -> Optional[str]:
    return _resolve_auth_value(
        authorization=websocket.headers.get("authorization", "").strip(),
        header_value=websocket.headers.get(DESKTOP_API_KEY_HEADER),
        query_value=websocket.query_params.get(DESKTOP_API_KEY_QUERY),
        cookie_value=websocket.cookies.get(DESKTOP_API_KEY_COOKIE),
    )


def has_valid_desktop_api_key(provided: Optional[str]) -> bool:
    expected = get_desktop_api_key()
    if not expected:
        return True

    return bool(provided) and provided == expected


def set_desktop_auth_cookie(response: Response, api_key: str, *, secure: bool) -> None:
    response.set_cookie(
        key=DESKTOP_API_KEY_COOKIE,
        value=api_key,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_desktop_auth_cookie(response: Response, *, secure: bool) -> None:
    response.delete_cookie(
        key=DESKTOP_API_KEY_COOKIE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def verify_desktop_websocket_api_key(websocket: WebSocket) -> None:
    if not desktop_auth_required():
        return

    provided = resolve_desktop_api_key_websocket(websocket)
    if not has_valid_desktop_api_key(provided):
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid desktop API key",
        )


def get_social_ws_secret() -> str:
    return os.environ.get(SOCIAL_WS_SECRET_ENV, "").strip()


def social_ws_auth_required() -> bool:
    return bool(get_social_ws_secret())


def resolve_social_ws_secret(websocket: WebSocket) -> Optional[str]:
    return _resolve_auth_value(
        authorization=websocket.headers.get("authorization", "").strip(),
        header_value=websocket.headers.get(SOCIAL_WS_SECRET_HEADER),
        query_value=websocket.query_params.get(SOCIAL_WS_SECRET_QUERY),
    )


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
    request: Request,
    x_pero_desktop_api_key: Optional[str] = Header(
        default=None, alias=DESKTOP_API_KEY_HEADER
    ),
) -> None:
    if not desktop_auth_required():
        return

    provided = x_pero_desktop_api_key.strip() if x_pero_desktop_api_key else None
    if not provided:
        provided = resolve_desktop_api_key(request)

    if not has_valid_desktop_api_key(provided):
        raise HTTPException(status_code=401, detail="Invalid desktop API key")
