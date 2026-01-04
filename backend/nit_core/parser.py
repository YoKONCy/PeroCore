import re
import asyncio
from typing import Dict, Any, List, Optional
import json

class NITParser:
    """
    NIT 协议解析器
    负责从文本流中提取工具调用指令
    协议格式：
    <<<[NIT_CALL]>>>
    PluginName
    param1: [START] value1 [END]
    param2: [START] value2 [END]
    <<<[NIT_END]>>>
    """
    
    # 核心正则模式
    # 1. 捕获完整的 NIT 调用块
    BLOCK_PATTERN = re.compile(r'\[\[\[NIT_CALL\]\]\](.*?)\[\[\[NIT_END\]\]\]', re.DOTALL)
    
    # 2. 捕获参数行：key: [START] value [END]
    # 使用非贪婪匹配，支持多行 value
    PARAM_PATTERN = re.compile(r'^\s*([a-zA-Z0-9_-]+)\s*:\s*\[START\](.*?)\[END\]', re.MULTILINE | re.DOTALL)

    @staticmethod
    def parse_text(text: str) -> List[Dict[str, Any]]:
        """
        解析文本中的所有 NIT 调用指令
        """
        calls = []
        
        # 查找所有调用块
        matches = NITParser.BLOCK_PATTERN.finditer(text)
        
        for match in matches:
            block_content = match.group(1).strip()
            lines = block_content.split('\n', 1)
            
            if not lines:
                continue
                
            # 第一行是插件名
            plugin_name = lines[0].strip()
            params = {}
            
            # 解析剩余内容中的参数
            if len(lines) > 1:
                param_content = lines[1]
                # 使用 finditer 查找所有参数对
                # 注意：由于正则包含 MULTILINE，我们需要确保它能正确处理跨行 value
                # 这里我们采用一种更鲁棒的手动解析方式来配合正则
                
                # 方案：直接使用正则查找所有 key: [START] ... [END] 结构
                # 这种方式对于嵌套的 [START] [END] 可能会有问题，但作为 v1 版本足够鲁棒
                # 如果 value 中包含 [END]，正则的非贪婪匹配会提前结束。
                # 改进：由于 [START] [END] 是强边界，我们可以假设 value 内部不会出现未转义的 [END]
                # 或者依靠 LLM 的生成能力。
                
                param_matches = re.finditer(r'([a-zA-Z0-9_-]+)\s*:\s*\[START\](.*?)\[END\]', param_content, re.DOTALL)
                
                for p_match in param_matches:
                    key = p_match.group(1).strip()
                    value = p_match.group(2).strip()
                    # 归一化 key: 转小写，去下划线/连字符
                    norm_key = key.lower().replace('_', '').replace('-', '')
                    params[norm_key] = value
            
            calls.append({
                "plugin": plugin_name,
                "params": params,
                "raw_block": match.group(0) # 用于后续后续的文本替换/隐藏
            })
            
        return calls

    @staticmethod
    def remove_nit_blocks(text: str) -> str:
        """
        移除文本中所有的 NIT 调用块
        """
        return NITParser.BLOCK_PATTERN.sub('', text).strip()

    @staticmethod
    def normalize_key(key: str) -> str:
        return key.lower().replace('_', '').replace('-', '')

class NITStreamFilter:
    """
    NIT 流式过滤器
    用于在流式输出过程中拦截并隐藏 NIT 调用块
    """
    def __init__(self):
        self.buffer = ""
        self.in_nit_block = False
        self.marker_start = "[[[NIT_CALL]]]"
        self.marker_end = "[[[NIT_END]]]"

    def filter(self, chunk: str) -> str:
        """
        处理输入的文本片段，返回应当显示给用户的文本
        """
        self.buffer += chunk
        
        output = ""
        
        while self.buffer:
            if not self.in_nit_block:
                # 寻找可能的开始标记
                start_idx = self.buffer.find("[")
                if start_idx == -1:
                    # 完全没有 [，可以安全输出全部
                    output += self.buffer
                    self.buffer = ""
                elif start_idx > 0:
                    # [ 之前的部分可以安全输出
                    output += self.buffer[:start_idx]
                    self.buffer = self.buffer[start_idx:]
                else:
                    # 缓冲区以 [ 开头，检查是否匹配 marker_start 的前缀
                    if self.marker_start.startswith(self.buffer):
                        # 是前缀，但还没收全，继续等待
                        if self.buffer == self.marker_start:
                            self.in_nit_block = True
                            self.buffer = "" # 吞掉标记
                        break
                    elif self.buffer.startswith(self.marker_start):
                        # 已经包含了完整的标记
                        self.in_nit_block = True
                        self.buffer = self.buffer[len(self.marker_start):]
                    else:
                        # 虽然以 [ 开头，但不是 NIT 标记的前缀，输出第一个字符并继续
                        output += self.buffer[0]
                        self.buffer = self.buffer[1:]
            else:
                # 处于 NIT 块内部，寻找结束标记
                end_idx = self.buffer.find(self.marker_end)
                if end_idx != -1:
                    # 找到结束标记，吞掉块内容并恢复正常模式
                    self.buffer = self.buffer[end_idx + len(self.marker_end):]
                    self.in_nit_block = False
                else:
                    # 没找到结束标记，但要小心 buffer 末尾可能正好是 marker_end 的一部分
                    # 我们保留最后几个字符（marker_end 的长度 - 1）在 buffer 中
                    keep_len = len(self.marker_end) - 1
                    if len(self.buffer) > keep_len:
                        # 之前的都可以丢弃（因为我们在块内部）
                        self.buffer = self.buffer[-keep_len:]
                    break
                    
        return output

    def flush(self) -> str:
        """
        冲刷缓冲区，返回剩余的所有文本
        通常在流结束时调用
        """
        # 如果当前在块内部，我们可能遇到了截断的流，或者是不完整的块
        # 但按照非侵入性原则，如果不完整，我们最好还是不要显示它，或者显示出来？
        # 这里选择：如果不在块内部，输出 buffer；如果在块内部，说明块没写完，根据需求决定。
        # 这里为了安全，如果不在块内就输出。
        if not self.in_nit_block:
            res = self.buffer
            self.buffer = ""
            return res
        return ""

class ThinkingStreamFilter:
    """
    思考过程过滤器
    用于过滤 `【Thinking: ...】` 格式的内心独白
    兼容中文冒号 `【Thinking： ...】`
    """
    def __init__(self):
        self.buffer = ""
        self.in_block = False
        self.marker_end = "】"
        # 定义可能的开始标记列表
        self.start_markers = ["【Thinking:", "【Thinking："]

    def filter(self, chunk: str) -> str:
        self.buffer += chunk
        output = ""
        
        while self.buffer:
            if not self.in_block:
                # 寻找可能的开始标记 【
                start_idx = self.buffer.find("【")
                if start_idx == -1:
                    output += self.buffer
                    self.buffer = ""
                elif start_idx > 0:
                    output += self.buffer[:start_idx]
                    self.buffer = self.buffer[start_idx:]
                else:
                    # buffer 以 【 开头
                    # 检查是否匹配任何一个开始标记
                    matched_marker = None
                    is_partial_match = False
                    
                    for marker in self.start_markers:
                        if self.buffer.startswith(marker):
                            matched_marker = marker
                            break
                        if marker.startswith(self.buffer):
                            is_partial_match = True
                    
                    if matched_marker:
                        self.in_block = True
                        self.buffer = self.buffer[len(matched_marker):]
                    elif is_partial_match:
                        # 是某个标记的前缀，等待更多数据
                        break
                    else:
                        # 不是 Thinking 标记，输出第一个字符并继续
                        output += self.buffer[0]
                        self.buffer = self.buffer[1:]
            else:
                end_idx = self.buffer.find(self.marker_end)
                if end_idx != -1:
                    self.buffer = self.buffer[end_idx + len(self.marker_end):]
                    self.in_block = False
                else:
                    break
        return output

    def flush(self) -> str:
        if not self.in_block:
            res = self.buffer
            self.buffer = ""
            return res
        return ""

class XMLStreamFilter:
    """
    XML 标签流式过滤器
    用于在流式输出过程中拦截并隐藏 <TAG>Content</TAG> 形式的内容
    支持 [A-Z_]+ 形式的大写标签
    """
    def __init__(self):
        self.buffer = ""
        self.in_tag = False
        self.current_tag = "" # 记录当前正在过滤的标签名

    def filter(self, chunk: str) -> str:
        self.buffer += chunk
        output = ""
        
        while self.buffer:
            if not self.in_tag:
                # 寻找可能的开始标记 <
                start_idx = self.buffer.find("<")
                if start_idx == -1:
                    # 没有 <，全部输出
                    output += self.buffer
                    self.buffer = ""
                elif start_idx > 0:
                    # < 之前的内容输出
                    output += self.buffer[:start_idx]
                    self.buffer = self.buffer[start_idx:]
                else:
                    # 以 < 开头，检查是否构成有效标签
                    # 我们需要找到 > 来确认标签名
                    end_idx = self.buffer.find(">")
                    if end_idx == -1:
                        # 还没闭合，等待更多数据
                        # 保护机制：如果 buffer 过长且没找到 >，可能不是标签
                        if len(self.buffer) > 50: 
                             # 假定不是标签，输出第一个字符
                             output += self.buffer[0]
                             self.buffer = self.buffer[1:]
                        break
                    else:
                        # 找到了 >，检查中间的内容是否是 [A-Z_]+
                        tag_content = self.buffer[1:end_idx]
                        if re.fullmatch(r'[A-Z_]+', tag_content):
                            # 是我们要过滤的标签
                            self.in_tag = True
                            self.current_tag = tag_content
                            self.buffer = self.buffer[end_idx+1:]
                        else:
                            # 不是我们要过滤的标签 (e.g. <br>, <div>, < 5)
                            # 输出直到 > 的内容
                            output += self.buffer[:end_idx+1]
                            self.buffer = self.buffer[end_idx+1:]
            else:
                # 在标签内部，寻找结束标记 </TAG>
                # 结束标记应该是 </TAG>
                end_tag = f"</{self.current_tag}>"
                end_idx = self.buffer.find(end_tag)
                
                if end_idx != -1:
                    # 找到了结束标记
                    # 丢弃 buffer 中直到 end_tag 结束的所有内容
                    self.buffer = self.buffer[end_idx + len(end_tag):]
                    self.in_tag = False
                    self.current_tag = ""
                else:
                    # 没找到结束标记
                    # 检查 buffer 末尾是否可能是结束标记的前缀
                    # 比如 buffer 结尾是 "<", "</", "</T", ...
                    # 最长可能匹配是 len(end_tag) - 1
                    
                    # 简单的保护：保留最后 len(end_tag) 长度的字符，其他的丢弃（因为在 tag 内部）
                    # 这样可以防止内存无限增长
                    keep_len = len(end_tag)
                    if len(self.buffer) > keep_len:
                        self.buffer = self.buffer[-keep_len:]
                    break
        
        return output
    
    def flush(self) -> str:
        # 如果还在 tag 内部，说明 tag 没有闭合。
        # 通常这意味模型输出截断。我们选择不输出被吞掉的内容。
        if not self.in_tag:
            res = self.buffer
            self.buffer = ""
            return res
        return ""
