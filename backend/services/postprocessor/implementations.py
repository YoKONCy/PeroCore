import re
from typing import Dict, Any, AsyncIterable
from .base import BasePostprocessor
from nit_core.dispatcher import remove_nit_tags, NITStreamFilter

class ThinkingFilterPostprocessor(BasePostprocessor):
    """
    从全文中过滤掉 Thinking 块（例如 【Thinking:...】），
    但在流中允许它们（以便用户可以看到过程）。
    """
    
    @property
    def name(self) -> str:
        return "ThinkingFilter"

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        通过 Thinking 块（不再过滤它们），以便可以将它们存储在记忆中
        并按要求显示给用户。
        """
        # 用户请求保留思考过程以增加“可爱度”并用于记忆存储。
        # 所以我们只是按原样返回内容。
        return content

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        通过流而不过滤 Thinking 块（按用户要求）。
        """
        async for chunk in stream:
            yield chunk

class NITFilterPostprocessor(BasePostprocessor):
    """
    过滤掉 NIT 协议标记（例如 [[[NIT_CALL]]], [START]...[END]）
    从批处理内容和流式输出中。
    """
    
    @property
    def name(self) -> str:
        return "NITFilter"

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        从全文中移除 NIT 块。
        """
        if context.get('skip_nit_filter'):
            return content
            
        return remove_nit_tags(content)

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        使用 NITStreamFilter 从流中过滤 NIT 块。
        """
        if context.get('skip_nit_filter'):
            async for chunk in stream:
                yield chunk
            return

        # 为此流实例化一个新的过滤器
        nit_filter = NITStreamFilter()
        
        async for chunk in stream:
            # 过滤器返回可以安全显示的文本（在 NIT 块之外）
            filtered_chunk = nit_filter.filter(chunk)
            if filtered_chunk:
                yield filtered_chunk
        
        # 在流结束时刷新所有剩余缓冲区
        remaining = nit_filter.flush()
        if remaining:
            yield remaining
