# NIT (Non-invasive Integration Tools) 技术手册

> **版本**: 2.2 (NIT 2.0 Pipeline & Interpreter)
> **最后更新**: 2026-01-04
> **适用范围**: PeroCore 核心开发与插件生态

---

## 1. 概览 (Overview)

### 1.1 什么是 NIT？
NIT (Non-invasive Integration Tools) 是一套**基于脚本解释器的 AI 工具调用协议**。它不依赖 LLM 厂商原生的 Function Calling API，而是允许模型在回复中嵌入一段 `<nit>` 脚本代码。

在 NIT 2.0 中，我们引入了一个微型解释器（Interpreter），使得 Agent 能够编写包含**变量赋值**、**依赖传递**和**异步任务**的复杂逻辑，从而实现真正的“思考与执行”流水线。

### 1.2 为什么选择 NIT？
传统的 Function Calling (Native Tools) 往往只能处理单次、独立的函数调用。而在构建 PeroCore 时，我们面临着更复杂的场景：
*   **依赖地狱**: "先读取文件 A，用它的内容去搜索 B，最后把结果发给 C"。原生工具通常需要多次往返交互才能完成。
*   **上下文丢失**: 中间结果（如巨大的文件内容）往往不需要全部回传给 LLM，只需在内部传递引用。
*   **阻塞问题**: 某些任务（如生成图片）耗时较长，不应阻塞 Agent 与用户的正常对话。

**NIT 2.0 的核心优势**：
1.  **流水线编排 (Pipeline)**: 支持多步操作一次性下发，中间变量自动传递。
2.  **变量作用域 (Scoping)**: 能够将工具的输出赋值给变量 (`$var`)，避免将大量中间数据塞回 Prompt。
3.  **异步并发 (Async)**: 使用 `async` 关键字标记任务，使其在后台运行，不阻塞主线程交互。
4.  **模型无关**: 纯文本协议，适用于任何具备代码生成能力的 LLM。

### 1.3 设计哲学 (Design Philosophy)
*   **非侵入性 (Non-invasive)**:
    *   **对前端零改动**: 通过 Stream Filter，用户完全感知不到脚本的执行，只看到最终的自然语言回复。
    *   **对模型零门槛**: 只要模型能写代码，就能用 NIT。
*   **认知工学 (AI-Centric)**:
    *   **像人类一样思考**: 允许 AI 在对话中“自言自语”地规划代码，而不是被迫填充僵化的 JSON。
    *   **容错设计**: 解释器具备模糊匹配能力，能自动修正常见的语法微瑕。

---

## 2. 协议规范 (Protocol Specification)

NIT 2.0 采用类 XML 的 `<nit>` 标签包裹一段类 Python 的 DSL 脚本。

### 2.1 基础语法
```nit
<nit>
# 这是一个注释
$var_name = function_name(arg1="value", arg2=123)
async another_function(input=$var_name)
</nit>
```

*   **标签**: `<nit>` 和 `</nit>` (大小写不敏感)。
*   **变量**: 以 `$` 开头，如 `$result`。用于存储工具调用的返回值。
*   **赋值**: 使用 `=` 将函数结果赋给变量。
*   **函数调用**: `func_name(key=value, ...)`。支持位置参数和关键字参数。
*   **异步调用**: 在函数名前加 `async` 关键字，表示该任务在后台执行，不等待结果。

### 2.2 参数类型
*   **字符串**: 双引号包裹 `"hello world"`。
*   **数字**: 直接书写 `123`, `3.14`。
*   **布尔值**: `true`, `false` (大小写不敏感)。
*   **变量引用**: `$prev_result` (作为参数传递时，解释器会自动解析为其实际值)。

### 2.3 示例

#### 场景 1：串行依赖 (Pipeline)
"读取配置文件，然后根据配置搜索内容。"
```nit
<nit>
$config = read_file(path="config.json")
$search_results = google_search(query=$config, limit=5)
write_file(path="report.txt", content=$search_results)
</nit>
```

#### 场景 2：异步任务 (Async)
"帮我画一张图，同时继续跟我聊天。"
```nit
<nit>
async generate_image(prompt="cat running in cyberpunk city", callback="notify_user")
</nit>
```
*(Agent 在下发此指令后，可以立即生成后续的自然语言回复，无需等待画图结束)*

---

## 3. 系统架构与核心组件

NIT 2.0 的架构升级为标准的解释器模式：

### 3.1 核心组件

#### 3.1.1 NITInterpreter (解释器)
包含三个子模块：
*   **Lexer (词法分析器)**: 将 `<nit>` 块内的文本转化为 Token 流（IDENTIFIER, STRING, ASYNC, EQ...）。
*   **Parser (语法分析器)**: 将 Token 流解析为抽象语法树 (AST)，包含 `AssignmentNode`, `CallNode` 等。
*   **Runtime (运行时)**: 遍历 AST 执行逻辑，管理变量符号表 (Symbol Table) 和函数分发。

#### 3.1.2 NITStreamFilter (流式过滤器)
*   **职责**: 实时监控 LLM 输出流。
*   **逻辑**: 检测到 `<nit>` 时进入缓冲模式，隐藏脚本内容；检测到 `</nit>` 后执行脚本并将缓冲区的**非脚本内容**释放。
*   **效果**: 用户只看到 AI 的回复，看不到背后的代码执行。

#### 3.1.3 Hybrid Dispatcher (混合调度器)
*   **职责**: 兼容 NIT 2.0 脚本、NIT 1.0 块 (`[[[NIT_CALL]]]`) 和原生 Tool Calls。
*   **策略**: 优先尝试解析 NIT 2.0，失败则回退到 1.0 或原生模式。

---

## 4. 遗留协议支持 (Legacy Support: NIT 1.0)

为了保持向后兼容，PeroCore 依然支持 NIT 1.0 的块标记语法。调度器会自动识别以下格式：

```text
[[[NIT_CALL]]]
PluginName
param1: [START] value1 [END]
param2: [START] value2 [END]
[[[NIT_END]]]
```

**迁移建议**: 新开发的插件和 Prompt 应优先使用 `<nit>` 语法，旧版语法将作为 fallback 长期存在，但不建议用于新功能。

---

## 5. MCP 兼容层 (MCP Bridge)

NIT 2.0 同样内置了对 MCP (Model Context Protocol) 的支持，通过 `mcp_bridge` 函数实现。

**调用示例**:
```nit
<nit>
$result = mcp_bridge(
    server="google-search",
    tool="search",
    arguments={"query": "NIT protocol 2.0"}
)
</nit>
```

---

## 6. 协同学习机制 (Collaborative Learning)

*(本节内容核心理念未变，适用于所有版本的 NIT)*

### 6.1 与记忆系统的深度集成
NIT协议的核心创新之一是与PeroCore记忆系统的完美协同，实现AI工具使用能力的持续进化：

#### 6.1.1 经验记录与反思学习
```python
# 每次NIT工具调用都会被完整记录
class AgentService:
    async def _handle_nit_execution(self, script: str):
        # 1. 解释器执行脚本
        results = await self.interpreter.execute(script)
        
        # 2. 调用结果自动进入记忆系统
        # 成功/失败都会被记录为学习数据
        
        # 3. 标记为[反思簇]用于后续学习
```

#### 6.1.2 学习循环机制
1. **尝试阶段**: AI使用NIT协议调用工具，可能成功或失败
2. **记录阶段**: 完整上下文（包括错误信息）被保存到记忆系统
3. **反思阶段**: ScorerService将失败经历标记为[反思簇]
4. **优化阶段**: 在类似场景下，Chain-Net检索快速召回相关经验
5. **进化阶段**: 工具使用策略随时间持续优化

### 6.2 容错设计的哲学意义
NIT协议的"允许犯错"设计不仅仅是技术选择，更是AI培养理念：

> **🛡️ 核心设计声明**: 在NIT协议下，AI偶尔会犯错，但我们**容许AI犯错**。这种"容错性"是PeroCore进化能力的基石。

*   **安全网效应**: AI知道犯错不会导致对话中断，更愿意尝试新方法
*   **经验积累**: 每次错误都成为宝贵的学习数据，而非单纯的失败
*   **渐进式成长**: 从试探性调用到熟练使用的平滑学习曲线

#### 为什么容许犯错是必要的？
传统的严格错误处理机制追求"零失败"，但这实际上限制了AI的学习能力：

```
严格模式: AI → 小心翼翼 → 不敢尝试 → 停留在舒适区 → 成长受限
容错模式: AI → 大胆尝试 → 从错误学习 → 扩展能力边界 → 持续进化
```

#### 错误的积极价值
- **探索价值**: 错误往往发生在AI尝试新方法时，这是创新的必经之路
- **诊断价值**: 错误模式帮助我们了解AI的认知盲点和系统局限
- **教学价值**: 每次错误后的反思过程都是一次深度学习机会

#### 错误类型与处理策略
| 错误类型 | 处理方式 | 学习价值 |
|----------|----------|----------|
| 参数格式错误 | 解释器自动修正 + 记录 | 高 - 学会参数规范 |
| 变量依赖错误 | 运行时报错 + 反思 | 高 - 理解逻辑链条 |
| 权限不足错误 | 提示用户 + 记录 | 中 - 了解系统边界 |
| 网络超时错误 | 重试 + 降级策略 | 低 - 外部因素，学习有限 |

---

## 7. 技术权衡与限制 (Technical Trade-offs)

### 7.1 设计权衡
采用 NIT 2.0 解释器是在以下维度间做出的权衡：

| 维度 | NIT 1.0 (Regex) | NIT 2.0 (Interpreter) | Native Tools |
|------|-----------------|-----------------------|--------------|
| **表达能力** | 低 (单次调用) | **高 (变量/逻辑/异步)** | 中 (单次/嵌套) |
| **解析开销** | 极低 | 中 (需构建 AST) | 低 |
| **容错能力** | 中 (强边界符) | **极高 (模糊解析)** | 低 (Schema 校验) |
| **上下文消耗** | 高 (Verbose) | **中 (紧凑代码)** | 中 |

### 7.2 已知限制
*   **解释器开销**: 相比简单的正则提取，Lexer/Parser 引入了约 5-10ms 的额外 CPU 开销（在 Python 层面可忽略）。
*   **学习曲线**: 虽然 DSL 很简单，但 Prompt 需要清晰地教会 LLM 如何使用变量赋值（我们已通过 `ability_nit.md` 解决）。
*   **安全性**: 虽然是受限解释器，但允许执行代码始终存在潜在风险。我们通过**沙箱环境**和**白名单函数**来严格限制其能力。

---

## 8. 生态展望

NIT 2.0 的解释器架构为未来扩展打开了大门：
*   **控制流**: 未来可能支持 `if/else` 或 `loop`，让 Agent 编写更复杂的微程序。
*   **社区插件**: 标准化的 DSL 使得分享 Prompt 和 Tool Definition 变得更加容易。

> **加入我们**: 如果你基于 NIT 开发了有趣的插件，欢迎提交 PR 或在社区分享你的实现！
