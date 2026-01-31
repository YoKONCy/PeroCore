import httpx
import json
import asyncio
import base64
import os
from typing import AsyncIterable, List, Dict, Any, Optional
from google import genai
from google.genai import types
import anthropic

# 默认 API Base URL 配置 (用户未提供时使用)
DEFAULT_API_BASES = {
    "openai": "https://api.openai.com",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "deepseek": "https://api.deepseek.com",
    "moonshot": "https://api.moonshot.cn/v1",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "volcengine": "https://ark.cn-beijing.volces.com/api/v3",
    "groq": "https://api.groq.com/openai/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "minimax": "https://api.minimax.chat/v1",
    "mistral": "https://api.mistral.ai/v1",
    "yi": "https://api.lingyiwanwu.com/v1",
    "xai": "https://api.x.ai/v1",
    "stepfun": "https://api.stepfun.com/v1",
    "hunyuan": "https://api.hunyuan.cloud.tencent.com/v1",
    "ollama": "http://localhost:11434/v1"
}

class LLMService:
    def __init__(self, api_key: str, api_base: str, model: str, provider: str = "openai"):
        self.api_key = api_key.strip() if api_key else ""
        self.provider = provider or "openai"
        self.model = model

        # 清洗 api_base: 去空格, 去末尾斜杠
        base = api_base.strip().rstrip('/') if api_base else ""
        
        # 如果未提供 api_base，尝试使用默认值
        if not base:
            base = DEFAULT_API_BASES.get(self.provider, "https://api.openai.com")
            
        self.api_base = base

    def _get_url(self, endpoint: str) -> str:
        """根据 endpoint 自动拼接正确的 URL (用于通用 OpenAI 兼容接口)"""
        # 特殊处理：如果是 OpenAI 兼容但不需要 /v1 (极少数情况)，或者用户输入了完整 URL
        # 这里假设 self.api_base 已经是基础路径 (如 https://api.deepseek.com)
        
        # 为了兼容性，如果 api_base 已经包含 /v1，则不重复添加
        # 如果 endpoint 是 chat/completions
        
        suffix = ""
        if endpoint == "chat":
            suffix = "/chat/completions"
        elif endpoint == "models":
            suffix = "/models"
        else:
            suffix = endpoint

        # 检查是否已经以 /v1 结尾
        if self.api_base.endswith("/v1"):
            return f"{self.api_base}{suffix.replace('/v1', '')}" # 避免重复
        
        # 检查 suffix 是否自带 /v1 (通常不会，但在 _get_url 调用时要注意)
        return f"{self.api_base}{suffix}" if "/v1" in self.api_base else f"{self.api_base}/v1{suffix}"

    async def chat(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None, response_format: Optional[Dict] = None, timeout: float = 300.0) -> Dict[str, Any]:
        # 智能纠错：若模型为 Gemini 但 Provider 误设为 Anthropic，强制回退到 OpenAI 兼容模式
        if self.provider in ["claude", "anthropic"] and "gemini" in self.model.lower():
             print(f"[LLMService] 检测到 Gemini 模型 '{self.model}' 使用 Anthropic 提供商。强制回退到 OpenAI 兼容协议。")
        elif self.provider == "gemini":
            return await self._chat_gemini(messages, temperature, tools)
        elif self.provider in ["claude", "anthropic"]:
            return await self._chat_anthropic(messages, temperature, tools)
            
        # 默认使用 OpenAI 兼容协议 (支持 SiliconFlow, DeepSeek, DashScope 等)
        return await self._chat_openai_compatible(messages, temperature, tools, response_format, timeout)

    async def _chat_openai_compatible(self, messages: List[Dict[str, Any]], temperature: float, tools: List[Dict] = None, response_format: Optional[Dict] = None, timeout: float = 300.0) -> Dict[str, Any]:
        """通用 OpenAI 兼容接口调用"""
        
        # 构造 URL：如果是 v1 结尾的 base，直接拼接；否则加 v1
        # 但有些 provider 可能不需要 v1 (如 Ollama 有时)，这里主要针对公有云 API
        if self.api_base.endswith("/v1"):
            url = f"{self.api_base}/chat/completions"
        else:
            url = f"{self.api_base}/v1/chat/completions"
            
        headers = {
            "Content-Type": "application/json"
        }
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
        
        # 调试输出
        self._debug_print_payload(payload)

        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    self._handle_http_error(response)
                return response.json()
            except Exception as e:
                print(f"[LLM] 请求异常: {e}")
                raise

    def _debug_print_payload(self, payload):
        """调试：打印 payload 结构（不包含大型 base64 数据）"""
        try:
            debug_payload = json.loads(json.dumps(payload))
            for msg in debug_payload.get("messages", []):
                content = msg.get("content")
                if isinstance(content, list):
                    for item in content:
                        if item.get("type") == "input_audio":
                            item["input_audio"]["data"] = f"<{len(item['input_audio']['data'])} bytes base64>"
                        elif item.get("type") == "image_url":
                            item["image_url"]["url"] = f"<{len(item['image_url']['url'])} bytes data_url>"
            print(f"[LLM] 请求 Payload ({self.provider}): {json.dumps(debug_payload, indent=2, ensure_ascii=False)}")
        except:
            pass

    def _handle_http_error(self, response):
        error_text = response.text
        # 清洗 HTML 错误
        if "<html" in error_text.lower() or "<!doctype" in error_text.lower():
            import re
            title_match = re.search(r'<title>(.*?)</title>', error_text, re.IGNORECASE)
            if title_match:
                error_text = f"网络错误 ({response.status_code}): {title_match.group(1)}"
            else:
                error_text = f"网络错误 ({response.status_code}): HTML 响应"
        
        print(f"[LLM] 错误响应: {error_text}")
        raise Exception(f"LLM 错误: {response.status_code} - {error_text}")

    async def _chat_gemini(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Gemini 原生 API 调用 (使用 google-genai SDK)"""
        try:
            client = genai.Client(api_key=self.api_key)
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

            response = await client.aio.models.generate_content(
                model=self.model,
                contents=history,
                config=config
            )
            
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

    async def _chat_anthropic(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None) -> Dict[str, Any]:
        """Anthropic 原生 API 调用 (使用 anthropic SDK)"""
        try:
            client = anthropic.AsyncAnthropic(
                api_key=self.api_key,
                base_url=self.api_base if self.api_base != "https://api.openai.com" and self.api_base else None
            )
            
            system_prompt, anthropic_messages = self._convert_to_anthropic_format(messages)
            anthropic_tools = self._convert_tools_to_anthropic(tools)
            
            kwargs = {
                "model": self.model,
                "messages": anthropic_messages,
                "max_tokens": 4096,
                "temperature": temperature,
                "system": system_prompt
            }
            
            if anthropic_tools:
                kwargs["tools"] = anthropic_tools
                
            print(f"[Anthropic SDK] 发送请求: {self.model}")
            
            response = await client.messages.create(**kwargs)
            
            # 转换响应为 OpenAI 格式
            content_text = ""
            tool_calls = []
            
            for block in response.content:
                if block.type == "text":
                    content_text += block.text
                elif block.type == "tool_use":
                    tool_calls.append({
                        "id": block.id,
                        "type": "function",
                        "function": {
                            "name": block.name,
                            "arguments": json.dumps(block.input)
                        }
                    })
            
            message = {
                "role": "assistant",
                "content": content_text if content_text else None
            }
            
            if tool_calls:
                message["tool_calls"] = tool_calls
                
            return {
                "choices": [{
                    "message": message,
                    "finish_reason": response.stop_reason
                }]
            }
            
        except Exception as e:
            print(f"[Anthropic] SDK 错误: {e}")
            raise

    # ... (Keep helper methods like _convert_to_genai_contents, etc. - will copy them below) ...
    
    def _convert_to_genai_contents(self, messages: List[Dict[str, Any]]) -> List[types.Content]:
        """将 OpenAI 消息格式转换为 Gemini GenAI Content 格式"""
        contents = []
        for msg in messages:
            role = msg["role"]
            if role == "assistant":
                role = "model"
            elif role == "tool":
                role = "user" 

            parts = []
            
            # 1. tool_calls
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
            
            # 2. content
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

            # 3. tool response
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
        if not openai_tools:
            return None
        declarations = []
        for tool in openai_tools:
            if tool.get("type") == "function":
                func = tool["function"]
                declarations.append(types.FunctionDeclaration(
                    name=func.get("name"),
                    description=func.get("description"),
                    parameters=func.get("parameters")
                ))
        return [types.Tool(function_declarations=declarations)] if declarations else None

    def _convert_to_anthropic_format(self, messages: List[Dict[str, Any]]) -> tuple[str, List[Dict[str, Any]]]:
        """转换 OpenAI 消息到 Anthropic 格式"""
        system_prompt = ""
        anthropic_msgs = []
        
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            
            if role == "system":
                system_prompt += str(content) + "\n"
                continue
                
            if role == "tool":
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
                print(f"[Gemini] 获取模型列表失败: {e}")
                return ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"]
        
        elif self.provider in ["claude", "anthropic"]:
            try:
                client = anthropic.AsyncAnthropic(api_key=self.api_key)
                models = await client.models.list()
                return sorted([m.id for m in models.data])
            except Exception as e:
                print(f"[Anthropic] 获取模型列表错误: {e}")
                return ["claude-3-5-sonnet-20240620", "claude-3-opus-20240229"]

        # 通用 OpenAI 兼容列表获取
        # 构造 URL: 如果 base 已经包含 /v1，则去掉 /v1 加上 /models，或者直接 base/models
        # 多数兼容 API 支持 /v1/models 或 /models
        
        # 尝试 1: 标准 /v1/models
        url = ""
        if self.api_base.endswith("/v1"):
            url = f"{self.api_base}/models"
        else:
            url = f"{self.api_base}/v1/models"
            
        headers = {
            "Content-Type": "application/json"
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            print(f"正在获取模型列表: {url}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                
                # 如果失败，尝试去掉 /v1
                if response.status_code != 200 and "/v1" in url:
                    alt_url = url.replace("/v1", "")
                    print(f"尝试备用 URL: {alt_url}")
                    response = await client.get(alt_url, headers=headers)
                
                if response.status_code != 200:
                    print(f"远程 API 错误: {response.status_code} - {response.text}")
                    return []
                
                data = response.json()
                model_list = []
                if isinstance(data, list):
                    model_list = data
                elif isinstance(data, dict):
                    if "data" in data and isinstance(data["data"], list):
                        model_list = data["data"]
                    elif "models" in data and isinstance(data["models"], list):
                        model_list = data["models"]
                
                ids = []
                for m in model_list:
                    if isinstance(m, str):
                        ids.append(m)
                    elif isinstance(m, dict) and "id" in m:
                        ids.append(m["id"])
                    elif isinstance(m, dict) and "name" in m:
                        ids.append(m["name"])
                
                return sorted(list(set(ids)))
        except Exception as e:
            print(f"获取模型列表错误: {e}")
            return []

    async def chat_stream_deltas(self, messages: List[Dict[str, Any]], temperature: float = 0.7, tools: List[Dict] = None, model_config: Any = None, stream: bool = True) -> AsyncIterable[Dict[str, Any]]:
        """流式返回 delta 对象"""
        # 获取配置
        api_key = model_config.api_key if model_config and model_config.api_key else self.api_key
        api_base = model_config.api_base if model_config and model_config.api_base else self.api_base
        model_id = model_config.model_id if model_config else self.model
        provider = model_config.provider if hasattr(model_config, 'provider') else self.provider
        
        # 动态更新 api_base 如果需要默认值
        if not api_base and provider in DEFAULT_API_BASES:
            api_base = DEFAULT_API_BASES[provider]

        if provider == "gemini":
            async for delta in self._chat_gemini_stream(messages, temperature, model_id, api_key, tools):
                yield delta
            return
        elif provider in ["claude", "anthropic"]:
            async for delta in self._chat_anthropic_stream(messages, temperature, model_id, api_key, tools, api_base):
                yield delta
            return
            
        # 通用 OpenAI 流式
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
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                if not stream:
                    # 非流式回退
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code != 200:
                        yield {"content": f"错误: {response.status_code} - {response.text}"}
                        return
                    data = response.json()
                    if data.get("choices"):
                         yield {"content": data["choices"][0]["message"].get("content", "")}
                    return

                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        yield {"content": f"错误: {response.status_code} - {await response.aread()}"}
                        return

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                if data.get("choices"):
                                    delta = data["choices"][0].get("delta", {})
                                    yield delta
                            except:
                                continue
            except Exception as e:
                print(f"[LLM Stream] Error: {e}")
                yield {"content": f"\n[Error: {str(e)}]"}

    async def _chat_gemini_stream(self, messages: List[Dict[str, Any]], temperature: float, model_id: str, api_key: str, tools: List[Dict] = None) -> AsyncIterable[Dict[str, Any]]:
        """Gemini 原生 API 流式调用"""
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
                try:
                    if chunk.text:
                        yield {"content": chunk.text}
                except:
                    pass
        except Exception as e:
            print(f"[Gemini Stream] 错误: {e}")
            yield {"content": f"错误: {str(e)}"}

    async def _chat_anthropic_stream(self, messages: List[Dict[str, Any]], temperature: float, model_id: str, api_key: str, tools: List[Dict] = None, api_base: str = None) -> AsyncIterable[Dict[str, Any]]:
        """Anthropic 原生 API 流式调用 (使用 SDK)"""
        try:
            client = anthropic.AsyncAnthropic(
                api_key=api_key,
                base_url=api_base if api_base and api_base != "https://api.openai.com" else None
            )
            
            system_prompt, anthropic_messages = self._convert_to_anthropic_format(messages)
            anthropic_tools = self._convert_tools_to_anthropic(tools)
            
            kwargs = {
                "model": model_id,
                "messages": anthropic_messages,
                "max_tokens": 4096,
                "temperature": temperature,
                "system": system_prompt,
                "stream": True
            }
            if anthropic_tools:
                kwargs["tools"] = anthropic_tools

            async with client.messages.stream(**kwargs) as stream:
                async for event in stream:
                    if event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            yield {"content": event.delta.text}
                    # SDK handles complicated tool events, but mapping them to OpenAI delta format 
                    # requires careful handling. For now we focus on text.
                    # TODO: Implement full tool stream mapping if needed.
        except Exception as e:
            print(f"[Anthropic Stream] 错误: {e}")
            yield {"content": f"错误: {str(e)}"}
