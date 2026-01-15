import asyncio
import json
import logging
from typing import Dict, List, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

class BrowserBridgeService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(BrowserBridgeService, cls).__new__(cls)
            cls._instance.initialized = False
        return cls._instance
    
    def __init__(self):
        if self.initialized:
            return
        self.connected_clients: List[WebSocket] = []
        self.client_activity: Dict[WebSocket, float] = {}
        self.latest_page_info: Optional[Dict[str, Any]] = None
        self.pending_commands: Dict[str, asyncio.Future] = {}
        self.page_update_future: Optional[asyncio.Future] = None
        self.cleanup_task: Optional[asyncio.Task] = None
        self.initialized = True
        logger.info("[BrowserBridge] Service initialized.")

    async def _cleanup_dead_connections(self):
        """定期清理超过 30 秒没有心跳的连接"""
        import time
        while True:
            await asyncio.sleep(10)
            now = time.time()
            to_remove = []
            for ws, last_time in self.client_activity.items():
                if now - last_time > 30:
                    logger.warning(f"[BrowserBridge] Client timed out, closing connection.")
                    to_remove.append(ws)
            
            for ws in to_remove:
                await self._close_connection(ws)

    async def _close_connection(self, websocket: WebSocket):
        if websocket in self.connected_clients:
            self.connected_clients.remove(websocket)
        if websocket in self.client_activity:
            del self.client_activity[websocket]
        try:
            await websocket.close()
        except:
            pass

    async def connect(self, websocket: WebSocket):
        import time
        # 启动清理死连接的任务 (确保在事件循环运行中启动)
        if self.cleanup_task is None or self.cleanup_task.done():
            self.cleanup_task = asyncio.create_task(self._cleanup_dead_connections())
            logger.info("[BrowserBridge] Cleanup task started.")

        await websocket.accept()
        self.connected_clients.append(websocket)
        self.client_activity[websocket] = time.time()
        logger.info(f"[BrowserBridge] Client connected. Total clients: {len(self.connected_clients)}")
        try:
            while True:
                data = await websocket.receive_text()
                self.client_activity[websocket] = time.time() # 更新活跃时间
                
                if data == "ping":
                    await websocket.send_text("pong")
                    continue
                await self._handle_message(data)
        except WebSocketDisconnect:
            await self._close_connection(websocket)
            logger.info(f"[BrowserBridge] Client disconnected. Total clients: {len(self.connected_clients)}")
            if not self.connected_clients:
                self.latest_page_info = None
        except Exception as e:
            logger.error(f"[BrowserBridge] WebSocket error: {e}")
            await self._close_connection(websocket)

    async def _handle_message(self, message_str: str):
        try:
            message = json.loads(message_str)
            msg_type = message.get("type")
            data = message.get("data", {})

            if msg_type == "pageInfoUpdate":
                self.latest_page_info = data
                # 如果正在等待页面更新，则解决它
                if self.page_update_future and not self.page_update_future.done():
                    self.page_update_future.set_result(data)

            elif msg_type == "command_result":
                request_id = data.get("requestId")
                if request_id and request_id in self.pending_commands:
                    future = self.pending_commands[request_id]
                    if not future.done():
                        future.set_result(data)
                        
        except json.JSONDecodeError:
            logger.error(f"[BrowserBridge] Failed to decode message: {message_str}")
        except Exception as e:
            logger.error(f"[BrowserBridge] Error handling message: {e}")

    async def send_command(self, command: str, target: Optional[str] = None, text: Optional[str] = None, url: Optional[str] = None, wait_for_page_info: bool = True) -> Dict[str, Any]:
        if not self.connected_clients:
            return {"status": "error", "error": "No browser connected. Please ensure the Pero Browser Extension is installed and running."}

        # 优先使用最近活跃的连接
        client = self.connected_clients[-1]
        request_id = f"req-{asyncio.get_event_loop().time()}"
        
        payload = {
            "type": "command",
            "data": {
                "requestId": request_id,
                "command": command,
                "target": target,
                "text": text,
                "url": url,
                "wait_for_page_info": wait_for_page_info
            }
        }

        # 创建一个 Future 以等待结果
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_commands[request_id] = future
        
        # 如果需要，准备等待页面更新
        if wait_for_page_info:
            # 如果存在旧的 Future，则取消它以避免泄漏？ 
            # 实际上只需创建一个新的。
            if self.page_update_future and not self.page_update_future.done():
                self.page_update_future.cancel()
            self.page_update_future = loop.create_future()

        try:
            await client.send_text(json.dumps(payload))
            logger.info(f"[BrowserBridge] Sent command: {command} (ID: {request_id})")
            
            # 等待命令结果（30 秒后超时）
            result = await asyncio.wait_for(future, timeout=30.0)
            
            # 如果命令成功且我们想要等待页面更新
            if result.get("status") == "success" and wait_for_page_info and self.page_update_future:
                try:
                    # 最多等待 5 秒以获取页面更新
                    await asyncio.wait_for(self.page_update_future, timeout=5.0)
                except asyncio.TimeoutError:
                    logger.warning("[BrowserBridge] Timed out waiting for pageInfoUpdate.")
                except asyncio.CancelledError:
                    pass
            
            return result
        except asyncio.TimeoutError:
            return {"status": "error", "error": "Command execution timed out."}
        except Exception as e:
            return {"status": "error", "error": f"Failed to send command: {str(e)}"}
        finally:
            if request_id in self.pending_commands:
                del self.pending_commands[request_id]
            # 重置页面更新 Future
            self.page_update_future = None

    def get_status(self) -> Dict[str, Any]:
        """获取当前连接状态"""
        return {
            "connected": len(self.connected_clients) > 0,
            "clients_count": len(self.connected_clients),
            "has_page_info": self.latest_page_info is not None,
            "last_active": list(self.client_activity.values())[-1] if self.client_activity else None
        }

    def get_current_page_markdown(self) -> str:
        if not self.connected_clients:
            return "Error: Browser extension not connected. Please ensure the Pero Browser Extension is installed and running."
        if not self.latest_page_info:
            return "Error: Connected to browser, but no page content received yet. Please try refreshing the page or navigating to a URL."
        return self.latest_page_info.get("markdown", "")

# 全局实例
browser_bridge_service = BrowserBridgeService()
