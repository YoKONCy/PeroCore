# NIT 协议 Rust 化迁移技术方案 (RFC)

**状态**: 提案中 (Proposed)  
**日期**: 2026-01-15  
**目标**: 提升 NIT (Natural Instruction Tool) 协议解释器的安全性、性能与稳定性。

---

## 1. 背景与现状

目前的 NIT 核心 (`nit_core`) 是一个纯 Python 实现的 AST 解释器，主要由以下组件构成：
- `lexer.py`: 正则表达式驱动的词法分析器。
- `parser.py`: 递归下降语法分析器。
- `engine.py`: 基于 `isinstance` 反射的运行时解释器。
- `security.py`: 基础的 HMAC 签名验证。

### 存在的问题
1.  **安全边界“软”约束**: 变量数量 (`MAX_VARIABLES`) 和字符串长度 (`MAX_VAR_STRING_LENGTH`) 检查在 Python 层进行。这意味着恶意的大内存对象必须先被 Python 分配（可能导致 OOM），然后才能被检查逻辑拦截。
2.  **CPU 密集型瓶颈**: 词法分析和语法分析是纯 Python 循环，处理长指令或高并发请求时占用大量 CPU 时间（GIL 锁问题）。
3.  **类型安全弱**: 依赖运行时的动态类型检查，缺乏编译期的结构验证。

---

## 2. 核心架构提案：混合运行时 (Hybrid Runtime)

我们不追求全量重写，而是采用 **"Compiler in Rust, VM in Python"** 的分层架构。

### 2.1 架构图

```mermaid
graph TD
    UserInput[User Input] --> RustParser
    
    subgraph "Rust Core (High Performance & Security)"
        RustParser[Lexer & Parser]
        RustAST[AST Definitions (PyO3)]
        NITScope[NITScope (Memory Container)]
    end
    
    subgraph "Python Runtime (Async I/O & Dispatch)"
        NITRuntime[NIT Runtime / VM]
        ToolExecutor[Async Tool Executor]
    end
    
    RustParser -->|Returns PyObject| RustAST
    RustAST -->|Fed into| NITRuntime
    NITRuntime -->|Read/Write| NITScope
    NITRuntime -->|Await| ToolExecutor
```

### 2.2 职责划分

| 组件 | 语言 | 职责 | 优势 |
| :--- | :--- | :--- | :--- |
| **Lexer & Parser** | **Rust** | 将源代码转换为 AST | 50-100x 性能提升，绕过 GIL |
| **AST Definitions** | **Rust** | 定义指令结构 (PyO3 Class) | 结构化数据，类型安全 |
| **NITScope** | **Rust** | 变量存储容器 (`HashMap`) | **硬内存限制**，线程安全 |
| **NITRuntime** | **Python** | 遍历 AST，调度异步工具 | 保持与 Python 异步生态 (`await`) 的完美兼容 |

---

## 3. 详细设计

### 3.1 内存安全容器 (`NITScope`)

为了解决 Python 层无法通过“硬限制”防御内存攻击的问题，我们引入 Rust 实现的变量容器。

```rust
// 伪代码示例
#[pyclass]
struct NITScope {
    variables: HashMap<String, String>,
    max_count: usize,
    max_string_len: usize,
}

#[pymethods]
impl NITScope {
    fn set(&mut self, key: String, value: String) -> PyResult<()> {
        if self.variables.len() >= self.max_count {
            return Err(PyValueError::new_err("Variable limit reached"));
        }
        if value.len() > self.max_string_len {
            // 在 Rust 层直接截断或拒绝，避免 Python 堆积大对象
            return Err(PyValueError::new_err("String too large"));
        }
        self.variables.insert(key, value);
        Ok(())
    }
}
```

### 3.2 词法与语法分析

将 `lexer.py` 和 `parser.py` 移植到 Rust。
- **输入**: 原始 NIT 脚本字符串。
- **输出**: Python 对象树 (由 PyO3 导出的 Rust 结构体构建)。

这消除了 Python 在字符处理循环上的巨大开销。

---

## 4. 迁移路线图 (Roadmap)

### Phase 1: 基础设施搭建 (Rust)
- [ ] 在 `rust_core` 中定义 NIT 的 AST 节点 (`AssignmentNode`, `CallNode` 等) 并通过 PyO3 导出。
- [ ] 实现 Rust 版 `Lexer`。
- [ ] 实现 Rust 版 `Parser`。
- [ ] **验证**: 编写 Python 单元测试，确保 Rust Parser 输出的 AST 与原 Python Parser 结构一致。

### Phase 2: 内存容器实现 (Rust)
- [ ] 实现 `NITScope` 类，接管变量存储。
- [ ] 实现严格的内存配额检查 (Quotas)。

### Phase 3: 运行时嫁接 (Python)
- [ ] 修改 `interpreter/runtime.py`。
- [ ] 移除旧的 `lexer.py` 和 `parser.py` 调用。
- [ ] 将 `self.variables` 替换为 `NITScope` 实例。
- [ ] 保持 `async execute()` 逻辑不变，继续处理 `await`。

---

## 5. 风险评估

1.  **PyO3 转换开销**: 
    - *风险*: Rust 解析出的 AST 需要转换为 Python 对象供 Runtime 使用，如果对象极其庞大，跨语言边界的开销可能抵消解析优势。
    - *缓解*: NIT 脚本通常较短（指令集），AST 深度有限，转换开销可忽略不计。

2.  **开发复杂度**:
    - *风险*: 团队需要同时维护 Rust 和 Python 代码。
    - *缓解*: 核心逻辑下沉到 Rust 后，变更频率较低。Python 层只需关注业务调度。

---

## 6. 结论

此方案是在不破坏现有异步生态的前提下，引入 Rust 强安全特性的最佳路径。它就像是把“编译器”和“内存条”换成了 Rust 制造，而让 Python 继续充当灵活的“调度员”。
