import subprocess
import os
import platform
import pyautogui
import shutil
import winreg
import time
import pyperclip
from utils.screen_adapter import screen_adapter, scaled_pyautogui

def find_app_path(app_name: str):
    """
    聪明型路径搜索器：尝试通过多种方式定位应用程序的完整路径。
    """
    # 1. 已经是存在的绝对路径或相对路径
    if os.path.exists(app_name):
        return os.path.abspath(app_name)
    
    # 2. 在 PATH 环境变量里寻找 (shutil.which)
    path_found = shutil.which(app_name)
    if path_found:
        return path_found
        
    # 3. 在注册表 "App Paths" 中寻找 (Windows 软件通用注册位置)
    # 尝试带 .exe 和不带 .exe 的两种情况
    names_to_try = [app_name, f"{app_name}.exe"] if not app_name.lower().endswith(".exe") else [app_name]
    
    for name in names_to_try:
        for root in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
            try:
                reg_path = f"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{name}"
                with winreg.OpenKey(root, reg_path) as key:
                    # 获取默认值 (即程序路径)
                    path, _ = winreg.QueryValueEx(key, "")
                    if path and os.path.exists(path):
                        return path
            except (FileNotFoundError, OSError):
                continue
                
    return None

def open_application(app_name: str):
    """
    打开 Windows 应用程序。
    使用增强的搜索逻辑，优先使用 os.startfile 以获得更安全、无黑窗的体验。
    """
    if not app_name:
        return "请提供要打开的应用程序名称。"

    app_name = app_name.strip()
    
    try:
        # 尝试寻找完整路径
        full_path = find_app_path(app_name)
        
        if full_path:
            # 使用 os.startfile 打开，这相当于双击文件，最稳健
            os.startfile(full_path)
            return f"已成功通过路径打开: {full_path}"
        else:
            # 如果实在找不到确切路径，退回到使用 start 命令 (shell 模式)
            # 这种方式可以处理一些特殊的协议名，如 'calc:', 'notepad:' 等
            subprocess.Popen(f'start "" "{app_name}"', shell=True)
            return f"未找到确切路径，已尝试通过系统命令开启: {app_name}"
            
    except Exception as e:
        return f"打开应用 '{app_name}' 失败: {str(e)}"

def get_system_status():
    """
    获取简单的 Windows 系统状态信息。
    """
    try:
        info = {
            "os": platform.system(),
            "version": platform.version(),
            "machine": platform.machine(),
            "node": platform.node(),
            "screen_size": list(pyautogui.size())
        }
        return f"当前系统信息: {info}"
    except Exception as e:
        return f"获取系统信息失败: {str(e)}"

def get_mouse_position():
    """
    获取当前鼠标位置（逻辑坐标 0-1000）。
    """
    try:
        x, y = pyautogui.position()
        log_x, log_y = screen_adapter.get_logical_coords(x, y)
        return f"当前鼠标位置: 逻辑坐标 ({log_x}, {log_y}) | 物理坐标 ({x}, {y})"
    except Exception as e:
        return f"获取鼠标位置失败: {str(e)}"

# Use absolute import from backend
try:
    from backend.nit_core.tools.core.ScreenVision.screen_ocr import find_text_coordinates
except ImportError:
    try:
        from nit_core.tools.core.ScreenVision.screen_ocr import find_text_coordinates
    except ImportError:
        from tools.ScreenVision.screen_ocr import find_text_coordinates

def safe_int(val):
    """Safely convert value to int, returning None if conversion fails."""
    if val is None:
        return None
    try:
        return int(float(val))  # Handle string floats like "100.0"
    except (ValueError, TypeError):
        return None

def automation_execute(action: str, target: str = None, x: int = None, y: int = None, x2: int = None, y2: int = None, target_text: str = None):
    """
    执行自动化操作。
    """
    # Robustly cast coordinates to integers
    x = safe_int(x)
    y = safe_int(y)
    x2 = safe_int(x2)
    y2 = safe_int(y2)

    try:
        # 如果提供了文字目标但没有坐标，尝试通过 OCR 定位
        if target_text and x is None and y is None:
            coords = find_text_coordinates(target_text)
            if coords:
                x, y = coords["x"], coords["y"]
                print(f"OCR 定位成功: '{target_text}' -> ({x}, {y})")
            else:
                return f"未能在屏幕上找到文字: '{target_text}'"

        if action == "click":
            # 增加 duration 使鼠标移动更拟人化，同时提高点击准确率（给予UI响应hover的时间）
            if x is not None and y is not None:
                scaled_pyautogui.moveTo(x, y, duration=0.6)
            scaled_pyautogui.click()
            return f"已在{'文字 ' + target_text + ' 所在的' if target_text else ''}逻辑坐标 ({x}, {y}) 执行点击。"
        elif action == "double_click":
            if x is not None and y is not None:
                scaled_pyautogui.moveTo(x, y, duration=0.6)
            scaled_pyautogui.doubleClick()
            return f"已在{'文字 ' + target_text + ' 所在的' if target_text else ''}逻辑坐标 ({x}, {y}) 执行双击。"
        elif action == "right_click":
            if x is not None and y is not None:
                scaled_pyautogui.moveTo(x, y, duration=0.6)
            scaled_pyautogui.rightClick()
            return f"已在{'文字 ' + target_text + ' 所在的' if target_text else ''}逻辑坐标 ({x}, {y}) 执行右键点击。"
        elif action == "drag":
            if x is not None and y is not None and x2 is not None and y2 is not None:
                scaled_pyautogui.moveTo(x, y)
                scaled_pyautogui.dragTo(x2, y2, duration=0.5)
                return f"已将内容从 ({x}, {y}) 拖拽到 ({x2}, {y2})。"
            return "拖拽操作需要起始坐标 (x, y) 和目标坐标 (x2, y2)。"
        elif action == "type":
            if not target:
                return "请输入要输入的内容 (target)。"
            
            # 使用“剪贴板大法”：先复制到剪贴板，再模拟 Ctrl+V
            # 这种方式免疫输入法干扰，且支持中文、特殊符号
            try:
                # 1. 备份当前剪贴板内容 (可选，但为了不打扰用户原有的剪贴板，最好做一下，这里简化处理直接覆盖)
                # old_clip = pyperclip.paste()
                
                # 2. 写入新内容
                pyperclip.copy(target)
                
                # 3. 短暂等待确保写入生效
                time.sleep(0.1)
                
                # 4. 模拟粘贴
                scaled_pyautogui.hotkey('ctrl', 'v')
                
                return f"已通过剪贴板输入文字: {target}"
            except Exception as e:
                # 如果剪贴板操作失败，回退到普通输入（虽然可能会受输入法影响）
                scaled_pyautogui.typewrite(target)
                return f"剪贴板输入失败，已回退到普通输入: {target} (错误: {str(e)})"

        elif action == "hotkey":
            # 支持组合键，如 "ctrl", "c"
            keys = target.replace(" ", "").split("+")
            scaled_pyautogui.hotkey(*keys)
            return f"已执行组合键: {target}"
        elif action == "notification":
            title = target or "Pero 提醒"
            message = target_text or "主人，我有事情要告诉你哦！"
            
            # 使用 PowerShell 发送 Windows 11 原生通知
            ps_script = f"""
            $title = "{title}"
            $message = "{message}"
            [void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
            $notification = New-Object System.Windows.Forms.NotifyIcon
            $notification.Icon = [System.Drawing.SystemIcons]::Information
            $notification.Visible = $true
            $notification.ShowBalloonTip(5000, $title, $message, [System.Windows.Forms.ToolTipIcon]::Info)
            """
            # 注意：上述是旧式气泡通知。对于 Win11 原生 Toast，使用以下更现代的方法：
            modern_ps_script = f"""
            $Title = "{title}"
            $Text = "{message}"
            $Template = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
            $RawText = $Template.GetElementsByTagName("text")
            $RawText[0].AppendChild($Template.CreateTextNode($Title)) > $null
            $RawText[1].AppendChild($Template.CreateTextNode($Text)) > $null
            $Notification = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::new($Template)
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier("PeroCore").Show($Notification)
            """
            
            try:
                subprocess.run(["powershell", "-Command", modern_ps_script], capture_output=True, check=True)
                return f"已发送通知: {title} - {message}"
            except Exception as e:
                # 降级到简单弹窗
                return f"发送通知失败: {str(e)}"
        elif action == "debug_cursor":
            if x is not None and y is not None:
                scaled_pyautogui.moveTo(x, y, duration=1.0)
                return f"已将鼠标移动到逻辑坐标 ({x}, {y}) 以供调试。"
            return "Debug cursor requires x and y coordinates."
        return "未知的自动化动作。"
    except Exception as e:
        return f"自动化操作失败: {str(e)}"

# 已废弃：Native Tool Definition 移除，仅保留函数实现供 NIT 调用
# tool_definition = {...}

def windows_operation(action: str, target: str = None, x: int = None, y: int = None, x2: int = None, y2: int = None, target_text: str = None):
    # Ensure coordinates are safely converted at the entry point as well
    x = safe_int(x)
    y = safe_int(y)
    x2 = safe_int(x2)
    y2 = safe_int(y2)

    if action == "open_app":
        return open_application(target)
    elif action == "get_info":
        return get_system_status()
    elif action == "get_mouse_pos":
        return get_mouse_position()
    else:
        return automation_execute(action, target, x, y, x2, y2, target_text)
