# PeroCore MOD 系统开发指南

> 三层扩展体系完整教程：EventBus Hook / 管道注册 / 外部插件

## 目录

- [第一章：概述](#第一章概述)
- [第二章：快速开始](#第二章快速开始)
- [第三章：MOD 配置与元数据](#第三章mod-配置与元数据)
- [第四章：第一层 — EventBus Hook](#第四章第一层--eventbus-hook)
- [第五章：第二层 — 管道注册](#第五章第二层--管道注册)
- [第六章：第三层 — 外部插件](#第六章第三层--外部插件)
- [第七章：IoC 容器与组件替换](#第七章ioc-容器与组件替换)
- [第八章：通知与前端交互](#第八章通知与前端交互)
- [第九章：高级主题](#第九章高级主题)
- [第十章：最佳实践](#第十章最佳实践)
- [第十一章：常见问题](#第十一章常见问题)
- [第十二章：API 速查表](#第十二章api-速查表)

---

## 第一章：概述

### 1.1 什么是 MOD 系统？

PeroCore MOD 系统是一个基于 Python 的三层扩展框架，允许开发者在**不修改核心代码**的前提下定制系统行为。所有 MOD 共享同一进程空间，由 `ModManager` 在启动时统一加载。

### 1.2 三层扩展体系

| 层级       | 扩展方式                                | 适用场景                                                    | 侵入性 |
| ---------- | --------------------------------------- | ----------------------------------------------------------- | ------ |
| **第一层** | EventBus Hook                           | "在 A 发生时顺便做 B" — 修改标签、触发通知、注入上下文      | 最轻   |
| **第二层** | 管道注册 (Preprocessor / Postprocessor) | "在处理流程中插入一步" — 敏感词过滤、格式转换、自定义后处理 | 中等   |
| **第三层** | 外部插件 (Webhook HTTP)                 | "我要独立的功能" — 定时任务、数据同步、监控面板、第三方集成 | 最重   |

**如何选择？**

- **「我想在记忆保存时加个标签」** → 用 **EventBus Hook**（90% 的需求只需这个）
- **「我想过滤所有 LLM 输出中的敏感词」** → 用 **管道注册**
- **「我想做一个独立的数据同步仪表板」** → 用 **外部插件**

> 💡 同一个 MOD 可以同时使用全部三层。参见 `backend/mods/memory_tagger/` 示例。

### 1.3 系统架构

```text
┌──────────────────────────────────────────────────────────────┐
│                    PeroCore 主进程                            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Bootstrap (core/bootstrap.py)                         │  │
│  │  ① 注册 PreprocessorManager → IoC 容器                 │  │
│  │  ② 注册 PostprocessorManager → IoC 容器                │  │
│  │  ③ ModManager.load_mods() → 加载所有用户 MOD           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  EventBus    │  │  IoC 容器     │  │  ExternalPlugin  │  │
│  │  (单例)       │  │  (单例)       │  │  Registry        │  │
│  │              │  │              │  │                  │  │
│  │  subscribe() │  │  register()  │  │  register()      │  │
│  │  publish()   │  │  get()       │  │  unregister()    │  │
│  │  unsubscribe │  │  override()  │  │  heartbeat       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │             │
│   MOD Hook 处理      MOD 注册处理器       HTTP Webhook       │
│   (in-process)       (in-process)        代理转发            │
└─────────────────────────────────────────────┬────────────────┘
                                              │ HTTP
                                    ┌─────────▼─────────┐
                                    │   外部插件进程      │
                                    │   (独立 HTTP 服务)  │
                                    └───────────────────┘
```

### 1.4 MOD 加载流程

```text
系统启动
  │
  ├─ bootstrap() 注册核心组件到 IoC 容器
  │
  ├─ ModManager.load_mods()
  │     │
  │     ├─ 扫描 backend/mods/ 目录
  │     ├─ 跳过 _ 前缀目录（系统基础设施）
  │     ├─ 跳过没有 main.py 的目录
  │     ├─ 按文件夹名字母序排列
  │     │
  │     └─ 对每个有效 MOD：
  │           ├─ 读取 mod.toml（可选）→ 元数据
  │           ├─ 动态导入 main.py
  │           └─ 调用 init() 函数
  │
  └─ 系统就绪，开始接受请求
```

### 1.5 MOD 目录结构

```text
backend/mods/
├── _external_plugins/          # _ 前缀：系统基础设施（不作为用户 MOD 加载）
│   ├── __init__.py
│   ├── service.py              # ExternalPluginRegistry 核心
│   └── router.py               # /api/plugins/* API 路由
│
└── my_awesome_mod/             # 你的 MOD
    ├── mod.toml                # 声明式元数据（可选，推荐）
    ├── main.py                 # 入口文件（必须，包含 init()）
    ├── hooks.py                # Hook 处理函数（可选，按需拆分）
    ├── processors.py           # 管道处理器（可选）
    └── external/               # 外部插件服务（可选，需独立启动）
        └── server.py
```

---

## 第二章：快速开始

### 2.1 创建你的第一个 MOD（5 分钟）

**目标：** 创建一个 MOD，在每条记忆保存时自动追加 `auto_tagged` 标签。

#### Step 1: 创建目录

```bash
mkdir backend/mods/my_first_mod
```

#### Step 2: 创建 main.py

```python
# backend/mods/my_first_mod/main.py

from core.event_bus import EventBus


async def on_memory_save_pre(ctx):
    """在记忆保存前追加标签"""
    existing = ctx.get("tags", "")
    if existing:
        ctx["tags"] = f"{existing},auto_tagged"
    else:
        ctx["tags"] = "auto_tagged"


def init():
    EventBus.subscribe("memory.save.pre", on_memory_save_pre)
    print("[MyFirstMod] ✔ 已注册 memory.save.pre Hook")
```

#### Step 3: 重启 PeroCore

MOD 会在启动时自动加载。查看控制台输出确认：

```
[ModManager] 正在扫描 Mod 目录: .../backend/mods
[ModManager] 正在初始化 Mod: my_first_mod (v0.0.1)
[MyFirstMod] ✔ 已注册 memory.save.pre Hook
[ModManager] MOD 加载完成: 1/1 成功
```

### 2.2 关键要点

- **`init()`** — MOD 的唯一入口，ModManager 会自动调用
- **`EventBus.subscribe(event, handler)`** — 订阅系统事件
- **Handler 函数** — 可以是 `sync` 或 `async`，通过修改 `ctx` 可变字典来影响系统行为
- **无需注册/声明** — 把文件夹放到 `backend/mods/` 即可，系统自动发现

### 2.3 添加元数据（推荐）

创建 `mod.toml` 为你的 MOD 提供描述信息：

```toml
# backend/mods/my_first_mod/mod.toml

[mod]
asset_id = "com.perocore.mod.my_first_mod"
type = "mod"
display_name = "我的第一个 MOD"
version = "1.0.0"
description = "在每条记忆保存时自动追加 auto_tagged 标签"
author = "Your Name"

[layers]
eventbus = true
pipeline = false
external = false
```

---

## 第三章：MOD 配置与元数据

### 3.1 mod.toml 完整字段

```toml
[mod]
asset_id = "com.perocore.mod.memory_tagger"   # 资产联邦 ID（全局唯一）
type = "mod"                                   # 固定值
display_name = "记忆标注器"                      # 显示名称
version = "1.0.0"                              # 语义化版本号
description = "自动为记忆添加时间标签"             # 描述
author = "PeroCore Community"                  # 作者

[layers]
eventbus = true         # 是否使用 EventBus Hook
pipeline = true         # 是否使用管道注册
external = true         # 是否有配套的外部插件服务
external_url = "http://localhost:9527"  # 外部插件地址
```

#### [mod] 字段说明

| 字段           | 必填 | 类型  | 说明                                        |
| -------------- | ---- | ----- | ------------------------------------------- |
| `asset_id`     | 推荐 | `str` | 全局唯一标识符，格式 `com.perocore.mod.xxx` |
| `type`         | 推荐 | `str` | 固定值 `"mod"`                              |
| `display_name` | 否   | `str` | 在管理界面中显示的名称                      |
| `version`      | 否   | `str` | 语义化版本号 (SemVer)                       |
| `description`  | 否   | `str` | MOD 简介                                    |
| `author`       | 否   | `str` | 作者信息                                    |

#### [layers] 字段说明

| 字段           | 类型   | 默认值  | 说明                     |
| -------------- | ------ | ------- | ------------------------ |
| `eventbus`     | `bool` | `false` | 声明使用了 EventBus Hook |
| `pipeline`     | `bool` | `false` | 声明使用了管道注册       |
| `external`     | `bool` | `false` | 声明有配套外部插件       |
| `external_url` | `str`  | `""`    | 外部插件 HTTP 地址       |

> ⚠️ `mod.toml` 是可选的。如果不提供，ModManager 会使用文件夹名作为 ID 和名称。但强烈推荐提供，有助于管理和调试。

### 3.2 main.py 入口规范

`main.py` 是 MOD 的必须文件（如果没有 `main.py`，也可以用 `__init__.py` 替代）。

```python
# main.py 模板

import logging

logger = logging.getLogger("pero.mod.your_mod_name")

def init():
    """
    MOD 入口函数。
    在系统启动时由 ModManager 自动调用。
    在此函数中完成所有注册操作。
    """
    # 第一层：EventBus Hook
    # EventBus.subscribe(...)

    # 第二层：管道注册
    # ComponentContainer.get(IPreprocessorManager).register(...)

    # 第三层：外部插件注册
    # ...

    logger.info("[YourMod] 初始化完成")
```

#### init() 函数要求

| 要求     | 说明                                                  |
| -------- | ----------------------------------------------------- |
| 必须存在 | 没有 `init()` 会被标记为 "无法生效" 的警告            |
| 必须同步 | `init()` 不能是 `async def`（但内部可以调度异步任务） |
| 必须安全 | 应当 try-except 包裹关键逻辑，避免异常阻断系统启动    |
| 无参数   | `init()` 不接受任何参数                               |

### 3.3 ModInfo 运行时信息

每个加载的 MOD 会生成一个 `ModInfo` 数据对象，可通过 `ModManager` 查询：

```python
from core.mod_manager import ModManager

# 获取所有已加载 MOD
all_mods = ModManager.get_loaded_mods()  # Dict[str, ModInfo]

# 获取单个 MOD 信息
info = ModManager.get_mod_info("memory_tagger")
print(info.name)          # "记忆标注器"
print(info.version)       # "1.0.0"
print(info.loaded)        # True
print(info.error)         # None（加载失败时有错误信息）
print(info.uses_eventbus) # True
```

---

## 第四章：第一层 — EventBus Hook

EventBus 是最轻量的扩展方式。通过订阅系统事件，可以在关键节点监听或修改系统行为。

### 4.1 核心 API

```python
from core.event_bus import EventBus

# 订阅事件
EventBus.subscribe("event.name", handler_function)

# 取消订阅
EventBus.unsubscribe("event.name", handler_function)
```

- **Handler** 可以是普通函数或 `async` 函数，EventBus 会自动识别并正确调用
- **多个 Handler** 按订阅顺序依次执行
- **修改 ctx** 通过直接修改传入的可变字典来影响系统行为（不需要返回值）
- **异常隔离** 单个 Handler 抛异常不会影响其他 Handler 和主流程

### 4.2 可用事件完整列表

#### 对话生命周期

| 事件名               | 触发时机                 | 可修改 | ctx 字段                                                                                                     |
| :------------------- | :----------------------- | :----- | :----------------------------------------------------------------------------------------------------------- |
| `chat.request.pre`   | 收到用户消息后，预处理前 | ✅     | `messages`, `source`, `session_id`, `agent_id`, `is_voice_mode`, `user_text_override`, `variables`, `cancel` |
| `chat.response.post` | 完整响应生成后           | ❌     | `response`, `user_message`, `source`, `session_id`, `agent_id`, `pair_id`                                    |

#### 记忆系统

| 事件名             | 触发时机   | 可修改 | ctx 字段                                                                                                                                               |
| :----------------- | :--------- | :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory.save.pre`  | 保存记忆前 | ✅     | `session`, `content`, `tags`, `clusters`, `importance`, `base_importance`, `sentiment`, `msg_timestamp`, `source`, `memory_type`, `agent_id`, `cancel` |
| `memory.save.post` | 保存记忆后 | ❌     | `memory`（Memory 对象直接传入，非 dict）                                                                                                               |

#### Prompt 构建

| 事件名              | 触发时机       | 可修改 | ctx 字段                    |
| :------------------ | :------------- | :----- | :-------------------------- |
| `prompt.build.pre`  | 构建 Prompt 前 | ✅     | `variables`, `user_message` |
| `prompt.build.post` | 构建 Prompt 后 | ✅     | `messages`（最终消息列表）  |

#### 工具调用

| 事件名              | 触发时机   | 可修改 | ctx 字段                                                              |
| :------------------ | :--------- | :----- | :-------------------------------------------------------------------- |
| `tool.execute.pre`  | 工具执行前 | ✅     | `function_name`, `function_args`, `source`, `cancel`, `cancel_reason` |
| `tool.execute.post` | 工具执行后 | ❌     | `function_name`, `function_args`, `result_preview`（截断至 500 字符） |

### 4.3 ctx 字段详解

#### `cancel` 模式（可取消事件）

`chat.request.pre`、`memory.save.pre`、`tool.execute.pre` 三个事件支持取消：

```python
async def block_sensitive_tools(ctx):
    """拦截敏感工具调用"""
    if ctx["function_name"] in ["shell_execute", "delete_file"]:
        ctx["cancel"] = True
        ctx["cancel_reason"] = "安全策略: 禁止执行破坏性操作"
```

设置 `ctx["cancel"] = True` 后：

- `chat.request.pre` → 整个对话被中止，不产生响应
- `memory.save.pre` → 记忆不会被保存到数据库
- `tool.execute.pre` → 工具不被执行，返回拦截消息给 LLM

#### `memory.save.pre` 字段修改

```python
async def enhance_memory(ctx):
    """增强记忆数据"""
    # 修改内容
    ctx["content"] = ctx["content"] + "\n[MOD 附注: 已自动增强]"

    # 追加标签
    ctx["tags"] = ctx["tags"] + ",enhanced"

    # 提升重要性
    ctx["importance"] = max(ctx["importance"], 3)

    # 修改情感标注
    if "开心" in ctx["content"]:
        ctx["sentiment"] = "positive"
```

#### `chat.request.pre` 变量注入

```python
async def inject_custom_variables(ctx):
    """在对话开始前注入自定义变量"""
    ctx["variables"]["custom_greeting"] = "欢迎回来！"
    ctx["variables"]["user_level"] = "premium"
```

### 4.4 编写 Hook 函数

#### 同步 Handler

```python
def on_tool_post(ctx, **kwargs):
    """同步处理也完全可以"""
    print(f"工具 {ctx['function_name']} 执行完毕")
```

#### 异步 Handler（推荐）

```python
async def on_memory_save_pre(ctx):
    """异步处理，适合 I/O 操作"""
    from datetime import datetime
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    ctx["tags"] += f",tagged_at:{now}"
```

#### 文件拆分（推荐）

将 Hook 函数拆到独立文件，保持 `main.py` 简洁：

```python
# hooks.py
async def on_memory_save_pre(ctx):
    ...

async def on_prompt_build_post(ctx):
    ...
```

```python
# main.py
from core.event_bus import EventBus
from .hooks import on_memory_save_pre, on_prompt_build_post

def init():
    EventBus.subscribe("memory.save.pre", on_memory_save_pre)
    EventBus.subscribe("prompt.build.post", on_prompt_build_post)
```

### 4.5 实战示例

#### 示例 1：对话审计日志

```python
# hooks.py
import json
import logging
from datetime import datetime

logger = logging.getLogger("pero.mod.audit")

async def on_chat_post(ctx):
    """记录每次对话到审计日志"""
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "source": ctx.get("source"),
        "session_id": ctx.get("session_id"),
        "agent_id": ctx.get("agent_id"),
        "user_message": ctx.get("user_message", "")[:100],
        "response_length": len(ctx.get("response", "")),
    }
    logger.info(f"[审计] {json.dumps(log_entry, ensure_ascii=False)}")
```

#### 示例 2：工具调用白名单

```python
# hooks.py
ALLOWED_TOOLS = {"search_files", "take_screenshot", "web_search"}

async def enforce_tool_whitelist(ctx):
    """只允许白名单中的工具被调用"""
    if ctx["function_name"] not in ALLOWED_TOOLS:
        ctx["cancel"] = True
        ctx["cancel_reason"] = f"工具 {ctx['function_name']} 不在白名单中"
```

#### 示例 3：Prompt 注入时间感知

```python
# hooks.py
from datetime import datetime

async def inject_time_context(ctx):
    """在最终 Prompt 中注入当前时间"""
    messages = ctx.get("messages", [])
    if not messages:
        return

    time_note = {
        "role": "system",
        "content": f"[系统信息] 当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    }
    messages.insert(-1, time_note)
```

---

## 第五章：第二层 — 管道注册

管道注册允许 MOD 在预处理和后处理流程中插入自定义处理节点。

### 5.1 管道架构

```text
用户输入
  │
  ▼
┌─────────────────────────────────────────┐
│        PreprocessorManager              │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
│  │UserInput│→│History  │→│RAG        │→ ... → │MOD 注册的│
│  │Preproc  │ │Preproc  │ │Preproc    │       │预处理器  │
│  └─────────┘ └─────────┘ └───────────┘       └─────────┘
└─────────────────────────────────────────┘
  │
  ▼  LLM 推理
  │
  ▼
┌─────────────────────────────────────────┐
│        PostprocessorManager             │
│  ┌───────────┐ ┌────────────────────┐   │
│  │NITFilter  │→│ThinkingFilter     │→ ... → │MOD 注册的│
│  │Postproc   │ │Postproc           │       │后处理器  │
│  └───────────┘ └────────────────────┘       └─────────┘
└─────────────────────────────────────────┘
  │
  ▼
最终输出
```

### 5.2 接口定义

`PreprocessorManager` 和 `PostprocessorManager` 是系统中**唯二**支持通过 IoC 容器管理的组件。

```python
# core/interfaces.py

class IPreprocessorManager(Protocol):
    """预处理器管理接口"""
    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]: ...
    def register(self, preprocessor: Any): ...

class IPostprocessorManager(Protocol):
    """后处理器管理接口"""
    async def process(self, content: str, context: Dict[str, Any]) -> str: ...
    async def process_stream(
        self, stream: AsyncIterable[str], context: Dict[str, Any]
    ) -> AsyncIterable[str]: ...
    def register(self, postprocessor: Any): ...
```

### 5.3 编写预处理器

继承 `BasePreprocessor` 或实现同等接口：

```python
# 方式一：继承基类（推荐）
from services.preprocessor.base import BasePreprocessor

class MyPreprocessor(BasePreprocessor):

    @property
    def name(self) -> str:
        return "my_preprocessor"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        # context 至少包含：
        #   messages: List[Dict[str, str]]  — 对话历史
        #   variables: Dict[str, Any]       — 提示词渲染变量
        #   session: AsyncSession           — 数据库会话
        #   user_input: str                 — 当前用户输入
        context["variables"]["injected_by_mod"] = "hello from MOD"
        return context
```

```python
# 方式二：鸭子类型（无需继承）
class SimplePreprocessor:
    priority = 90  # 数值越大越后执行

    async def process(self, context):
        context.setdefault("variables", {})["current_time"] = \
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return context
```

#### 预处理器 context 字段

| 字段             | 类型             | 说明                                     |
| ---------------- | ---------------- | ---------------------------------------- |
| `messages`       | `List[Dict]`     | 当前对话历史消息列表                     |
| `variables`      | `Dict[str, Any]` | 传递给 Prompt 模板的变量                 |
| `session`        | `AsyncSession`   | SQLAlchemy 异步数据库会话                |
| `user_input`     | `str`            | 当前用户输入文本                         |
| `source`         | `str`            | 消息来源 (`desktop`, `mobile`, `social`) |
| `session_id`     | `str`            | 会话标识符                               |
| `agent_id`       | `str`            | 当前 Agent 标识符                        |
| `memory_service` | `MemoryService`  | 记忆服务实例                             |
| `prompt_manager` | `PromptManager`  | Prompt 管理器实例                        |

### 5.4 编写后处理器

```python
from services.postprocessor.base import BasePostprocessor

class SensitiveWordFilter(BasePostprocessor):

    @property
    def name(self) -> str:
        return "sensitive_word_filter"

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """批处理模式：接收完整文本，返回处理后文本"""
        # context 包含 target ('memory' | 'ui') 等元数据
        for word in ["敏感词1", "敏感词2"]:
            content = content.replace(word, "***")
        return content

    async def process_stream(self, stream, context):
        """流模式：处理流式 token（可选覆盖）"""
        # 默认实现是透传。如需过滤流式内容：
        async for chunk in stream:
            for word in ["敏感词1", "敏感词2"]:
                chunk = chunk.replace(word, "***")
            yield chunk
```

### 5.5 注册处理器

在 `main.py` 的 `init()` 中注册：

```python
from core.component_container import ComponentContainer
from core.interfaces import IPreprocessorManager, IPostprocessorManager
from .processors import MyPreprocessor, SensitiveWordFilter

def init():
    # 注册预处理器
    pm = ComponentContainer.get(IPreprocessorManager)
    pm.register(MyPreprocessor())

    # 注册后处理器
    post_pm = ComponentContainer.get(IPostprocessorManager)
    post_pm.register(SensitiveWordFilter())
```

### 5.6 执行顺序

- **系统内置处理器**在 `bootstrap()` 中注册，**先于** MOD 注册的处理器
- MOD 注册的处理器追加到管道末尾
- 多个 MOD 的注册顺序取决于文件夹名字母序
- 每个处理器可设 `priority` 属性，但当前管道按注册顺序执行

#### 内置预处理器顺序

| 顺序 | 预处理器                     | 职责            |
| ---- | ---------------------------- | --------------- |
| 1    | `UserInputPreprocessor`      | 提取用户输入    |
| 2    | `HistoryPreprocessor`        | 加载对话历史    |
| 3    | `RAGPreprocessor`            | 记忆检索增强    |
| 4    | `GraphFlashbackPreprocessor` | 图谱联想        |
| 5    | `ConfigPreprocessor`         | 加载 Agent 配置 |
| 6    | `PerceptionPreprocessor`     | 感知系统        |
| 7    | `SystemPromptPreprocessor`   | 构建系统 Prompt |
| ...  | _MOD 注册的预处理器_         | 追加在末尾      |

#### 内置后处理器顺序

| 顺序 | 后处理器                      | 职责              |
| ---- | ----------------------------- | ----------------- |
| 1    | `NITFilterPostprocessor`      | 过滤 NIT 协议标记 |
| 2    | `ThinkingFilterPostprocessor` | 过滤思考链标记    |
| ...  | _MOD 注册的后处理器_          | 追加在末尾        |

---

## 第六章：第三层 — 外部插件

外部插件是独立运行的 HTTP 服务进程，通过 Webhook 回调与 PeroCore 通信。适合需要独立部署、独立生命周期的功能。

### 6.1 架构概览

```text
┌─────────────────────┐         ┌──────────────────────┐
│   PeroCore 主进程    │         │  外部插件进程          │
│                     │         │  (FastAPI/Flask/etc.) │
│  ExternalPlugin     │  HTTP   │                      │
│  Registry           │◄───────►│  /hook/{event}       │
│                     │         │  /event/{event}      │
│  POST /register     │         │  /health             │
│  DELETE /unregister │         │  /stats              │
│  GET /list          │         │  /logs               │
│  GET /info/{id}     │         │                      │
└─────────────────────┘         └──────────────────────┘
```

### 6.2 外部插件的生命周期

```text
1. 外部插件进程启动
2. 向 PeroCore POST /api/plugins/register 注册
3. PeroCore 为插件创建 EventBus 代理
4. PeroCore 定期 GET /health 心跳检测（默认 30s）
5. 事件发生时 PeroCore 通过 HTTP 调用插件
6. 插件停止时调用 DELETE /api/plugins/unregister/{id}
   （或心跳失败后自动标记为离线）
```

### 6.3 注册协议

#### 注册请求

```bash
POST http://localhost:9120/api/plugins/register
Content-Type: application/json

{
    "plugin_id": "my_sync_service",
    "name": "数据同步服务",
    "url": "http://localhost:9527",
    "description": "将记忆同步到外部数据库",
    "version": "1.0.0",
    "hooks": ["memory.save.pre"],
    "events": ["memory.save.post", "chat.response.post"]
}
```

#### 字段说明

| 字段          | 必填 | 说明                                          |
| ------------- | ---- | --------------------------------------------- |
| `plugin_id`   | ✅   | 插件唯一标识符                                |
| `name`        | ✅   | 插件名称                                      |
| `url`         | ✅   | 插件 HTTP 基地址                              |
| `description` | ❌   | 描述                                          |
| `version`     | ❌   | 版本号，默认 `"0.0.1"`                        |
| `hooks`       | ❌   | 订阅的 Hook 事件列表（**可修改 ctx**）        |
| `events`      | ❌   | 订阅的只读事件列表（仅通知，fire-and-forget） |

#### hooks vs events 的区别

| 对比         | hooks                         | events               |
| ------------ | ----------------------------- | -------------------- |
| 调用方式     | 同步等待响应                  | Fire-and-forget 异步 |
| 能否修改 ctx | ✅ 返回 `{"ctx": {...}}` 合并 | ❌ 返回值被忽略      |
| 影响主流程   | 是，阻塞直到响应              | 否，不影响主流程     |
| 超时         | 5s（默认）                    | 不等待               |
| 适用场景     | 拦截、修改数据                | 监听、记录日志       |

### 6.4 外部插件需要实现的端点

#### `/hook/{event_name}` — Hook 端点

```python
@app.post("/hook/memory.save.pre")
async def on_memory_hook(body: dict):
    ctx = body.get("ctx", {})

    # 修改 ctx 并返回（只返回需要修改的字段）
    ctx["tags"] = ctx.get("tags", "") + ",synced"
    return {"ctx": ctx}
```

- **请求体**: `{"ctx": {序列化后的 ctx 字段}}`
- **返回 HTTP 200 + `{"ctx": {修改后的字段}}`** → 修改会被合并回主流程
- **返回 HTTP 204** → 表示不修改任何内容
- **其他状态码** → 记录警告，不影响主流程

#### `/event/{event_name}` — 事件通知端点

```python
@app.post("/event/memory.save.post")
async def on_memory_saved(body: dict):
    ctx = body.get("ctx", {})
    # 记录日志、同步数据等
    print(f"记忆已保存: {str(ctx)[:100]}")
    return {"status": "ok"}
```

- **请求体**: `{"ctx": {序列化后的 ctx}}`
- 返回值被忽略（fire-and-forget）
- 即使处理失败也不影响主流程

#### `/health` — 心跳检查

```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

- PeroCore 每 30 秒调用一次（超时 3 秒）
- 返回 HTTP 200 表示在线，否则标记为离线
- 离线插件的 Hook 和 Event 代理会被跳过

### 6.5 PeroCore 侧 API

| 端点                           | 方法   | 用途           | 说明                           |
| :----------------------------- | :----- | :------------- | :----------------------------- |
| `/api/plugins/register`        | POST   | 注册外部插件   | 支持热重载（同 ID 自动先注销） |
| `/api/plugins/unregister/{id}` | DELETE | 注销插件       | 同时移除所有 EventBus 代理     |
| `/api/plugins/list`            | GET    | 列出所有插件   | 返回在线状态、最后心跳等       |
| `/api/plugins/info/{id}`       | GET    | 查询插件状态   | 404 如果不存在                 |
| `/api/plugins/notify`          | POST   | 向前端推送通知 | 所有 MOD/外部插件可用          |

### 6.6 完整外部插件示例

```python
# backend/mods/my_mod/external/server.py

import time
from typing import Dict, List

import httpx
import uvicorn
from fastapi import FastAPI

# ─── 配置 ───
PLUGIN_ID = "my_sync_service"
PLUGIN_NAME = "数据同步服务"
PLUGIN_URL = "http://localhost:9527"
PERO_URL = "http://localhost:9120"

# ─── 状态 ───
app = FastAPI(title=PLUGIN_NAME)
sync_log: List[Dict] = []

# ─── 生命周期 ───

@app.on_event("startup")
async def register_to_pero():
    """启动时向 PeroCore 注册"""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{PERO_URL}/api/plugins/register",
                json={
                    "plugin_id": PLUGIN_ID,
                    "name": PLUGIN_NAME,
                    "url": PLUGIN_URL,
                    "description": "将记忆同步到外部存储",
                    "version": "1.0.0",
                    "hooks": [],
                    "events": ["memory.save.post"],
                },
            )
            if resp.status_code == 200:
                print(f"✔ 已向 PeroCore 注册")
            else:
                print(f"✖ 注册失败: {resp.status_code}")
        except Exception as e:
            print(f"✖ 无法连接 PeroCore: {e}")

# ─── 事件端点 ───

@app.post("/event/memory.save.post")
async def on_memory_saved(body: dict):
    ctx = body.get("ctx", {})
    sync_log.append({
        "action": "memory_saved",
        "preview": str(ctx)[:100],
        "timestamp": time.time(),
    })
    return {"status": "ok"}

# ─── 健康检查 ───

@app.get("/health")
async def health():
    return {"status": "ok", "plugin_id": PLUGIN_ID}

# ─── 独立功能 ───

@app.get("/stats")
async def get_stats():
    return {"total_synced": len(sync_log), "recent": sync_log[-10:]}

# ─── 启动 ───

if __name__ == "__main__":
    print(f"🔌 {PLUGIN_NAME} 正在启动...")
    uvicorn.run(app, host="0.0.0.0", port=9527)
```

### 6.7 从 MOD 的 init() 中注册外部插件

如果外部服务已在运行，可以在 MOD 初始化时尝试注册它：

```python
# main.py
import asyncio

def init():
    # ... 其他注册 ...
    asyncio.get_event_loop().call_soon(
        lambda: asyncio.ensure_future(_try_register_external())
    )

async def _try_register_external():
    try:
        from mods._external_plugins.service import get_external_plugin_registry
        registry = get_external_plugin_registry()
        await registry.register({
            "plugin_id": "my_sync_service",
            "name": "数据同步服务",
            "url": "http://localhost:9527",
            "hooks": [],
            "events": ["memory.save.post"],
        })
    except Exception as e:
        # 外部服务未启动时静默跳过
        pass
```

### 6.8 启动顺序

```bash
# 1. 先启动 PeroCore 主进程
cd PeroCore-electron && npm run dev

# 2. 再独立启动外部插件
python backend/mods/my_mod/external/server.py
```

> ⚠️ `external/` 子目录下的代码**不会被 ModManager 加载**。它需要作为独立进程启动。

---

## 第七章：IoC 容器与组件替换

### 7.1 ComponentContainer 概述

`ComponentContainer` 是一个轻量级依赖注入（IoC）容器，管理核心组件的生命周期。MOD 可以通过它替换系统的默认实现。

```python
from core.component_container import ComponentContainer

# 注册（由 bootstrap 调用）
ComponentContainer.register(InterfaceType, factory_function)

# 获取实例（单例，首次调用时创建）
instance = ComponentContainer.get(InterfaceType)

# 覆盖（MOD 专用）
ComponentContainer.override(InterfaceType, new_factory_function)
```

### 7.2 可替换组件列表

当前仅以下两个组件通过 IoC 管理，支持 MOD 替换：

| 接口                    | 默认实现               | 替换影响           |
| ----------------------- | ---------------------- | ------------------ |
| `IPreprocessorManager`  | `PreprocessorManager`  | 替换整个预处理管道 |
| `IPostprocessorManager` | `PostprocessorManager` | 替换整个后处理管道 |

> 其他核心服务（PromptManager, MemoryService 等）由使用方直接实例化，不通过 IoC 容器管理。

### 7.3 替换组件示例

```python
# main.py — 完全替换预处理管道

from core.component_container import ComponentContainer
from core.interfaces import IPreprocessorManager

class CustomPreprocessorManager:
    """自定义预处理管道"""

    def __init__(self):
        self.preprocessors = []

    def register(self, preprocessor):
        self.preprocessors.append(preprocessor)
        # 按 priority 排序
        self.preprocessors.sort(key=lambda p: getattr(p, 'priority', 50))

    async def process(self, context):
        for p in self.preprocessors:
            context = await p.process(context)
        return context

def init():
    # override() 会清除旧实例，下次 get() 时使用新工厂
    ComponentContainer.override(
        IPreprocessorManager,
        lambda: CustomPreprocessorManager()
    )
    print("[MyMod] 已替换 PreprocessorManager")
```

> ⚠️ 替换组件是**高风险操作**。建议优先使用 `register()` 追加处理器，仅在确实需要完全控制管道行为时才使用 `override()`。

### 7.4 register vs override 对比

| 操作                           | 效果                 | 风险 | 适用场景                |
| ------------------------------ | -------------------- | ---- | ----------------------- |
| `get().register(processor)`    | 追加处理器到现有管道 | 低   | 大多数场景              |
| `override(interface, factory)` | 完全替换组件实现     | 高   | 需要自定义管道顺序/逻辑 |

---

## 第八章：通知与前端交互

### 8.1 推送前端通知

MOD 和外部插件可以通过 `/api/plugins/notify` 接口向前端推送非模态通知框：

```bash
POST http://localhost:9120/api/plugins/notify
Content-Type: application/json

{
    "title": "记忆同步完成",
    "body": "已成功同步 42 条记忆到云端",
    "level": "success",
    "duration": 5000,
    "actions": [
        {"label": "查看详情", "url": "/memory"}
    ],
    "source": "my_sync_mod"
}
```

#### 通知字段

| 字段       | 类型   | 默认值              | 说明                                           |
| ---------- | ------ | ------------------- | ---------------------------------------------- |
| `title`    | `str`  | 必填                | 通知标题                                       |
| `body`     | `str`  | `""`                | 通知正文                                       |
| `level`    | `str`  | `"info"`            | 级别：`info` / `success` / `warning` / `error` |
| `duration` | `int`  | `5000`              | 显示时长(ms)，`0` = 不自动关闭                 |
| `actions`  | `list` | `[]`                | 操作按钮 `[{"label": "文本", "url": "路由"}]`  |
| `source`   | `str`  | `"external_plugin"` | 来源标识                                       |

### 8.2 在 Hook 中推送通知

```python
import httpx

async def on_memory_save_post(memory):
    """记忆保存后通知前端"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "http://localhost:9120/api/plugins/notify",
                json={
                    "title": "新记忆已保存",
                    "body": f"内容: {str(memory.content)[:50]}...",
                    "level": "info",
                    "duration": 3000,
                    "source": "memory_notify_mod",
                }
            )
    except Exception:
        pass  # 通知失败不应影响主流程
```

### 8.3 通知的内部实现

通知通过 `GatewayHub` 广播到所有已连接的前端客户端：

```text
POST /api/plugins/notify
        │
        ▼
  gateway_hub.broadcast_notification()
        │
        ▼
  WebSocket → 前端 Toast 组件
```

---

## 第九章：高级主题

### 9.1 异步编程

Hook 和处理器都完全支持 `async`。EventBus 内部自动判断 Handler 类型：

```python
# 异步 Hook — 适合 I/O 操作
async def on_memory_save_pre(ctx):
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.post("https://api.example.com/audit", json=ctx) as resp:
            if resp.status != 200:
                ctx["cancel"] = True

# 同步 Hook — 适合纯计算
def on_tool_post(ctx, **kwargs):
    print(f"Tool {ctx['function_name']} completed")
```

### 9.2 在 init() 中调度异步任务

`init()` 是同步函数，但可以调度异步初始化：

```python
import asyncio

def init():
    EventBus.subscribe("memory.save.pre", on_memory_save_pre)
    # 调度异步初始化（不阻塞启动）
    asyncio.get_event_loop().call_soon(
        lambda: asyncio.ensure_future(async_setup())
    )

async def async_setup():
    """连接外部服务、预加载数据等"""
    pass
```

### 9.3 访问数据库

通过 Hook 的 ctx 可以获取数据库会话：

```python
async def on_memory_save_pre(ctx):
    session = ctx.get("session")
    if session:
        from sqlmodel import select
        from models import Memory
        stmt = select(Memory).order_by(Memory.timestamp.desc()).limit(5)
        recent = (await session.exec(stmt)).all()
```

> ⚠️ 避免在 Hook 中 `commit()` 或 `rollback()`，以免干扰主流程的事务。

### 9.4 错误处理与容错

EventBus 会捕获每个 Handler 的异常，记录日志但不中断其他 Handler：

```python
async def buggy_handler(ctx):
    raise ValueError("出错了！")
    # 日志: [EventBus] 事件 'xxx' 处理器 'buggy_handler' 执行出错
    # 其他 Handler 和主流程不受影响
```

### 9.5 跨 MOD 通信

MOD 之间可以通过 EventBus 自定义事件通信：

```python
# MOD A: 发布自定义事件
await EventBus.publish("custom.my_event", {"data": "hello"})

# MOD B: 订阅自定义事件
EventBus.subscribe("custom.my_event", on_custom_event)
```

> 建议自定义事件名使用 `custom.` 前缀，避免与系统事件冲突。

### 9.6 热重载

外部插件支持热重载 — 使用相同 `plugin_id` 重新注册会自动先注销旧的。In-process MOD 目前不支持热重载，需要重启 PeroCore。

---

## 第十章：最佳实践

### 10.1 优先使用 Hook

```
❓ 能不能通过修改某个事件的 ctx 来实现？
   ├─ 是 → 用 EventBus Hook
   └─ 否 → 需要处理 LLM 输入/输出？
           ├─ 是 → 用管道注册
           └─ 否 → 需要独立服务？
                   ├─ 是 → 用外部插件
                   └─ 否 → 重新考虑需求
```

### 10.2 异常安全

```python
def init():
    try:
        EventBus.subscribe("memory.save.pre", handler)
        pm = ComponentContainer.get(IPreprocessorManager)
        pm.register(MyProcessor())
    except Exception as e:
        print(f"[MyMod] ✖ 初始化失败: {e}")
        # 不要 raise —— 让其他 MOD 正常加载
```

### 10.3 日志规范

```python
import logging
logger = logging.getLogger("pero.mod.my_mod")

logger.info("[MyMod] 初始化完成")       # ✅
logger.debug("[MyMod] 处理了事件")      # ✅
logger.error("[MyMod] 错误", exc_info=True)  # ✅
```

### 10.4 推荐文件组织

```text
my_mod/
├── mod.toml           # 元数据
├── main.py            # init() 入口（只做注册）
├── hooks.py           # Hook 处理函数
├── processors.py      # 管道处理器
└── external/          # 外部插件（可选）
    └── server.py
```

### 10.5 命名约定

| 类型        | 命名规则           | 示例                         |
| ----------- | ------------------ | ---------------------------- |
| MOD 目录    | `snake_case`       | `memory_tagger/`             |
| Hook 函数   | `on_{event}`       | `on_memory_save_pre()`       |
| 预处理器    | `XxxPreprocessor`  | `TimeTagPreprocessor`        |
| 后处理器    | `XxxPostprocessor` | `SensitiveWordPostprocessor` |
| 外部插件 ID | `{mod}_ext`        | `memory_tagger_ext`          |
| Logger      | `pero.mod.{name}`  | `pero.mod.memory_tagger`     |

### 10.6 不要修改核心代码

| ❌ 不要                  | ✅ 应该                         |
| ------------------------ | ------------------------------- |
| 修改 `agent_service.py`  | 用 `chat.request.pre` Hook      |
| 修改 `memory_service.py` | 用 `memory.save.pre` Hook       |
| 修改 Manager 源码        | 用 `register()` 或 `override()` |

### 10.7 发布检查清单

- [ ] `mod.toml` 填写了完整元数据
- [ ] `init()` 有 try-except 保护
- [ ] Hook 函数支持 async（涉及 I/O 时）
- [ ] 使用 logging 而非 print
- [ ] 不依赖 `_` 前缀的系统目录
- [ ] `external/` 服务可独立启动
- [ ] 有 README 或注释说明功能

---

## 第十一章：常见问题

### Q: 一个 MOD 崩溃会影响其他 MOD 吗？

**不会。** ModManager 为每个 MOD 的 `init()` 单独 try-except。即使某个 MOD 加载失败，其他 MOD 和系统照常运行。失败的 MOD 会在 `ModInfo.error` 中记录错误信息。

### Q: MOD 的加载顺序是什么？

按文件夹名**字母序**升序加载。如果 MOD B 依赖 MOD A 的 Hook 先注册，请确保 A 的文件夹名排在 B 前面（如 `01_base_mod/`, `02_dependent_mod/`）。

### Q: 同步还是异步？

都支持。EventBus 会自动检测 Handler 是否为 `async def` 并正确调用。I/O 密集型操作建议用 async。

### Q: 如何调试 MOD？

1. **日志** — 使用 `logging.getLogger("pero.mod.xxx")`
2. **ModInfo** — `ModManager.get_mod_info("id")` 查看加载状态和错误
3. **控制台** — 查看启动时的 `[ModManager]` 输出
4. **EventBus 测试** — 手动 `await EventBus.publish("event", ctx)` 验证 Hook

### Q: `_external_plugins/` 是什么？

是系统内置的外部插件基础设施，**不是用户 MOD**。`_` 前缀的目录会被 ModManager 跳过。它提供了 `ExternalPluginRegistry` 和 `/api/plugins/*` API 路由。

### Q: 外部插件离线后会怎样？

PeroCore 每 30 秒通过 `/health` 心跳检测。如果连接失败，插件被标记为 `online=False`，其 Hook 和 Event 代理会被跳过（不报错、不阻塞）。恢复后自动重新标记为在线。

### Q: 能否在 MOD 中导入第三方库？

可以，但需要确保该库已安装在 PeroCore 的 Python 环境中。建议在 `init()` 中用 try-except 包裹导入：

```python
def init():
    try:
        import pandas
    except ImportError:
        print("[MyMod] 需要 pandas: pip install pandas")
        return
```

### Q: MOD 和 NIT 插件有什么区别？

| 对比     | MOD                         | NIT 插件                         |
| -------- | --------------------------- | -------------------------------- |
| 扩展目标 | 系统行为（Hook 事件、管道） | LLM 工具能力（Function Calling） |
| 位置     | `backend/mods/`             | `nit_core/tools/`                |
| 加载方式 | ModManager 加载             | NIT Dispatcher 加载              |
| 运行时机 | 系统启动时                  | LLM 请求时                       |

---

## 第十二章：API 速查表

### EventBus

| API                                    | 说明     |
| -------------------------------------- | -------- |
| `EventBus.subscribe(event, handler)`   | 订阅事件 |
| `EventBus.unsubscribe(event, handler)` | 取消订阅 |
| `await EventBus.publish(event, ctx)`   | 发布事件 |

### ComponentContainer

| API                                               | 说明     |
| ------------------------------------------------- | -------- |
| `ComponentContainer.register(interface, factory)` | 注册组件 |
| `ComponentContainer.get(interface)`               | 获取实例 |
| `ComponentContainer.override(interface, factory)` | 覆盖组件 |

### ModManager

| API                            | 说明               |
| ------------------------------ | ------------------ |
| `ModManager.load_mods()`       | 扫描并加载所有 MOD |
| `ModManager.get_loaded_mods()` | 获取所有 MOD 信息  |
| `ModManager.get_mod_info(id)`  | 获取单个 MOD 信息  |

### ExternalPluginRegistry

| API                                   | 说明         |
| ------------------------------------- | ------------ |
| `POST /api/plugins/register`          | 注册外部插件 |
| `DELETE /api/plugins/unregister/{id}` | 注销插件     |
| `GET /api/plugins/list`               | 列出所有插件 |
| `GET /api/plugins/info/{id}`          | 查询插件状态 |
| `POST /api/plugins/notify`            | 推送前端通知 |

### 可用事件总表

| 事件                 | 可修改 | 可取消 |
| -------------------- | ------ | ------ |
| `chat.request.pre`   | ✅     | ✅     |
| `chat.response.post` | ❌     | ❌     |
| `memory.save.pre`    | ✅     | ✅     |
| `memory.save.post`   | ❌     | ❌     |
| `prompt.build.pre`   | ✅     | ❌     |
| `prompt.build.post`  | ✅     | ❌     |
| `tool.execute.pre`   | ✅     | ✅     |
| `tool.execute.post`  | ❌     | ❌     |

---

## 附录：完整三层示例

参见 `backend/mods/memory_tagger/` — 该示例演示了三层扩展的统一用法：

```text
backend/mods/memory_tagger/
├── mod.toml            # 声明三层都使用
├── main.py             # init() 中注册三层
├── hooks.py            # EventBus Hook (memory.save.pre, prompt.build.post)
├── processors.py       # 管道预处理器 (TimeTagPreprocessor)
└── external/
    └── server.py       # 外部插件 (监听 memory.save.post, 提供 /stats)
```

**main.py 核心逻辑：**

```python
def init():
    # 第一层：EventBus Hook
    EventBus.subscribe("memory.save.pre", on_memory_save_pre)
    EventBus.subscribe("prompt.build.post", on_prompt_build_post)

    # 第二层：管道注册
    pm = ComponentContainer.get(IPreprocessorManager)
    pm.register(TimeTagPreprocessor())

    # 第三层：注册配套外部插件
    asyncio.get_event_loop().call_soon(
        lambda: asyncio.ensure_future(_try_register_external())
    )
```
