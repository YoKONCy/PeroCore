import asyncio
import logging
import json
import os
from typing import Dict, Any, List, Optional, Union
import httpx

logger = logging.getLogger(__name__)

class McpClient:
    """
    MCP Client for Pero.
    Supports connecting to MCP servers via HTTP (SSE) or Stdio (Subprocess).
    """
    def __init__(
        self, 
        config: Dict[str, Any],
        timeout: float = 30.0
    ):
        """
        :param config: Configuration dict.
               For HTTP: {"type": "sse", "url": "...", "api_key": "..."}
               For Stdio: {"type": "stdio", "command": "...", "args": [...], "env": {...}}
        """
        self.config = config
        self.name = config.get("name", "Unknown-MCP")
        self.timeout = timeout
        self._initialized = False
        self._request_id = 0
        
        # Transport specific
        self.transport_type = config.get("type", "sse")
        
        # HTTP/SSE state
        self.http_client = None
        
        # Stdio state
        self.process = None
        self.pending_requests: Dict[int, asyncio.Future] = {}
        self.read_task = None
        
        if self.transport_type == "sse":
            base_url = config.get("url", "").rstrip('/')
            self.mcp_endpoint = f"{base_url}/mcp"
            self.api_key = config.get("api_key")
            
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
            if self.api_key:
                headers['Authorization'] = f'Bearer {self.api_key}'
            
            self.http_client = httpx.AsyncClient(timeout=timeout, headers=headers)
            
    def _next_request_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def _start_stdio_process(self):
        if self.process: return
        
        loop = asyncio.get_running_loop()
        logger.info(f"[MCP] Starting stdio process with loop: {loop.__class__.__name__}")
        
        command = self.config.get("command")
        args = self.config.get("args", [])
        env_vars = self.config.get("env", {})
        
        # Merge with current environment but allow override
        current_env = os.environ.copy()
        current_env.update(env_vars)
        
        # Debug: Check specific keys (masked)
        debug_env = {}
        for k, v in env_vars.items():
            if "KEY" in k.upper() or "TOKEN" in k.upper() or "SECRET" in k.upper():
                debug_env[k] = f"{v[:4]}...{v[-4:]}" if v and len(v) > 8 else "***"
            else:
                debug_env[k] = v
        logger.info(f"[MCP] Starting process with extra env: {debug_env}")

        try:
            cmd_lower = command.lower().strip()
            if os.name == 'nt' and (cmd_lower == 'npx' or cmd_lower == 'npm'):
                # On Windows, npx/npm are batch files, better to use shell
                full_command = f"{cmd_lower} {' '.join(args)}"
                self.process = await asyncio.create_subprocess_shell(
                    full_command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=current_env
                )
            else:
                self.process = await asyncio.create_subprocess_exec(
                    command, *args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=current_env
                )
            
            # Start reader tasks
            self.read_task = asyncio.create_task(self._stdio_reader())
            self.stderr_task = asyncio.create_task(self._stderr_reader())
            
            logger.info(f"[MCP] Started stdio process: {command} {args} (shell={os.name == 'nt' and (command == 'npx' or command == 'npm')})")
            
        except Exception as e:
            logger.error(f"[MCP] Failed to start stdio process: {e}")
            raise

    async def _stderr_reader(self):
        """Read stderr for logging"""
        while True:
            try:
                line = await self.process.stderr.readline()
                if not line:
                    break
                line_str = line.decode().strip()
                if line_str:
                    logger.warning(f"[MCP-STDERR] {line_str}")
                    print(f"[MCP-STDERR] {line_str}")
            except Exception as e:
                logger.error(f"[MCP] Stderr reader error: {e}")
                print(f"[MCP] Stderr reader error: {e}")
                break

    async def _stdio_reader(self):
        """Background task to read from stdout of the subprocess"""
        while True:
            try:
                line = await self.process.stdout.readline()
                if not line:
                    break
                    
                line_str = line.decode().strip()
                if not line_str: continue
                
                # logger.debug(f"[MCP-STDIO] {line_str}") # Enable for raw debug
                print(f"[MCP-STDIO] {line_str}")

                try:
                    data = json.loads(line_str)
                    
                    # Handle Response
                    if "id" in data and data["id"] in self.pending_requests:
                        future = self.pending_requests.pop(data["id"])
                        if not future.done():
                            if "error" in data:
                                future.set_exception(Exception(data["error"]))
                            else:
                                future.set_result(data.get("result"))
                                
                    # Handle Notification (logging for now)
                    elif "method" in data:
                        logger.debug(f"[MCP] Notification: {data}")
                        
                except json.JSONDecodeError:
                    logger.warning(f"[MCP] Invalid JSON from stdio: {line_str}")
                    
            except Exception as e:
                logger.error(f"[MCP] Reader error: {e}")
                break
        
        logger.info("[MCP] Stdio reader terminated")

    async def _mcp_request(self, method: str, params: Dict[str, Any] = None) -> Any:
        req_id = self._next_request_id()
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
        }
        if params:
            payload["params"] = params

        if self.transport_type == "stdio":
            if not self.process:
                await self._start_stdio_process()
                
            future = asyncio.Future()
            self.pending_requests[req_id] = future
            
            json_str = json.dumps(payload) + "\n"
            self.process.stdin.write(json_str.encode())
            await self.process.stdin.drain()
            
            try:
                return await asyncio.wait_for(future, timeout=self.timeout)
            except asyncio.TimeoutError:
                if req_id in self.pending_requests:
                    del self.pending_requests[req_id]
                raise TimeoutError(f"MCP Request {method} timed out")
                
        else: # SSE / HTTP
            try:
                resp = await self.http_client.post(self.mcp_endpoint, json=payload)
                resp.raise_for_status()
                
                content_type = resp.headers.get('content-type', '')
                
                if 'text/event-stream' in content_type:
                    # SSE parsing (Simulated for single response)
                    response_text = resp.text
                    lines = response_text.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line.startswith('data:'):
                            json_str = line[5:].strip()
                            if not json_str: continue
                            try:
                                result = json.loads(json_str)
                                if "error" in result:
                                    logger.error(f"[MCP] Error: {result['error']}")
                                    return None
                                return result.get("result") if "result" in result else result
                            except json.JSONDecodeError:
                                continue
                    return None
                else:
                    result = resp.json()
                    if "error" in result:
                        logger.error(f"[MCP] Error: {result['error']}")
                        return None
                    return result.get("result")
                    
            except Exception as e:
                logger.error(f"[MCP] Request {method} failed: {e}")
                return None

    async def initialize(self) -> bool:
        if self._initialized: return True
        try:
            result = await self._mcp_request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "Pero-MCP-Client", "version": "1.0.0"}
            })
            
            if result:
                self._initialized = True
                # Send initialized notification
                if self.transport_type == "stdio":
                    notify_payload = {
                        "jsonrpc": "2.0",
                        "method": "notifications/initialized"
                    }
                    self.process.stdin.write((json.dumps(notify_payload) + "\n").encode())
                    await self.process.stdin.drain()
                return True
            return False
        except Exception as e:
            logger.error(f"[MCP] Initialization failed: {e}")
            return False

    async def list_tools(self) -> List[Dict[str, Any]]:
        if not self._initialized: await self.initialize()
        result = await self._mcp_request("tools/list", {})
        return result.get("tools", []) if result else []

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        if not self._initialized: await self.initialize()
        result = await self._mcp_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })
        return result

    async def close(self):
        if self.http_client:
            await self.http_client.aclose()
        if self.process:
            try:
                self.process.terminate()
                await self.process.wait()
            except:
                pass
