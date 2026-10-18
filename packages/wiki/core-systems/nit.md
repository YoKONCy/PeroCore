# NIT 脚本编排

NIT 是通过 Function Calling 工具 `run_script` 调用的 TypeScript DSL 解释器。模型把脚本放进 `code` 参数；普通聊天中的代码、XML 标签不会触发执行。

## 适用场景

下一小批操作已经明确，需要批量读取、条件判断、循环或独立并行汇总时，优先考虑 NIT，减少模型往返。单步操作可直接调用工具；需要重新理解图片或结果时，在该决策点结束脚本再继续推理。没有强制使用比例或必须调用的规则。

脚本只能使用当前已开放、获授权的工具。内部调用继续经过同一 ToolExecutor 的通道限制、工具开关、审批、Application Realm 和资源路径校验。`read_image` 必须直接调用以传递原图；禁止嵌套 `run_script` 重置预算。

持久后台任务已有逐动作检查点和副作用确认要求，仍直接调用各工具，其菜单不开放 `run_script`。这里的 NIT 使用引导面向工具菜单实际开放它的桌面对话等场景。

## 语法与等待

变量不加 `$`；命名参数使用 `=`；代码块使用花括号；语句用换行分隔。不支持 JavaScript/Python 的 `async/await`、函数定义或对象字面量。变量仅在本次脚本中有效。

普通语句和 `for` 默认顺序执行，工具返回后才执行下一项，无需 `wait` 关键字：

```text
write_file(file_path="notes/example.txt", content="示例")
return read_file(file_path="notes/example.txt")
```

批量读取并汇总：

```text
results = []
for file in ["README.md", "package.json"] {
  results.push(read_file(file_path=file))
}
return merge(results, separator="\n---\n")
```

只有显式 `parallel` 块并发执行，结果保持表达式顺序。互相依赖或修改同一资源的操作应顺序执行；不要在并发分支中共享写入变量或数组：

```text
results = parallel {
  read_file(file_path="README.md")
  read_file(file_path="package.json")
}
return merge(results)
```

支持数组、`if/else`、`for/in`、`try/catch`、`return`、比较运算、短路逻辑 `and/or/not`，以及数组 `push/join/filter`、字符串 `trim/includes/startsWith/endsWith`、`merge`。`filter()` 仅过滤假值，不接受回调函数。

工具返回文本；对于 JSON 文本，可用 `parse_json` 解析后访问字段或数组。已存在终端的条件等待示例：

```text
state = parse_json(terminal_wait(terminal_id="已有终端ID", pattern="Ready", timeout_ms=10000))
if state.output.includes("Ready") {
  return "已就绪"
} else {
  return "尚未就绪，请重新检查终端状态"
}
```

工具返回不一定代表后台工作完成。工具只返回任务或终端句柄时，应按其契约显式等待并检查状态；等待超时不能当成成功。浏览器条件等待使用当前已开放的 `browser_wait`。

## 取消、超时与资源回收

- 父任务取消和绝对截止时间通过容器、NIT、内部 ToolExecutor 传递到底层工具。调用身份、执行链、审批上下文和每次内部调用的独立 ID 同时保留。
- 脚本自身执行累计预算为 30 秒，等待工具和审批时暂停计时。
- 包含等待时间的总耗时默认最多 600000 毫秒，可通过 `run_script.timeout_ms` 缩短。父任务截止时间更早时，使用更早的截止时间。工具自身超时仍然生效。
- 每次最多启动 50 次内部工具调用；尚未返回的并行调用也计入限制。解释器节点执行另有 1000 次限制。
- 父级取消不会被脚本 `catch` 吞掉。普通业务错误可以捕获；并行任一分支失败时取消同组剩余分支，再处理错误。
- 脚本结束时取消并回收本脚本创建的受管终端，Windows 使用进程树回收；短命令在失败、取消、超时后都关闭终端记录。需要跨脚本保留的服务应直接使用终端工具并显式管理生命周期。
- 本地进程回收及尚未结束的工具会被跟踪；不响应取消的工具会产生明确告警，不能将“停止等待”视为“底层已经停止”。

## 实现位置

- `packages/backend/src/nit/`：词法分析、语法分析、运行时与取消检查。
- `packages/backend/src/tools/runScript/`：FC 工具说明、预算、截止时间、内部工具执行及回收。
- `packages/backend/src/container.ts`：完整传递内部工具上下文。
- `packages/backend/src/services/execution/`：取消作用域、终端等待和进程树回收。

本页以当前实现为准，不存在文本内 `<nit>` 执行通道、跨会话脚本变量或独立的 Python/Rust 解释器链路。
