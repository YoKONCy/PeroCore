import re
from typing import Dict, Any, AsyncIterable
from .base import BasePostprocessor
from nit_core.dispatcher import remove_nit_tags, NITStreamFilter

class ThinkingFilterPostprocessor(BasePostprocessor):
    """
    Filters out Thinking blocks (e.g. 【Thinking:...】) from the full text,
    but allows them in the stream (so user can see the process).
    """
    
    @property
    def name(self) -> str:
        return "ThinkingFilter"

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        Passes Thinking blocks through (no longer filters them), so they can be stored in memory
        and displayed to the user as requested.
        """
        # User requested to KEEP the thinking process for "cuteness" and memory storage.
        # So we simply return the content as is.
        return content

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        Passes the stream through without filtering Thinking blocks (as requested by user).
        """
        async for chunk in stream:
            yield chunk

class NITFilterPostprocessor(BasePostprocessor):
    """
    Filters out NIT protocol markers (e.g. [[[NIT_CALL]]], [START]...[END])
    from both batch content and streaming output.
    """
    
    @property
    def name(self) -> str:
        return "NITFilter"

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        Removes NIT blocks from the full text.
        """
        if context.get('skip_nit_filter'):
            return content
            
        return remove_nit_tags(content)

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        Filters NIT blocks from the stream using NITStreamFilter.
        """
        if context.get('skip_nit_filter'):
            async for chunk in stream:
                yield chunk
            return

        # Instantiate a new filter for this stream
        nit_filter = NITStreamFilter()
        
        async for chunk in stream:
            # The filter returns the text that is safe to display (outside of NIT blocks)
            filtered_chunk = nit_filter.filter(chunk)
            if filtered_chunk:
                yield filtered_chunk
        
        # Flush any remaining buffer at the end of the stream
        remaining = nit_filter.flush()
        if remaining:
            yield remaining
