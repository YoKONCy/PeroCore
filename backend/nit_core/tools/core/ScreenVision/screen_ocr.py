import os
import tempfile
import pyautogui
import easyocr
import numpy as np
from PIL import Image
import base64
import io

# 全局初始化 reader，避免每次调用都重新加载模型
# ['ch_sim', 'en'] 表示支持简体中文和英文
_reader = None

def get_screenshot_base64():
    """获取当前屏幕截图并返回 base64 编码的字符串"""
    try:
        screenshot = pyautogui.screenshot()
        buffered = io.BytesIO()
        screenshot.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return img_str
    except Exception as e:
        return f"获取截图失败: {str(e)}"

def save_screenshot():
    """获取当前屏幕截图并保存到临时文件，返回文件路径"""
    try:
        # 创建临时文件
        temp_dir = os.path.join(os.getcwd(), "temp_vision")
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_file = tempfile.NamedTemporaryFile(suffix=".png", dir=temp_dir, delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        screenshot = pyautogui.screenshot()
        screenshot.save(temp_path)
        return temp_path
    except Exception as e:
        print(f"Error saving screenshot: {e}")
        return None

def screen_ocr(return_detail=False):
    """
    获取屏幕截图并识别其中的文字内容。
    :param return_detail: 是否返回详细的坐标信息。如果为 True，返回列表 [{text, box, confidence}]
    """
    global _reader
    try:
        # 懒加载 reader
        if _reader is None:
            # gpu=False 确保在没有显卡的环境也能跑，虽然慢一点但稳定
            _reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
            
        # 截图
        screenshot = pyautogui.screenshot()
        
        # EasyOCR 需要 numpy 数组格式
        img_np = np.array(screenshot)
        
        if return_detail:
            # 返回详细结果：[([[x,y], [x,y], [x,y], [x,y]], text, confidence), ...]
            raw_results = _reader.readtext(img_np)
            results = []
            for (box, text, prob) in raw_results:
                results.append({
                    "text": text,
                    "box": box, # 四个顶点的坐标
                    "confidence": prob
                })
            return results
        else:
            # 只返回识别到的文字列表
            results = _reader.readtext(img_np, detail=0)
            
            if not results:
                return "屏幕上似乎没有识别到明显的文字内容。"
                
            text = "\n".join(results)
            return f"屏幕文字识别结果：\n{text}"
    except Exception as e:
        return f"OCR 识别过程中出现错误：{str(e)}"

def find_text_coordinates(target_text: str):
    """
    在屏幕上查找指定文字的逻辑坐标 (0-1000)。
    """
    from utils.screen_adapter import screen_adapter
    
    details = screen_ocr(return_detail=True)
    if isinstance(details, str): # 报错信息
        return None
        
    for item in details:
        if target_text.lower() in item["text"].lower():
            # 计算中心点
            box = item["box"]
            center_x = sum([p[0] for p in box]) / 4
            center_y = sum([p[1] for p in box]) / 4
            
            # 转换为逻辑坐标
            log_x, log_y = screen_adapter.get_logical_coords(center_x, center_y)
            return {"x": log_x, "y": log_y, "text": item["text"]}
            
    return None

def take_screenshot(count: int = 1):
    """
    这是一个占位函数。实际的截图获取和注入逻辑在 agent_service.py 中处理。
    """
    return f"已请求获取 {count} 张截图。"

# 已废弃：Native Tool Definition 移除，仅保留函数实现供 NIT 调用
# TOOLS_DEFINITIONS = [...]
