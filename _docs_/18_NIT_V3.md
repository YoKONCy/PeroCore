# 18. NIT v3 — Agent DSL 编排引擎

> **版本**：0.1.0 · **更新时间**：2026-04-19
> **关联决策**：D57
> **前置依赖**：ToolRegistry (已实装), CapabilityGate (已实装)

---

## 1. 定位演变

| 版本 | 年份 | 定位 | 问题 |
|---|---|---|---|
| NIT v1 | 2024 | 文本协议调工具 | 被 FC 完全取代 |
| NIT v2 | 2025 | XML 脚本 + 管道 | 仍是"调工具"，优势不大 |
| **NIT v3** | **2026** | **Agent DSL 编排引擎** | **做 FC 做不到的事** |

**核心原则**：NIT v3 不再是"工具调用协议"，而是一门**安全沙箱内的轻量脚本语言**。
LLM 写"微程序"，Runtime 执行逻辑，工具调用走 ToolRegistry (与 FC 共享)。

---

## 2. FC 做不到的事

| 能力 | FC (ReAct) | NIT v3 |
|---|---|---|
| 条件分支 | ❌ 需多轮 LLM | ✅ `if/else` |
| 循环 | ❌ 需多轮 LLM | ✅ `for/in` |
| 变量传递 | ❌ 需多轮 LLM | ✅ 本地变量表 |
| 错误恢复 | ❌ 需多轮 LLM | ✅ `try/catch` |
| 并行 + 聚合 | ⚠️ 并行可以但聚合需多轮 | ✅ `parallel {}` |
| 数据过滤 | ❌ 全量过 LLM | ✅ 本地执行，零 Token |

---

## 3. 架构

```
LLM 输出
├── 纯文本 → 流式推送给用户
├── FC tool_calls → ToolExecutor → ToolRegistry → 执行
└── <nit> 脚本块 → NIT v3 Runtime ─→ ToolExecutor → ToolRegistry
                     │                                  │
                     ├── if/else/for/try              同一个!
                     ├── 变量表 + 数据流               │
                     └── parallel { }           ┌──────┼──────┐
                                                │      │      │
                                            内置工具  Extension  MCP
                                                       │
                                                  Skill 解锁
```

**关键**：NIT v3 没有自己的插件系统。所有工具调用走 ToolExecutor → ToolRegistry。
MCP、Extension、Skill 解锁的工具对 NIT 完全透明。

---

## 4. 语法规范

### 4.1 基础语法

```javascript
// 变量赋值 + 工具调用
result = web_search(query="螺蛳粉做法")

// 属性访问
count = result.length

// 字符串、数字、布尔
name = "Pero"
age = 3
active = true

// 数组
tags = ["旅行", "美食", "编程"]
```

### 4.2 条件分支

```javascript
result = web_search(query="螺蛳粉")
if result.length < 50 {
  result = web_search(query="柳州螺蛳粉 详细做法")
}
return result
```

### 4.3 循环

```javascript
entries = diary_summary(start="2026-04-13", end="2026-04-19")
highlights = []
for entry in entries {
  if entry.mood == "happy" {
    highlights.push(entry.date + ": " + entry.highlights[0])
  }
}
return highlights.join("\n")
```

### 4.4 并行执行

```javascript
results = parallel {
  diary_by_topic("旅行", limit=3)
  diary_by_topic("美食", limit=3)
  diary_by_entity("小明")
}
return merge(results)
```

### 4.5 错误处理

```javascript
try {
  result = code_search(query="handleClick")
} catch {
  result = "搜索失败，请检查索引"
}
return result
```

### 4.6 完整语法表

| 语法 | 示例 | 说明 |
|---|---|---|
| 赋值 | `a = expr` | 变量绑定 |
| 工具调用 | `tool(arg, key=val)` | 走 ToolExecutor |
| 条件 | `if cond { } else { }` | 条件分支 |
| 循环 | `for x in list { }` | 遍历数组 |
| 并行 | `parallel { expr; expr }` | 并发执行 |
| 错误处理 | `try { } catch { }` | 异常捕获 |
| 返回 | `return expr` | 返回值 |
| 比较 | `==  !=  <  >  <=  >=` | |
| 逻辑 | `and  or  not` | |
| 属性 | `obj.field` | 属性访问 |
| 索引 | `arr[0]` | 数组索引 |
| 拼接 | `str1 + str2` | 字符串/数组拼接 |
| 数组方法 | `.push()  .join()  .length` | 内置方法 |

### 4.7 禁止的功能 (安全沙箱)

- ❌ 函数定义 (`function`, `=>`)
- ❌ import / require
- ❌ 文件系统直接访问 (只能通过注册工具)
- ❌ 网络请求 (只能通过注册工具)
- ❌ 无限循环 (最大迭代次数限制)
- ❌ 递归
- ❌ eval / exec

---

## 5. 接入 ReAct Loop

```typescript
// reactLoop.ts 中的变化
// 检测 LLM 输出中的 <nit> 标签
const NIT_PATTERN = /<nit>([\s\S]*?)<\/nit>/g

// 如果 LLM 输出包含 <nit> 块:
// 1. 提取脚本
// 2. 送入 NIT Runtime 执行
// 3. 将执行结果作为 tool 结果注入上下文
// 4. 继续 ReAct 循环
```

---

## 6. 实现文件

```
packages/backend/src/nit/
├── types.ts      — AST 节点类型定义
├── lexer.ts      — 词法分析器 (Token 化)
├── parser.ts     — 语法分析器 (Token → AST)
├── runtime.ts    — 执行引擎 (AST → 结果)
└── index.ts      — 桶导出
```

---

_本文档由 Carola 整理，适用于 PeroCore-TS NIT v3 编排引擎规范。_
