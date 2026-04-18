import os
from typing import Optional

from fastapi import Header, HTTPException

DESKTOP_API_KEY_ENV = "PERO_DESKTOP_API_KEY"
DESKTOP_API_KEY_HEADER = "x-pero-desktop-api-key"


def get_desktop_api_key() -> str:
    return os.environ.get(DESKTOP_API_KEY_ENV, "").strip()


def desktop_auth_required() -> bool:
    return bool(get_desktop_api_key())


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
