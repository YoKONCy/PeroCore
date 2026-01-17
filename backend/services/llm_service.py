import httpx
import json
import asyncio
import base64
import os
from typing import AsyncIterable, List, Dict, Any, Optional
from google import genai
from google.genai import types

class LLMService:
    def __init__(self, api_key: str, api_base: str, model: str, provider: str = "openai"):
        self.api_key = api_key.strip() if api_key else ""
        # 清洗 api_base: 去空格, 去末尾斜杠
        self.api_base = api_base.strip().rstrip('/') if api_base else "https://api.openai.com"
        self.model = model
        self.provider = provider or "openai"

    def _get_url(self, endpoint: str) -> str:
        """根据 endpoint 自动拼接正确的 URL"""
        if endpoint == "chat":
            suffix = "/chat/completions"
        elif endpoint == "models":
            suffix = "/models"
        else:
            suffix = endpoint

        if self.api_base.endswith("/v1"):
            return f"{self.api_base}{suffix}"
        return f"{self.api_base}/v1{suffix}"

    async def chat(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None, response_format: Optional[Dict] = None) -> Dict[str, Any]:
        # [Fix] 智能纠错：如果模型名称明显属于 Gemini 但 Provider 被误设为 Anthropic，
        # 或者用户正在使用 OneAPI/NewAPI 转发 Gemini 模型（通常通过 OpenAI 协议），
        # 则强制回退到默认的 OpenAI 兼容模式。
        if self.provider in ["claude", "anthropic"] and "gemini" in self.model.lower():
             print(f"[LLMService] Detected Gemini model '{self.model}' with Anthropic provider. Falling back to OpenAI-compatible protocol for OneAPI/Aggregator compatibility.")
             # 不执行 return，直接向下流转到默认的 OpenAI 逻辑
        elif self.provider == "gemini":
            return await self._chat_gemini(messages, temperature, tools)
        elif self.provider in ["claude", "anthropic"]:
            return await self._chat_anthropic(messages, temperature, tools)
            
        url = self._get_url("chat")
        headers = {
            "Content-Type": "application/json"
        }
        # 只有当 api_key 存在时才添加 Authorization 头
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": False
        }
        
        if response_format:
            payload["response_format"] = response_format
        
        # 调试：打印 payload 结构（不包含大型 base64 数据）
        debug_payload = json.loads(json.dumps(payload))
        for msg in debug_payload.get("messages", []):
            content = msg.get("content")
            if isinstance(content, list):
                for item in content:
                    if item.get("type") == "input_audio":
                        item["input_audio"]["data"] = f"<{len(item['input_audio']['data'])} bytes base64>"
                    elif item.get("type") == "image_url":
                        item["image_url"]["url"] = f"<{len(item['image_url']['url'])} bytes data_url>"
        print(f"[LLM] 请求 Payload: {json.dumps(debug_payload, indent=2, ensure_ascii=False)}")

        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                error_text = response.text
                # 清洗 HTML 错误
                if "<html" in error_text.lower() or "<!doctype" in error_text.lower():
                    import re
                    title_match = re.search(r'<title>(.*?)</title>', error_text, re.IGNORECASE)
                    if title_match:
                        error_text = f"Network Error ({response.status_code}): {title_match.group(1)}"
                    else:
                        error_text = f"Network Error ({response.status_code}): HTML Response"
                
                print(f"[LLM] 错误响应: {error_text}")
                raise Exception(f"LLM 错误: {response.status_code} - {error_text}")
            return response.json()

    async def _chat_gemini(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Gemini 原生 API 调用 (使用 google-genai SDK)"""
        try:
            client = genai.Client(api_key=self.api_key)
            
            # 转换消息格式
            contents = self._convert_to_genai_contents(messages)
            
            # 提取系统指令
            system_instruction = None
            history = []
            for content in contents:
                if content.role == "system":
                    # 系统指令通常放在 GenerateContentConfig 中
                    system_instruction = content.parts[0].text
                else:
                    history.append(content)
            
            # 转换工具
            genai_tools = self._convert_tools_to_genai(tools)
            
            # 配置
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=temperature,
                tools=genai_tools,
                safety_settings=[
                    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                ]
            )

            # 异步调用
            response = await client.aio.models.generate_content(
                model=self.model,
                contents=history,
                config=config
            )
            
            # 处理响应
            content_text = ""
            try:
                content_text = response.text
            except:
                pass
                
            message = {
                "role": "assistant",
                "content": content_text
            }
            
            # 检查 function call
            if response.candidates and response.candidates[0].content.parts:
                tool_calls = []
                for part in response.candidates[0].content.parts:
                    if part.function_call:
                        import uuid
                        call_id = f"call_{uuid.uuid4().hex[:8]}"
                        tool_calls.append({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": part.function_call.name,
                                "arguments": json.dumps(part.function_call.args)
                            }
                        })
                if tool_calls:
                    message["tool_calls"] = tool_calls
                    if not message["content"]:
                        message["content"] = None

            return {
                "choices": [{
                    "message": message
                }]
            }
        except Exception as e:
            print(f"[Gemini] 错误: {e}")
            raise

    def _convert_to_genai_contents(self, messages: List[Dict[str, Any]]) -> List[types.Content]:
        """将 OpenAI 消息格式转换为 Gemini GenAI Content 格式"""
        contents = []
        for msg in messages:
            role = msg["role"]
            # GenAI 角色：user, model, system
            if role == "assistant":
                role = "model"
            elif role == "tool":
                # Tool 响应在 GenAI 中比较特殊，通常作为 model 发起调用后的后续 user 消息中的 function_response
                # 或者有专门的 role。但在 SDK 中通常映射为 'user' 角色下的 function_response
                role = "user" 

            parts = []
            
            # 1. 处理 tool_calls (Assistant 发起的调用)
            if role == "model" and "tool_calls" in msg and msg["tool_calls"]:
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    if func:
                        try:
                            args = json.loads(func.get("arguments", "{}"))
                        except:
                            args = {}
                        parts.append(types.Part(
                            function_call=types.FunctionCall(
                                name=func.get("name"),
                                args=args
                            )
                        ))
            
            # 2. 处理 content (文本/多模态)
            content = msg.get("content")
            if content:
                if isinstance(content, str):
                    parts.append(types.Part(text=content))
                elif isinstance(content, list):
                    for item in content:
                        if item["type"] == "text":
                            parts.append(types.Part(text=item["text"]))
                        elif item["type"] == "input_audio":
                            try:
                                audio_data = item["input_audio"]["data"]
                                parts.append(types.Part(
                                    inline_data=types.Blob(
                                        mime_type=f"audio/{item['input_audio']['format']}",
                                        data=base64.b64decode(audio_data)
                                    )
                                ))
                            except Exception as e:
                                print(f"[Gemini] 音频解码错误: {e}")
                        elif item["type"] == "image_url":
                            try:
                                url = item["image_url"]["url"]
                                if url.startswith("data:"):
                                    header, data = url.split(",", 1)
                                    mime_type = header.split(";")[0].split(":")[1]
                                    parts.append(types.Part(
                                        inline_data=types.Blob(
                                            mime_type=mime_type,
                                            data=base64.b64decode(data)
                                        )
                                    ))
                            except Exception as e:
                                print(f"[Gemini] 图片解码错误: {e}")

            # 3. 处理 tool 响应 (Tool 输出)
            if msg["role"] == "tool":
                tool_name = msg.get("name", "unknown_tool")
                parts.append(types.Part(
                    function_response=types.FunctionResponse(
                        name=tool_name,
                        response={"result": content}
                    )
                ))

            if parts:
                contents.append(types.Content(role=role, parts=parts))
        return contents

    def _convert_tools_to_genai(self, openai_tools: List[Dict]) -> List[types.Tool]:
        """将 OpenAI 工具定义转换为 Gemini GenAI Tool 格式"""
        if not openai_tools:
            return None
        
        declarations = []
        for tool in openai_tools:
            if tool.get("type") == "function":
                func = tool["function"]
                # 转换 parameters 结构，GenAI 也是 JSON Schema，但可能需要稍微调整
                declarations.append(types.FunctionDeclaration(
                    name=func.get("name"),
                    description=func.get("description"),
                    parameters=func.get("parameters")
                ))
        
        if not declarations:
            return None

        return [types.Tool(function_declarations=declarations)]

    async def _chat_gemini_stream(self, messages: List[Dict[str, Any]], temperature: float, model_id: str, api_key: str, tools: List[Dict] = None) -> AsyncIterable[Dict[str, Any]]:
        """Gemini 原生 API 流式调用 (使用 google-genai SDK)"""
        try:
            client = genai.Client(api_key=api_key)
            contents = self._convert_to_genai_contents(messages)
            
            system_instruction = None
            history = []
            for content in contents:
                if content.role == "system":
                    system_instruction = content.parts[0].text
                else:
                    history.append(content)
            
            genai_tools = self._convert_tools_to_genai(tools)
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=temperature,
                tools=genai_tools,
                safety_settings=[
                    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                ]
            )

            async for chunk in client.aio.models.generate_content_stream(
                model=model_id,
                contents=history,
                config=config
            ):
                # 处理 Function Call
                if chunk.candidates and chunk.candidates[0].content.parts:
                    for part in chunk.candidates[0].content.parts:
                        if part.function_call:
                            import uuid
                            call_id = f"call_{uuid.uuid4().hex[:8]}"
                            yield {
                                "tool_calls": [{
                                    "index": 0,
                                    "id": call_id,
                                    "function": {
                                        "name": part.function_call.name,
                                        "arguments": json.dumps(part.function_call.args)
                                    }
                                }]
                            }

                # 处理文本
                try:
                    if chunk.text:
                        yield {"content": chunk.text}
                except:
                    pass
                
        except Exception as e:
            print(f"[Gemini Stream] Error: {e}")
            yield {"content": f"Error: {str(e)}"}

    # --- Anthropic (Claude) 支持 ---

    async def _chat_anthropic(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Anthropic 原生 API 调用"""
        system_prompt, anthropic_messages = self._convert_to_anthropic_format(messages)
        anthropic_tools = self._convert_tools_to_anthropic(tools)

        # 默认 URL
        url = "https://api.anthropic.com/v1/messages"
        if self.api_base and self.api_base != "https://api.openai.com":
             # 自动处理 /v1 后缀
             if self.api_base.endswith("/v1/messages"):
                 url = self.api_base
             elif self.api_base.endswith("/v1"):
                 url = f"{self.api_base}/messages"
             else:
                 url = f"{self.api_base}/v1/messages"

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }

        payload = {
            "model": self.model,
            "messages": anthropic_messages,
            "max_tokens": 4096, # Anthropic 必须字段
            "temperature": temperature,
            "stream": False
        }
        
        if system_prompt:
            payload["system"] = system_prompt
            
        if anthropic_tools:
            payload["tools"] = anthropic_tools

        print(f"[Anthropic] 请求 Payload: {json.dumps({k:v for k,v in payload.items() if k!='messages'}, indent=2)}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                print(f"[Anthropic] 错误响应: {response.text}")
                raise Exception(f"Anthropic 错误: {response.status_code} - {response.text}")
            
            data = response.json()
            
            # 转换回 OpenAI 格式
            content_blocks = data.get("content", [])
            text_content = ""
            tool_calls = []
            
            for block in content_blocks:
                if block["type"] == "text":
                    text_content += block["text"]
                elif block["type"] == "tool_use":
                    tool_calls.append({
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block["input"])
                        }
                    })
            
            message = {
                "role": "assistant",
                "content": text_content if text_content else None
            }
            
            if tool_calls:
                message["tool_calls"] = tool_calls

            return {
                "choices": [{
                    "message": message,
                    "finish_reason": data.get("stop_reason")
                }]
            }

    async def _chat_anthropic_stream(self, messages: List[Dict[str, Any]], temperature: float, model_id: str, api_key: str, tools: List[Dict] = None) -> AsyncIterable[Dict[str, Any]]:
        """Anthropic 原生 API 流式调用"""
        system_prompt, anthropic_messages = self._convert_to_anthropic_format(messages)
        anthropic_tools = self._convert_tools_to_anthropic(tools)

        url = "https://api.anthropic.com/v1/messages"
        # 检查 api_base 是否为自定义
        # 注意：self.api_base 可能是实例的，但如果在方法内部，我们应该使用传入的，
        # 但这里我们使用传递给此函数的 'api_base' 参数。
        # 等等，self.api_base 是可用的。让我们检查一下逻辑。
        # 传入的参数是覆盖项。
        
        base_url = self.api_base
        # 来自 chat_stream_deltas 的逻辑：
        # api_base = model_config.api_base ...
        # 但这里我们没有传递 model_config，我们有 api_key。
        # 如果 api_key 匹配 self.api_key，我们可能应该使用 self.api_base，或者如果没有提供则假设为标准。
        # 实际上，除非 self.api_base 设置为其他内容，否则我们只使用硬编码的标准。
        if hasattr(self, 'api_base') and self.api_base and "api.openai.com" not in self.api_base:
             # 如果用户为此提供商设置了自定义 base
             base_url = self.api_base
        else:
             base_url = "https://api.anthropic.com"

        if base_url.endswith("/v1/messages"):
            url = base_url
        elif base_url.endswith("/v1"):
            url = f"{base_url}/messages"
        else:
            url = f"{base_url}/v1/messages"

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }

        payload = {
            "model": model_id,
            "messages": anthropic_messages,
            "max_tokens": 4096,
            "temperature": temperature,
            "stream": True
        }
        
        if system_prompt:
            payload["system"] = system_prompt
            
        if anthropic_tools:
            payload["tools"] = anthropic_tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    yield {"content": f"错误: {response.status_code} - {await response.aread()}"}
                    return

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                        
                    try:
                        event_data = json.loads(data_str)
                        type_ = event_data.get("type")
                        
                        if type_ == "content_block_delta":
                            delta = event_data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield {"content": delta.get("text", "")}
                            # Anthropic 中的工具使用增量处理很复杂 (json patching)
                            # 目前仅支持简单处理，如果复杂则忽略部分工具参数
                            
                        elif type_ == "message_delta":
                            # stop_reason, usage 等
                            pass
                            
                        # 注意：Anthropic 流式工具调用方式不同。
                        # 支持流式工具调用需要状态机来重构 JSON。
                        # 为了简化，本次迭代可能不会完全支持流式工具调用
                        # 或者如果思考过程是文本，我们仅依赖文本内容。
                        
                    except Exception as e:
                        # print(f"Stream decode error: {e}")
                        pass

    def _convert_to_anthropic_format(self, messages: List[Dict[str, Any]]) -> tuple[str, List[Dict[str, Any]]]:
        """
        转换 OpenAI 消息到 Anthropic 格式
        返回: (system_prompt, anthropic_messages)
        """
        system_prompt = ""
        anthropic_msgs = []
        
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            
            if role == "system":
                system_prompt += str(content) + "\n"
                continue
                
            if role == "tool":
                # Anthropic 使用 'user' 角色作为工具结果
                # 内容应该是块
                # [
                #   {
                #     "type": "tool_result",
                #     "tool_use_id": "...",
                #     "content": "..."
                #   }
                # ]
                # 但我们需要从某处获取 tool_call_id。
                # OpenAI 消息包含 'tool_call_id'。
                tool_call_id = msg.get("tool_call_id")
                anthropic_msgs.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": str(content)
                    }]
                })
                continue

            # Assistant 工具调用
            if role == "assistant" and msg.get("tool_calls"):
                blocks = []
                if content:
                    blocks.append({"type": "text", "text": str(content)})
                
                for tc in msg["tool_calls"]:
                    func = tc["function"]
                    blocks.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": func["name"],
                        "input": json.loads(func["arguments"])
                    })
                anthropic_msgs.append({"role": "assistant", "content": blocks})
                continue
            
            # 普通文本消息
            # Anthropic 期望内容为字符串或块列表
            anthropic_msgs.append({
                "role": role,
                "content": content
            })
            
        return system_prompt.strip(), anthropic_msgs

    def _convert_tools_to_anthropic(self, tools: List[Dict]) -> List[Dict]:
        if not tools:
            return None
        
        anthropic_tools = []
        for tool in tools:
            if tool.get("type") == "function":
                func = tool["function"]
                anthropic_tools.append({
                    "name": func.get("name"),
                    "description": func.get("description"),
                    "input_schema": func.get("parameters")
                })
        return anthropic_tools

    async def list_models(self) -> List[str]:
        """获取模型列表"""
        if self.provider == "gemini":
            try:
                client = genai.Client(api_key=self.api_key)
                models = await asyncio.to_thread(client.models.list)
                return [m.name for m in models if "generateContent" in m.supported_generation_methods]
            except Exception as e:
                print(f"[Gemini] Failed to list models: {e}")
                return ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"]
        
        elif self.provider in ["claude", "anthropic"]:
            # Anthropic specific implementation
            url = "https://api.anthropic.com/v1/models"
            if self.api_base and self.api_base != "https://api.openai.com":
                 url = f"{self.api_base}/v1/models" if not self.api_base.endswith("/models") else self.api_base
            
            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            try:
                print(f"Fetching models from: {url}")
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(url, headers=headers)
                    
                    if response.status_code != 200:
                        print(f"[Anthropic] Remote API Error: {response.status_code} - {response.text}")
                        # Fallback list
                        return [
                            "claude-3-5-sonnet-20240620",
                            "claude-3-opus-20240229",
                            "claude-3-sonnet-20240229",
                            "claude-3-haiku-20240307"
                        ]
                    
                    data = response.json()
                    model_list = []
                    # Anthropic 返回 {"data": [...]}
                    if "data" in data and isinstance(data["data"], list):
                        model_list = data["data"]
                    
                    ids = []
                    for m in model_list:
                        if isinstance(m, dict) and "id" in m:
                            ids.append(m["id"])
                    
                    return sorted(ids) if ids else [
                        "claude-3-5-sonnet-20240620",
                        "claude-3-opus-20240229",
                        "claude-3-sonnet-20240229",
                        "claude-3-haiku-20240307"
                    ]
            except Exception as e:
                print(f"[Anthropic] 获取模型列表错误: {e}")
                return [
                    "claude-3-5-sonnet-20240620",
                    "claude-3-opus-20240229",
                    "claude-3-sonnet-20240229",
                    "claude-3-haiku-20240307"
                ]

        url = self._get_url("models")
            
        headers = {
            "Content-Type": "application/json"
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            print(f"正在获取模型列表: {url}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                print(f"原始响应状态: {response.status_code}")
                # 打印原始响应内容的前 500 个字符用于调试
                print(f"原始响应体: {response.text[:500]}")
                
                if response.status_code != 200:
                    print(f"远程 API 错误: {response.status_code} - {response.text}")
                    return []
                
                data = response.json()
                # 兼容不同厂商的返回格式
                model_list = []
                if isinstance(data, list):
                    model_list = data
                elif isinstance(data, dict):
                    if "data" in data and isinstance(data["data"], list):
                        model_list = data["data"]
                    elif "models" in data and isinstance(data["models"], list):
                        model_list = data["models"]
                
                # 提取 ID
                ids = []
                for m in model_list:
                    if isinstance(m, str):
                        ids.append(m)
                    elif isinstance(m, dict) and "id" in m:
                        ids.append(m["id"])
                    elif isinstance(m, dict) and "name" in m:
                        ids.append(m["name"])
                
                print(f"找到 {len(ids)} 个模型")
                return sorted(list(set(ids))) # 去重并排序
        except Exception as e:
            import traceback
            print(f"获取模型列表错误: {traceback.format_exc()}")
            return []

    async def chat_stream(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None, model_config: Any = None, stream: bool = True) -> AsyncIterable[str]:
        async for delta in self.chat_stream_deltas(messages, temperature, tools, model_config, stream):
            content = delta.get("content", "")
            if content:
                yield content

    async def chat_stream_deltas(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None, model_config: Any = None, stream: bool = True) -> AsyncIterable[Dict[str, Any]]:
        """
        流式返回 delta 对象，支持处理 tool_calls
        如果 stream=False，则模拟流式返回一次性结果 (适配旧逻辑)
        支持传入 model_config 覆盖当前实例配置
        """
        # 使用传入的 config 或当前实例的 config
        api_key = model_config.api_key if model_config and model_config.api_key else self.api_key
        api_base = model_config.api_base if model_config and model_config.api_base else self.api_base
        model_id = model_config.model_id if model_config else self.model
        provider = model_config.provider if hasattr(model_config, 'provider') else self.provider

        if provider == "gemini":
            async for delta in self._chat_gemini_stream(messages, temperature, model_id, api_key, tools):
                yield delta
            return
        elif provider in ["claude", "anthropic"]:
            async for delta in self._chat_anthropic_stream(messages, temperature, model_id, api_key, tools):
                yield delta
            return
            
        # 简单清洗 api_base
        api_base = api_base.strip().rstrip('/') if api_base else "https://api.openai.com"
        
        # 构造 URL
        if api_base.endswith("/v1"):
            url = f"{api_base}/chat/completions"
        else:
            url = f"{api_base}/v1/chat/completions"

        headers = {
            "Content-Type": "application/json"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            
        payload = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "stream": stream
        }
        
        # 调试：打印 payload 结构
        debug_payload = json.loads(json.dumps(payload))
        for msg in debug_payload.get("messages", []):
            content = msg.get("content")
            if isinstance(content, list):
                for item in content:
                    if item.get("type") == "input_audio":
                        item["input_audio"]["data"] = f"<{len(item['input_audio']['data'])} bytes base64>"
                    elif item.get("type") == "image_url":
                        item["image_url"]["url"] = f"<{len(item['image_url']['url'])} bytes data_url>"
        print(f"[LLM] 流式请求 Payload: {json.dumps(debug_payload, indent=2, ensure_ascii=False)}")

        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            # 1. 非流式模式 (Stream=False)
            if not stream:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    yield {"content": f"Error: {response.status_code} - {response.text}"}
                    return
                
                data = response.json()
                if data.get("choices") and len(data["choices"]) > 0:
                    # 模拟一个 delta 对象返回完整内容
                    message = data["choices"][0].get("message", {})
                    yield {"content": message.get("content", "")}
                return

            # 2. 流式模式 (Stream=True)
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_detail = await response.aread()
                    yield {"content": f"Error: {response.status_code} - {error_detail.decode()}"}
                    return

                buffer = ""
                try:
                    async for chunk in response.aiter_text():
                        buffer += chunk
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()
                            if line.startswith("data: "):
                                data_str = line[6:].strip()
                                if data_str == "[DONE]":
                                    return
                                try:
                                    data = json.loads(data_str)
                                    if data.get("choices") and len(data["choices"]) > 0:
                                        delta = data["choices"][0].get("delta", {})
                                        yield delta
                                except Exception:
                                    continue
                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ReadTimeout) as e:
                    print(f"[LLM] Stream Interrupted: {e}")
                    yield {"content": f"\n\n[System Warning: Network stream interrupted ({str(e)})]"}
