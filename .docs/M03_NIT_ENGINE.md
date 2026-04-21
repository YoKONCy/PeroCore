# NIT 编排引擎

> **核心定位**：将 NIT 作为标准的 Function Calling 工具。
> **最后更新**：2026-04-21

---

## 1. 架构变更

在 v3.1 中，NIT 不再是一个并行协议，而是被封装为 **`run_script`** 工具。

- **LLM 调用**：通过标准 FC 语法调用 `run_script(code="...")`。
- **执行**：后端 `NitRuntime` 执行脚本，脚本内部调用的工具递归走 `ToolRegistry`。
- **优势**：消除 LLM 的协议竞争认知，零 system prompt 开销。

---

## 2. 语法子集

NIT 提供轻量级沙箱语法：

- **基础**：赋值、属性访问 (`obj.field`)、字符串拼接。
- **控制流**：`if-else`, `for-in`, `try-catch`, `return`。
- **并发**：`parallel { ... }` 块实现多工具并发。
- **限制**：禁止函数定义、禁止网络/文件直接 IO、禁止递归。

---

## 3. 使用场景 (Agent DSL)

当 LLM 需要执行多步复杂操作时（如：先搜索 -> 根据结果判断 -> 循环处理），应首选 `run_script`。

```javascript
result = web_search(query="主题")
if result.length > 0 {
  for item in result {
    log_memory(content=item.text)
  }
}
```

---

_本文档由 Carola 整理。_
