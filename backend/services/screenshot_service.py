import time
import threading
from collections import deque
from typing import List, Dict, Optional
import io
import base64
import os
import platform

# Optional import for pyautogui
try:
    import pyautogui
except ImportError:
    pyautogui = None

class ScreenshotManager:
    def __init__(self, max_size: int = 10, interval: int = 30):
        self.pool = deque(maxlen=max_size)
        self.interval = interval
        self.running = False
        self._thread = None
        self._is_server = os.environ.get("PERO_ENV") == "server" or platform.system() != "Windows"

    def capture(self) -> Optional[Dict]:
        """捕获当前屏幕并存入池中"""
        if self._is_server or not pyautogui:
            # Server 模式或缺少依赖时不执行截图
            return None

        try:
            start_time = time.time()
            screenshot = pyautogui.screenshot()
            
            # [优化] 如果大于 1080p 则调整大小以提高性能
            if screenshot.width > 1920 or screenshot.height > 1080:
                screenshot.thumbnail((1920, 1080))
            
            buffered = io.BytesIO()
            screenshot.save(buffered, format="PNG")
            img_base64 = base64.b64encode(buffered.getvalue()).decode()
            
            now = time.time()
            time_str = time.strftime("%H:%M:%S", time.localtime(now))
            
            data = {
                "timestamp": now,
                "time_str": time_str,
                "base64": img_base64
            }
            self.pool.append(data)
            
            duration = (now - start_time) * 1000
            print(f"[ScreenshotManager] 已截屏于 {time_str} (耗时 {duration:.2f}ms)")
            return data
        except Exception as e:
            print(f"[ScreenshotManager] 截图失败: {e}")
            return None

    def get_recent(self, count: int = 1, max_age: int = None) -> List[Dict]:
        """
        获取最近的 N 张截图
        :param count: 获取数量
        :param max_age: 最大有效期（秒），如果指定，则只返回在此时间内的截图
        """
        items = list(self.pool)
        if not items:
            return []
            
        if max_age is not None:
            now = time.time()
            # 过滤掉过期的图片
            items = [item for item in items if now - item["timestamp"] <= max_age]
            
        return items[-count:] if items else []

    def start_background_task(self):
        """启动后台定时截图任务"""
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print(f"[ScreenshotManager] 后台任务已启动 (间隔: {self.interval}s)")

    def _run(self):
        while self.running:
            self.capture()
            time.sleep(self.interval)

    def stop_background_task(self):
        self.running = False

# 全局单例
screenshot_manager = ScreenshotManager(interval=60) # 每分钟截一张图作为历史背景
# 立即启动后台任务
screenshot_manager.start_background_task()
