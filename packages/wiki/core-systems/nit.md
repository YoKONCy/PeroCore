# NIT 协议 (Non-invasive Integration Tools)

> **"Code is the best prompt."**
>
> NIT 是 PeroCore 独创的工具调用协议，它允许大模型通过编写微型脚本（DSL）来编排复杂的工具链，实现了“思考”与“行动”的统一。

## 1. 为什么需要 NIT？

传统的 Function Calling 存在以下局限：

- **单步限制**: 每次只能执行一步操作，无法处理 "A -> B -> C" 的依赖链。
- **上下文丢失**: 中间结果（如 OCR 的大段文本）必须回传给 LLM，浪费 Token 且易超长。
- **阻塞交互**: 无法在执行耗时任务（如画图）的同时继续与用户聊天。

NIT 2.0 通过引入一个**嵌入式解释器**解决了这些问题。它不仅仅是一个协议，更是一种**AI专属**的“自然语言”。

## 2. 协议规范 (Protocol Specification)

NIT 脚本被包裹在 XML 风格的标签中，内部采用类 Python 的 DSL (Domain Specific Language) 语法。

### 2.1 基础结构

```nit
<nit>
# 1. 变量赋值 (同步执行)
$context = get_screen_content()

# 2. 依赖传递
# 将上一元操作的结果 ($context) 直接作为参数传递，无需回传给 LLM
$summary = summarize_text(content=$context)

# 3. 异步任务 (非阻塞)
# 标记为 async 的任务会在后台执行，Agent 可以立即回复用户
async notify_user(msg="正在分析屏幕内容...")
</nit>
```

### 2.2 关键特性

- **变量 ($variable)**: 用于存储中间结果，支持强类型（String, Number, Boolean, Object）。变量存在于 Session 级别的符号表中，生命周期贯穿整轮对话。
- **异步 (async)**: 标记为 `async` 的函数调用会被提交到后台线程池，不会阻塞主线程的 Token 生成。这使得 PeroCore 可以“一边思考，一边说话”。
- **强类型参数**: 参数传递支持嵌套结构（List/Dict），解释器会自动进行类型检查和转换。

## 3. 插件开发规范 (Plugin Specification)

目前 PeroCore 的工具插件已实现完全统一化。一个标准的工具插件目录必须包含以下三个核心部分：

### 3.1 核心代码 (Core Code)

实现工具逻辑的 Python 文件（或通过 Bridge 调用的其他语言）。

- **位置**: 插件根目录下（如 `bilibili_fetch.py`）。
- **要求**: 函数应尽量设计为异步（`async def`），并返回可序列化的对象。

### 3.2 自然语言描述 (description.json)

用于在 System Prompt 中向 LLM 描述工具的功能和调用方式。

- **作用**: 这是 LLM 理解工具的主入口。相比复杂的 JSON Schema，简单的自然语言描述能显著降低模型幻觉。
- **核心字段**:
  - `commandIdentifier`: 工具的唯一 ID。
  - `description`: 描述该工具的具体用途和触发场景。
  - `parameter`: 使用自然语言描述参数格式（如：“视频链接或BV号 (url)”）。

### 3.3 标准 Schema (schema.json)

使用标准的 **JSON Schema** 格式列出所有工具。

- **作用**:
  1. **后备方案**: 在边缘情况下（如模型能力受限或需要精准参数校验），系统会自动回退到传统的 `tools` 字段 Function Calling 模式。
  2. **类型检查**: 运行时解释器会参考该文件进行严格的参数类型验证。

## 4. 核心架构 (Architecture)

NIT 系统的核心是一个混合语言实现的解释器栈，兼顾了开发的灵活性和执行的高性能。

### 4.1 技术栈

- **Frontend (Lexer/Parser)**: 使用 **Rust** 编写 (基于 PyO3 绑定)，利用 Rust 的强类型系统和零拷贝特性实现毫秒级解析。
- **Backend (Runtime)**: 使用 **Python** 编写，负责函数分发、上下文管理和 MCP 桥接。

### 4.2 组件交互图

1.  **LLM Output**: 模型输出包含 `<nit>` 标签的文本流。
2.  **Stream Filter**: 实时拦截流，检测到 `<nit>` 标签时进入“缓冲模式”，隐藏代码块，只将自然语言透传给前端。
3.  **Interpreter**: 负责 Lexer、Parser 和 Runtime 执行。
4.  **Dispatcher**: 统一调度层，根据 `description.json` 注册工具，并将调用分发给本地插件或 MCP 服务。

## 5. 安全机制 (Security)

为了防止 Prompt 注入攻击，NIT 2.0 引入了 **动态握手 (Dynamic Handshake)** 机制。

- **Session ID**: 每一轮对话开始时，系统都会生成一个随机的 4 位 ID (e.g., `A1B2`)。
- **Prompt Injection**: 这个 ID 会通过 System Prompt 注入给 LLM。
- **Strict Matching**: LLM 必须输出 `<nit-A1B2>` 才能触发执行。

## 6. 生态兼容 (Ecosystem)

- **Native Tools**: 遵循上述三部分规范的内置插件。
- **MCP Bridge**: 自动将 MCP Server 工具映射为 NIT 函数。
- **Legacy Support**: 兼容 NIT 1.0 的 `[[[NIT_CALL]]]` 格式。
