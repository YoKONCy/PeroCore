# NIT 协议 (Non-invasive Integration Tools)

> **"Code is the best prompt."**
>
> NIT 是 PeroCore 独创的工具调用协议，它允许大模型通过编写微型脚本（DSL）来编排复杂的工具链，实现了“思考”与“行动”的统一。

## 1. 为什么需要 NIT？

传统的 Function Calling 存在以下局限：
*   **单步限制**: 每次只能执行一步操作，无法处理 "A -> B -> C" 的依赖链。
*   **上下文丢失**: 中间结果（如 OCR 的大段文本）必须回传给 LLM，浪费 Token 且易超长。
*   **阻塞交互**: 无法在执行耗时任务（如画图）的同时继续与用户聊天。

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
*   **变量 ($variable)**: 用于存储中间结果，支持强类型（String, Number, Boolean, Object）。变量存在于 Session 级别的符号表中，生命周期贯穿整轮对话。
*   **异步 (async)**: 标记为 `async` 的函数调用会被提交到后台线程池，不会阻塞主线程的 Token 生成。这使得 PeroCore 可以“一边思考，一边说话”。
*   **强类型参数**: 参数传递支持嵌套结构（List/Dict），解释器会自动进行类型检查和转换。

## 3. 核心架构 (Architecture)

NIT 系统的核心是一个混合语言实现的解释器栈，兼顾了开发的灵活性和执行的高性能。

### 3.1 技术栈
*   **Frontend (Lexer/Parser)**: 使用 **Rust** 编写 (基于 PyO3 绑定)，利用 Rust 的强类型系统和零拷贝特性实现毫秒级解析。
    *   *Source*: `backend/nit_core/interpreter/rust_binding/`
*   **Backend (Runtime)**: 使用 **Python** 编写，负责函数分发、上下文管理和 MCP 桥接。
    *   *Source*: `backend/nit_core/interpreter/runtime.py`

### 3.2 组件交互图
1.  **LLM Output**: 模型输出包含 `<nit>` 标签的文本流。
2.  **Stream Filter**: 实时拦截流，检测到 `<nit>` 标签时进入“缓冲模式”，隐藏代码块，只将自然语言透传给前端。
3.  **Interpreter**:
    *   **Lexer**: 将代码文本转换为 Token 流。
    *   **Parser**: 构建 AST (抽象语法树)。
    *   **Runtime**: 遍历 AST，解析变量，执行工具调用。
4.  **Dispatcher**: 统一调度层，将调用分发给本地插件 (Native) 或 MCP 服务。

## 4. 安全机制 (Security)

为了防止 Prompt 注入攻击（即攻击者试图伪造工具调用），NIT 2.0 引入了 **动态握手 (Dynamic Handshake)** 机制。

*   **Session ID**: 每一轮对话开始时，系统都会生成一个随机的 4 位 ID (e.g., `A1B2`)。
*   **Prompt Injection**: 这个 ID 会通过 System Prompt 注入给 LLM。
*   **Strict Matching**: LLM 必须输出 `<nit-A1B2>` 才能触发执行。任何不匹配当前 ID 的标签（如 `<nit>` 或 `<nit-OLD1>`）都会被解释器忽略，并作为普通文本显示给用户。

## 5. 生态兼容 (Ecosystem)

NIT 作为一个中间层，完美兼容了现有的工具标准：

*   **Native Tools**: PeroCore 内置的 Python 插件，拥有最高权限。
*   **MCP Bridge**: 内置了对 **Model Context Protocol** (Anthropic) 的支持。NIT 会自动将连接的 MCP Server 暴露的工具映射为 NIT 函数，无需额外适配。
*   **Legacy Support**: 为了保持向后兼容，系统依然支持 NIT 1.0 的 `[[[NIT_CALL]]]` 块格式，确保旧版插件和 Prompt 依然可用。
