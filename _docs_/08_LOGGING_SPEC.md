# 日志与可观测性规范

> **版本**：0.2.0（临时定稿） · **更新时间**：2026-04-17
> **适用范围**：PeroCore-TS 全项目

---

## 1. 后端日志

### 1.1 日志库

使用 **consola**（最接近 Python loguru 的 TS 方案）。

```bash
pnpm add consola
```

### 1.2 初始化

```typescript
// lib/logger.ts
import { createConsola } from 'consola'

export function createLogger(module: string) {
  return createConsola({ defaults: { tag: module } })
}
```

### 1.3 格式要求

```typescript
import { createLogger } from '../lib/logger'

const logger = createLogger('MemoryService')  // 带模块标识

logger.info('记忆已创建', { memoryId: 42, agentId: 'pero' })
logger.warn('LLM 调用重试', { attempt: 2, maxRetries: 3 })
logger.error('数据库操作失败', { error: err.message, stack: err.stack })
```

输出格式：

```
[2026-04-17 21:00:00] [INFO] [MemoryService] 记忆已创建 {"memoryId":42,"agentId":"pero"}
```

### 1.3 日志级别

| 级别 | 用途 |
|---|---|
| `error` | 系统异常、需要人工介入的问题 |
| `warn` | 降级、重试、非致命异常 |
| `info` | 关键业务节点（创建/删除/配置变更/启动/关闭） |
| `debug` | 开发调试信息（生产环境默认关闭） |

### 1.4 日志语言

继承注释规范：**日志消息使用中文**，结构化数据字段用英文 key。

```typescript
// ✅
logger.info('记忆已创建', { memoryId: 42 })
logger.error('LLM 调用失败', { provider: 'openai', statusCode: 429 })

// ❌
logger.info('Memory created', { memoryId: 42 })
```

---

## 2. 前端日志

### 2.1 统一替换 console.log

```typescript
// lib/logger.ts
export const logger = {
  info: (tag: string, message: string, data?: unknown) => {
    console.log(`[${tag}] ${message}`, data ?? '')
    // 如果在 Electron 中，也发送到主进程
    if ((window as any).electron) {
      (window as any).electron.send('log-from-renderer', `[${tag}] ${message}`)
    }
  },
  warn: (tag: string, message: string, data?: unknown) => {
    console.warn(`[${tag}] ${message}`, data ?? '')
  },
  error: (tag: string, message: string, data?: unknown) => {
    console.error(`[${tag}] ${message}`, data ?? '')
  },
}
```

使用：

```typescript
// ✅
logger.info('ChatInput', '发送消息', { length: message.length })
logger.error('ApiClient', '请求失败', { endpoint, code: err.code })

// ❌
console.log('sending message...')
console.log('error:', err)
```

---

## 3. 请求日志中间件

后端每个请求自动记录日志：

```typescript
// middleware/requestLogger.ts
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  const status = c.res.status

  if (status >= 400) {
    logger.warn('HTTP', `${c.req.method} ${c.req.path} → ${status} (${duration}ms)`)
  } else {
    logger.info('HTTP', `${c.req.method} ${c.req.path} → ${status} (${duration}ms)`)
  }
})
```

## 4. 文件持久化

日志自动写入磁盘文件，位于 `$PERO_DATA_DIR/logs/` 目录。

### 4.1 启用方式

在 `main.ts` 启动时调用：

```typescript
import { initLogFile } from './lib/logger'

// 在 DI 容器初始化前调用 (越早越好)
initLogFile()
```

### 4.2 策略

| 维度 | 策略 |
|---|---|
| 文件命名 | `perocore-2026-04-20.log` (按天) |
| 大小上限 | 5MB / 文件，超出自动分片 `.1.log`, `.2.log` |
| 保留天数 | 14 天，启动时自动清理过期文件 |
| 格式 | `[ISO8601] [LEVEL] [Module] 消息 {结构化数据}` |

### 4.3 输出示例

```
[2026-04-20T01:20:00.000Z] [INFO] [MemoryService] 记忆已创建 {"memoryId":42}
[2026-04-20T01:20:01.000Z] [WARN] [LlmService] LLM 调用失败，1200ms 后重试 {"attempt":1}
```

---

## 5. 待定事项

- [x] ~~日志库选型~~ → **consola**
- [x] ~~日志文件持久化策略~~ → 按天轮转 + 5MB 分片 + 14 天清理
- [ ] traceId 跨请求追踪 (留到 Electron/Docker 阶段)
- [ ] Electron 主进程 IPC 日志转发 (Electron 阶段)
- [ ] Docker 部署日志采集方案 (Docker 阶段)

---

*本文档由 Carola 整理，适用于 PeroCore-TS 日志规范。*

