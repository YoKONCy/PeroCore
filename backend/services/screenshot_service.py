import time
import threading
from collections import deque
from typing import List, Dict, Optional
import pyautogui
import io
import base64

class ScreenshotManager:
    def __init__(self, max_size: int = 10, interval: int = 30):
        self.pool = deque(maxlen=max_size)
        self.interval = interval
        self.running = False
        self._thread = None

    def capture(self) -> Dict:
        """捕获当前屏幕并存入池中"""
        try:
            screenshot = pyautogui.screenshot()
            # 缩放图片以节省流量和内存 (可选，但推荐)
            # screenshot.thumbnail((1280, 720)) 
            buffered = io.BytesIO()
            screenshot.save(buffered, format="PNG")
            img_base64 = base64.b64encode(buffered.getvalue()).decode()
            
            data = {
                "timestamp": time.time(),
                "time_str": time.strftime("%H:%M:%S", time.localtime()),
                "base64": img_base64
            }
            self.pool.append(data)
            # print(f"[ScreenshotManager] Captured screenshot at {data['time_str']}")
            return data
        except Exception as e:
            print(f"[ScreenshotManager] Capture failed: {e}")
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
        print(f"[ScreenshotManager] Background task started (interval: {self.interval}s)")

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
