# Python 异步编程避坑指南：从 PeroCore 实战中总结的血泪教训

本文档总结了在 PeroCore (特别是 SocialAdapter) 开发过程中遇到的严重异步编程陷阱。这些问题曾导致私聊功能“莫名卡死”、任务静默消失以及数据库死锁。

## 1. 幽灵任务 (The Ghost Task)

### 现象
使用 `asyncio.create_task()` 创建的后台任务在运行到 `await` 点（如 `asyncio.sleep` 或数据库查询）时突然“消失”了，没有任何报错日志，仿佛代码执行到一半被截断。

### 原因
**Python 的垃圾回收机制 (GC)**。
`asyncio.create_task()` 返回一个 `Task` 对象。如果你没有在某处（如列表、集合或类属性）持有这个对象的**强引用**，Python 的 GC 可能会在任务尚未完成时就将其回收。
当任务被 GC 回收时，它会被取消（Cancel），并且通常不会打印异常（除非你显式捕获了 `CancelledError`）。

### ❌ 错误示范
```python
# 这是一个 "Fire-and-forget" 任务
# 没有人持有 task 的引用
asyncio.create_task(self._background_job())

# 结果：_background_job 可能在第一次 await 时就被 GC 回收了
```

### ✅ 正确做法 (Best Practice)
必须手动持有任务的引用，并在任务完成后清理。

```python
# 在类中定义一个集合来保存引用
self.background_tasks = set()

# 创建任务
task = asyncio.create_task(self._background_job())

# 添加强引用
self.background_tasks.add(task)

# 添加回调，在任务完成后移除引用（防止内存泄漏）
task.add_done_callback(self.background_tasks.discard)
```

---

## 2. 逻辑死锁与资源竞争 (Logical Deadlock & Race Conditions)

### 现象
程序卡死在 `await db_query()` 处，不报错也不超时，仿佛时间静止。

### 原因
**自我引用导致的资源锁竞争**。
在 `SocialService` 中，我们遇到了一个特殊的死锁场景：
1. 私聊 Session A 正在处理消息。
2. Session A 需要读取“相关用户的私聊历史”作为上下文。
3. 代码逻辑没有排除 Session A 自己，导致它尝试去读取 Session A 的历史。
4. 如果数据库层或应用层有针对 `user_id` 的锁（或连接池资源耗尽），Session A 就会等待自己释放资源，形成死锁。

### ❌ 错误示范
```python
# 获取相关用户列表
relevant_users = [msg.sender_id for msg in recent_msgs]

# 包含了自己！
for uid in relevant_users:
    # 如果 get_history 内部有针对 uid 的锁，这里就会死锁
    await self.get_history(uid)
```

### ✅ 正确做法
在逻辑层面排除自我引用，并使用超时保护。

```python
is_current_session = (uid == current_session_id)
if not is_current_session:
    # 增加超时保护，防止单个子任务卡死主流程
    await asyncio.wait_for(self.get_history(uid), timeout=2.0)
```

---

## 3. 变量作用域陷阱 (UnboundLocalError in Async/Branching)

### 现象
报错 `UnboundLocalError: local variable 'x' referenced before assignment`。

### 原因
在复杂的异步错误处理流程中（`try...except...else` 或复杂的 `if` 分支），变量的初始化可能被跳过。
特别是在 `await` 调用可能抛出异常的情况下，如果变量初始化在 `await` 之后，一旦发生异常或进入 `except` 分支，该变量就不存在了。

### ❌ 错误示范
```python
try:
    data = await fetch_data() # 如果这里抛出异常或超时
    processed = process(data) # 这行不执行
except TimeoutError:
    logger.error("Timeout")
    # processed 变量从未被赋值

# 报错：processed 未定义
return processed 
```

### ✅ 正确做法
在逻辑块的最外层初始化默认值。

```python
processed = None # 先初始化默认值

try:
    data = await fetch_data()
    processed = process(data)
except TimeoutError:
    logger.error("Timeout")
    processed = [] # 或者在异常块中赋予合理的空值

return processed
```

---

## 4. 同步数据库驱动阻塞事件循环

### 现象
整个应用（包括心跳包、其他用户的响应）都会卡顿，因为主线程被阻塞了。

### 原因
即使使用了 `run_in_executor` 或 `asyncio.to_thread`，底层的 SQLite 驱动如果配置不当（如未开启 WAL 模式），写操作可能会锁住整个数据库文件，导致读操作阻塞。
如果在 `async def` 函数中直接调用了同步的耗时操作（如未被 await 的大计算或同步 IO），会直接卡死 Event Loop。

### ✅ 优化方案
1. **开启 WAL 模式 (Write-Ahead Logging)**: 允许并发读写。
   ```sql
   PRAGMA journal_mode=WAL;
   ```
2. **连接池配置**: 确保连接池足够大，且设置合理的超时。
3. **让出控制权**: 在密集循环或可能阻塞的操作前，手动 `await asyncio.sleep(0)` 让出控制权给 Event Loop。

---

## 5. 调试技巧：日志与超时

当异步程序“静默卡死”时，唯一的调试手段是：
1. **细粒度的日志**: 在 `await` 前后都打印日志。
   ```python
   logger.info("Before await")
   await something()
   logger.info("After await") # 如果这行没打出来，就是卡在上面了
   ```
2. **激进的超时策略**: 所有的外部调用（网络、DB、子任务）都应该包裹在 `asyncio.wait_for` 中。
   ```python
   try:
       await asyncio.wait_for(task, timeout=5.0)
   except asyncio.TimeoutError:
       logger.error("Task stuck!")
   ```

---

*本文档由 PeroCore 开发团队总结，旨在避免未来重蹈覆辙。*
