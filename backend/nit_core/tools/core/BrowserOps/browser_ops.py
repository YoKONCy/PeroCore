import httpx
from bs4 import BeautifulSoup
try:
    from services.browser_bridge_service import browser_bridge_service
except ImportError:
    from backend.services.browser_bridge_service import browser_bridge_service
import json

async def _wrap_result_with_content(result: dict) -> str:
    """Helper to append current page content to the command result."""
    content = browser_bridge_service.get_current_page_markdown()
    
    # 构造 NIT 格式的反馈：先给出执行状态，再给出页面内容供 AI 下一步决策
    status = result.get("status", "unknown")
    if status == "success":
        msg = f"✅ 执行成功。"
    else:
        error_msg = result.get("error", "未知错误")
        msg = f"❌ 执行失败: {error_msg}"

    output = f"{msg}\n\n"
    output += "--- 当前页面内容 (Simplified Markdown) ---\n"
    output += content
    return output

async def browser_fetch_text(url: str, **kwargs) -> str:
    """
    Fetch the content of a web page and return the text using a lightweight HTTP client.
    Use this for quick reading of articles or static pages without visual interaction.
    """
    if not url.startswith('http'):
        url = 'https://' + url

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            
            # Encoding
            if response.encoding is None:
                response.encoding = 'utf-8' # Default fallback
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove junk
            for script in soup(["script", "style", "nav", "footer", "header", "iframe", "noscript"]):
                script.decompose()
            
            text = soup.get_text()
            
            # Clean text
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = '\n'.join(chunk for chunk in chunks if chunk)
            
            return f"### Content from {url}\n\n{text[:20000]}" + ("\n...[Truncated]" if len(text) > 20000 else "")

    except Exception as e:
        return f"Error fetching URL: {str(e)}"

async def browser_open_url(url: str = None, target: str = None, **kwargs) -> str:
    """
    Control the connected browser to open a specific URL.
    
    Args:
        url (str): The URL to open.
        target (str): Alias for url, for compatibility.
        
    Returns:
        str: Execution status and the new page content.
    """
    # Compatibility handling: if url is missing but target is provided
    final_url = url or target
    if not final_url:
        return "❌ Error: Please provide a URL (parameter 'url' or 'target')."

    if not final_url.startswith("http"):
        final_url = "https://" + final_url
        
    result = await browser_bridge_service.send_command("open_url", url=final_url)
    return await _wrap_result_with_content(result)

async def _retry_command(command: str, max_retries: int = 3, delay: float = 1.0, **kwargs) -> dict:
    """Helper to retry commands that might fail due to timing issues (e.g. element not ready)."""
    import asyncio
    last_result = {"status": "error", "error": "Unknown error"}
    
    for i in range(max_retries):
        last_result = await browser_bridge_service.send_command(command, **kwargs)
        if last_result.get("status") == "success":
            return last_result
            
        # Don't sleep on the last attempt
        if i < max_retries - 1:
            await asyncio.sleep(delay)
            
    return last_result

async def browser_click(target: str, **kwargs) -> str:
    """
    Click an element (button, link, etc.) on the current page.
    
    Args:
        target (str): The text or identifier of the element to click.
        
    Returns:
        str: Execution status and the updated page content.
    """
    # Use retry logic for click as elements might load dynamically
    result = await _retry_command("click", target=target)
    return await _wrap_result_with_content(result)

async def browser_type(target: str, text: str, **kwargs) -> str:
    """
    Type text into an input field.
    
    Args:
        target (str): The label, placeholder, or identifier of the input field.
        text (str): The text to type.
        
    Returns:
        str: Execution status and the updated page content.
    """
    # Use retry logic for type as elements might load dynamically
    result = await _retry_command("type", target=target, text=text)
    return await _wrap_result_with_content(result)

async def browser_get_content(**kwargs) -> str:
    """
    Get the current page content from the connected browser.
    
    Returns:
        str: The simplified Markdown content of the current page.
    """
    content = browser_bridge_service.get_current_page_markdown()
    if content.startswith("Error:"):
        return f"❌ {content}"
    return content

async def browser_scroll(direction: str = "down", **kwargs) -> str:
    """
    Scroll the current page up or down.
    
    Args:
        direction (str): "up" or "down". Default is "down".
        
    Returns:
        str: Execution status and updated page content.
    """
    result = await browser_bridge_service.send_command("scroll", text=direction)
    return await _wrap_result_with_content(result)

async def browser_back(**kwargs) -> str:
    """
    Go back to the previous page in history.
    
    Returns:
        str: Execution status and updated page content.
    """
    result = await browser_bridge_service.send_command("back")
    return await _wrap_result_with_content(result)

async def browser_refresh(**kwargs) -> str:
    """
    Refresh the current page.
    
    Returns:
        str: Execution status and updated page content.
    """
    result = await browser_bridge_service.send_command("refresh")
    return await _wrap_result_with_content(result)


