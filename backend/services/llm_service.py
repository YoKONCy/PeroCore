import httpx
import json
import asyncio
import base64
import os
from typing import AsyncIterable, List, Dict, Any, Optional
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

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
        if self.provider == "gemini":
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
        
        # Debug: Print payload structure (without large base64 data)
        debug_payload = json.loads(json.dumps(payload))
        for msg in debug_payload.get("messages", []):
            content = msg.get("content")
            if isinstance(content, list):
                for item in content:
                    if item.get("type") == "input_audio":
                        item["input_audio"]["data"] = f"<{len(item['input_audio']['data'])} bytes base64>"
                    elif item.get("type") == "image_url":
                        item["image_url"]["url"] = f"<{len(item['image_url']['url'])} bytes data_url>"
        print(f"[LLM] Request Payload: {json.dumps(debug_payload, indent=2, ensure_ascii=False)}")

        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                print(f"[LLM] Error Response: {response.text}")
                raise Exception(f"LLM Error: {response.status_code} - {response.text}")
            return response.json()

    async def _chat_gemini(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Gemini 原生 API 调用"""
        try:
            genai.configure(api_key=self.api_key)
            
            # 转换消息格式
            gemini_messages = self._convert_to_gemini_format(messages)
            
            # 分离系统提示词和历史记录
            system_instruction = None
            history = []
            
            for msg in gemini_messages:
                if msg["role"] == "system":
                    system_instruction = msg["parts"][0]
                else:
                    history.append(msg)
            
            gemini_tools = self._convert_tools_to_gemini(tools)
            model = genai.GenerativeModel(self.model, system_instruction=system_instruction, tools=gemini_tools)
            
            # 最后一条是用户消息
            user_msg = history.pop()
            chat = model.start_chat(history=history)
            
            response = await asyncio.to_thread(
                chat.send_message,
                user_msg["parts"],
                generation_config=genai.GenerationConfig(temperature=temperature),
                safety_settings={
                    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                }
            )
            
            # 处理响应
            content = ""
            try:
                content = response.text
            except ValueError:
                pass # 可能只有 function call
            
            # 构造 message 对象
            message = {
                "role": "assistant",
                "content": content
            }
            
            # 检查 function call
            if response.candidates and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if part.function_call:
                        import uuid
                        call_id = f"call_{uuid.uuid4().hex[:8]}"
                        fc = part.function_call
                        args = {}
                        for k, v in fc.args.items():
                            args[k] = v
                        
                        message["tool_calls"] = [{
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": fc.name,
                                "arguments": json.dumps(args)
                            }
                        }]
                        # 如果有 tool_calls，content 可能是空的或者 None
                        if not message["content"]:
                            message["content"] = None
                        break

            return {
                "choices": [{
                    "message": message
                }]
            }
        except Exception as e:
            print(f"[Gemini] Error: {e}")
            raise

    def _convert_to_gemini_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """将 OpenAI 消息格式转换为 Gemini 格式"""
        gemini_msgs = []
        for msg in messages:
            role = msg["role"]
            if role == "assistant":
                role = "model"
            elif role == "tool":
                role = "function" # 这里需要特殊处理，Gemini 的 role 只有 model 和 user/function? 
                # 其实 Gemini 在 history 中，function_response 的 role 也是 'function' 或者作为 user 的一部分？
                # Google GenAI SDK 中，function_response 的 role 通常是 'function'。
                pass

            content = msg.get("content")
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
                        parts.append({
                            "function_call": {
                                "name": func.get("name"),
                                "args": args
                            }
                        })
            
            # 2. 处理 content (文本/多模态)
            if content:
                if isinstance(content, str):
                    parts.append({"text": content})
                elif isinstance(content, list):
                    for item in content:
                        if item["type"] == "text":
                            parts.append({"text": item["text"]})
                        elif item["type"] == "input_audio":
                            # 处理音频
                            try:
                                audio_data = item["input_audio"]["data"]
                                audio_bytes = base64.b64decode(audio_data)
                                parts.append({
                                    "inline_data": {
                                        "mime_type": f"audio/{item['input_audio']['format']}",
                                        "data": audio_bytes
                                    }
                                })
                            except Exception as e:
                                print(f"[Gemini] Audio decode error: {e}")
                        elif item["type"] == "image_url":
                            # 处理图片
                            try:
                                url = item["image_url"]["url"]
                                if url.startswith("data:"):
                                    header, data = url.split(",", 1)
                                    mime_type = header.split(";")[0].split(":")[1]
                                    image_bytes = base64.b64decode(data)
                                    parts.append({
                                        "inline_data": {
                                            "mime_type": mime_type,
                                            "data": image_bytes
                                        }
                                    })
                            except Exception as e:
                                print(f"[Gemini] Image decode error: {e}")

            # 3. 处理 tool 响应 (Tool 输出)
            if role == "tool":
                # OpenAI 格式: role="tool", tool_call_id="...", content="..."
                # Gemini 格式: role="function", parts=[{ "function_response": { "name": "...", "response": { "content": ... } } }]
                # 问题：我们丢失了 function name，OpenAI 的 tool message 只有 tool_call_id
                # 我们需要从上下文推断 name，或者假设 message 中包含 name 字段（如果我们修改了 agent 逻辑）
                # 暂时只能尽力而为。如果找不到 name，Gemini 可能会报错。
                # 临时方案：在 AgentService 中，我们应该把 name 塞进 tool message。
                # 如果没有 name，我们可以尝试用 "unknown_tool" 或跳过。
                
                tool_name = msg.get("name", "unknown_tool") # 依赖调用方传入 name
                
                # content 必须是 dict 结构给 response
                response_content = {"content": content}
                
                parts.append({
                    "function_response": {
                        "name": tool_name,
                        "response": response_content
                    }
                })
                role = "function"

            if parts:
                gemini_msgs.append({"role": role, "parts": parts})
        return gemini_msgs

    def _convert_tools_to_gemini(self, openai_tools: List[Dict]) -> List[Dict]:
        """将 OpenAI 工具定义转换为 Gemini 格式"""
        if not openai_tools:
            return None
        
        declarations = []
        for tool in openai_tools:
            if tool.get("type") == "function":
                func = tool["function"]
                declarations.append({
                    "name": func.get("name"),
                    "description": func.get("description"),
                    "parameters": func.get("parameters")
                })
        
        if not declarations:
            return None

        # 封装为 Gemini Tool 对象结构
        return [{"function_declarations": declarations}]

    async def _chat_gemini_stream(self, messages: List[Dict[str, Any]], temperature: float, model_id: str, api_key: str, tools: List[Dict] = None) -> AsyncIterable[Dict[str, Any]]:
        """Gemini 原生 API 流式调用"""
        try:
            genai.configure(api_key=api_key)
            
            # 转换消息格式
            gemini_messages = self._convert_to_gemini_format(messages)
            
            # 分离系统提示词和历史记录
            system_instruction = None
            history = []
            
            for msg in gemini_messages:
                if msg["role"] == "system":
                    system_instruction = msg["parts"][0]
                else:
                    history.append(msg)
            
            gemini_tools = self._convert_tools_to_gemini(tools)
            model = genai.GenerativeModel(model_id, system_instruction=system_instruction, tools=gemini_tools)
            
            # 最后一条是用户消息
            user_msg = history.pop()
            chat = model.start_chat(history=history)
            
            # 这里的 send_message 是同步阻塞的，在 stream=True 时返回一个迭代器
            # 我们使用 to_thread 可能会有问题，因为它是迭代器
            # 实际上 google-generativeai 支持 async
            # model_async = genai.GenerativeModel(model_id, system_instruction=system_instruction)
            # chat_async = model_async.start_chat(history=history)
            # response = await chat_async.send_message_async(user_msg["parts"], stream=True, ...)
            
            # 简化起见，我们直接使用同步迭代器但在线程中运行
            def get_stream():
                return chat.send_message(
                    user_msg["parts"],
                    stream=True,
                    generation_config=genai.GenerationConfig(temperature=temperature),
                    safety_settings={
                        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                    }
                )

            response_stream = await asyncio.to_thread(get_stream)
            
            for chunk in response_stream:
                # 处理 Function Call
                # Gemini 的 chunk.parts 可能包含 function_call
                try:
                    if chunk.candidates and chunk.candidates[0].content.parts:
                        for part in chunk.candidates[0].content.parts:
                            if part.function_call:
                                import uuid
                                call_id = f"call_{uuid.uuid4().hex[:8]}"
                                fc = part.function_call
                                args = {}
                                # fc.args 是一个 Map，需要转 dict
                                for k, v in fc.args.items():
                                    args[k] = v
                                    
                                yield {
                                    "tool_calls": [{
                                        "index": 0,
                                        "id": call_id,
                                        "function": {
                                            "name": fc.name,
                                            "arguments": json.dumps(args)
                                        }
                                    }]
                                }
                except Exception as e:
                    print(f"[Gemini Stream] Function call extraction error: {e}")

                # 处理文本
                try:
                    if chunk.text:
                        yield {"content": chunk.text}
                except ValueError:
                    # 如果 chunk 里只有 function_call 而没有 text，访问 chunk.text 会抛出 ValueError
                    pass
                
        except Exception as e:
            print(f"[Gemini Stream] Error: {e}")
            yield {"content": f"Error: {str(e)}"}

    # --- Anthropic (Claude) Support ---

    async def _chat_anthropic(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Anthropic 原生 API 调用"""
        system_prompt, anthropic_messages = self._convert_to_anthropic_format(messages)
        anthropic_tools = self._convert_tools_to_anthropic(tools)

        # 默认 URL
        url = "https://api.anthropic.com/v1/messages"
        if self.api_base and self.api_base != "https://api.openai.com":
             url = f"{self.api_base}/v1/messages" if not self.api_base.endswith("/messages") else self.api_base

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

        print(f"[Anthropic] Request Payload: {json.dumps({k:v for k,v in payload.items() if k!='messages'}, indent=2)}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                print(f"[Anthropic] Error Response: {response.text}")
                raise Exception(f"Anthropic Error: {response.status_code} - {response.text}")
            
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
        # Check if api_base is custom
        # Note: self.api_base might be the instance one, but we should use the passed one if we were inside the method, 
        # but here we use 'api_base' arg passed to this function.
        # But wait, self.api_base is available. Let's check logic.
        # The args passed are overrides.
        
        base_url = self.api_base
        # logic from chat_stream_deltas:
        # api_base = model_config.api_base ...
        # But here we don't have model_config passed, we have api_key.
        # We should probably use self.api_base if api_key matches self.api_key, or just assume standard if not provided.
        # Actually, let's just use hardcoded standard unless self.api_base is set to something else.
        if hasattr(self, 'api_base') and self.api_base and "api.openai.com" not in self.api_base:
             # If user set a custom base for this provider
             base_url = self.api_base
        else:
             base_url = "https://api.anthropic.com"

        if base_url.endswith("/v1"):
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
                    yield {"content": f"Error: {response.status_code} - {await response.aread()}"}
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
                            # Tool use delta handling is complex in Anthropic (json patching)
                            # For now, simplistic support or ignore partial tool args if complex
                            
                        elif type_ == "message_delta":
                            # stop_reason, usage, etc.
                            pass
                            
                        # Note: Anthropic streams tool calls differently.
                        # Supporting streaming tool calls requires state machine to reconstruct JSON.
                        # For simplicity in this iteration, we might not support streaming tool calls fully 
                        # or we just rely on the text content if thinking process is text.
                        
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
                # Anthropic uses 'user' role for tool results
                # Content should be blocks
                # [
                #   {
                #     "type": "tool_result",
                #     "tool_use_id": "...",
                #     "content": "..."
                #   }
                # ]
                # But we need tool_call_id from somewhere. 
                # OpenAI messages have 'tool_call_id'.
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

            # Assistant tool calls
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
            
            # Normal text messages
            # Anthropic expects content to be string or list of blocks
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
                genai.configure(api_key=self.api_key)
                models = await asyncio.to_thread(genai.list_models)
                return [m.name.replace("models/", "") for m in models if "generateContent" in m.supported_generation_methods]
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
                    # Anthropic returns {"data": [...]}
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
                print(f"[Anthropic] Error listing models: {e}")
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
            print(f"Fetching models from: {url}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                print(f"Raw Response Status: {response.status_code}")
                # 打印原始响应内容的前 500 个字符用于调试
                print(f"Raw Response Body: {response.text[:500]}")
                
                if response.status_code != 200:
                    print(f"Remote API Error: {response.status_code} - {response.text}")
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
                
                print(f"Found {len(ids)} models")
                return sorted(list(set(ids))) # 去重并排序
        except Exception as e:
            import traceback
            print(f"Error listing models: {traceback.format_exc()}")
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
        
        # Debug: Print payload structure
        debug_payload = json.loads(json.dumps(payload))
        for msg in debug_payload.get("messages", []):
            content = msg.get("content")
            if isinstance(content, list):
                for item in content:
                    if item.get("type") == "input_audio":
                        item["input_audio"]["data"] = f"<{len(item['input_audio']['data'])} bytes base64>"
                    elif item.get("type") == "image_url":
                        item["image_url"]["url"] = f"<{len(item['image_url']['url'])} bytes data_url>"
        print(f"[LLM] Stream Request Payload: {json.dumps(debug_payload, indent=2, ensure_ascii=False)}")

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
