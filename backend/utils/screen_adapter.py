import platform
import ctypes
import pyautogui
from typing import Tuple

def set_dpi_awareness():
    """
    提升 Windows 系统上的 DPI 感知能力，确保坐标识别准确。
    防止在 125%, 150% 等缩放比例下出现坐标偏移。
    """
    if platform.system().lower() == "windows":
        try:
            # 尝试设置进程的 DPI 感知 (Windows 8.1+)
            ctypes.windll.shcore.SetProcessDpiAwareness(2) # 2 = Process_Per_Monitor_DPI_Aware
        except Exception:
            try:
                # 备选方案 (Windows Vista+)
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

class ScreenAdapter:
    """
    屏幕适配器，用于处理坐标映射和缩放逻辑。
    """
    def __init__(self):
        set_dpi_awareness()
        self._refresh_screen_info()

    def _refresh_screen_info(self):
        # 获取物理屏幕尺寸
        self.screen_width, self.screen_height = pyautogui.size()
        
    def get_physical_coords(self, logical_x: float, logical_y: float, max_logical_width: int = 1000, max_logical_height: int = 1000) -> Tuple[int, int]:
        """
        将逻辑坐标（通常是 AI 返回的 0-1000 比例坐标）映射为真实的像素坐标。
        
        :param logical_x: 逻辑 X 坐标
        :param logical_y: 逻辑 Y 坐标
        :param max_logical_width: 逻辑坐标的最大宽度（默认 1000）
        :param max_logical_height: 逻辑坐标的最大高度（默认 1000）
        :return: 物理像素坐标 (x, y)
        """
        self._refresh_screen_info()
        
        phys_x = int(round((logical_x / max_logical_width) * self.screen_width))
        phys_y = int(round((logical_y / max_logical_height) * self.screen_height))
        
        # 边界检查
        phys_x = max(0, min(phys_x, self.screen_width - 1))
        phys_y = max(0, min(phys_y, self.screen_height - 1))
        
        return phys_x, phys_y

    def get_logical_coords(self, phys_x: int, phys_y: int, max_logical_width: int = 1000, max_logical_height: int = 1000) -> Tuple[int, int]:
        """
        将物理像素坐标映射为逻辑坐标（通常用于发送给 AI）。
        """
        self._refresh_screen_info()
        
        log_x = int(round((phys_x / self.screen_width) * max_logical_width))
        log_y = int(round((phys_y / self.screen_height) * max_logical_height))
        
        return log_x, log_y

class ScaledPyAutoGUI:
    """
    pyautogui 的代理类，自动处理逻辑坐标 (0-1000) 到物理像素坐标的转换。
    模仿 N.E.K.O 的 _ScaledPyAutoGUI 实现。
    """
    def __init__(self):
        self._backend = pyautogui
        set_dpi_awareness()

    def _get_phys_coords(self, x, y):
        screen_w, screen_h = self._backend.size()
        phys_x = int(round((x / 1000.0) * screen_w))
        phys_y = int(round((y / 1000.0) * screen_h))
        return max(0, min(phys_x, screen_w - 1)), max(0, min(phys_y, screen_h - 1))

    def moveTo(self, x, y, **kwargs):
        px, py = self._get_phys_coords(x, y)
        return self._backend.moveTo(px, py, **kwargs)

    def click(self, x=None, y=None, **kwargs):
        if x is not None and y is not None:
            x, y = self._get_phys_coords(x, y)
        return self._backend.click(x, y, **kwargs)

    def doubleClick(self, x=None, y=None, **kwargs):
        if x is not None and y is not None:
            x, y = self._get_phys_coords(x, y)
        return self._backend.doubleClick(x, y, **kwargs)

    def rightClick(self, x=None, y=None, **kwargs):
        if x is not None and y is not None:
            x, y = self._get_phys_coords(x, y)
        return self._backend.rightClick(x, y, **kwargs)

    def dragTo(self, x, y, **kwargs):
        px, py = self._get_phys_coords(x, y)
        return self._backend.dragTo(px, py, **kwargs)

    def typewrite(self, text, interval=0.1):
        return self._backend.write(text, interval=interval)

    def __getattr__(self, name):
        # 对于不需要转换坐标的方法（如 press, hotkey 等），直接透传给 pyautogui
        return getattr(self._backend, name)

# 全局单例
screen_adapter = ScreenAdapter()
scaled_pyautogui = ScaledPyAutoGUI()
