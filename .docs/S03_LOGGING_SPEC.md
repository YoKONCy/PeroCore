# 日志与可观测性规范

> **适用范围**：infOS-TS 全项目
> **最后更新**：2026-10-17

---

## 1. 后端日志

### 1.1 日志库

使用 **consola**。

### 1.2 初始化

```typescript
// lib/logger.ts
import { createConsola } from 'consola'

export function createLogger(module: string) {
  return createConsola({ defaults: { tag: module } })
}
```

### 1.3 使用

```typescript
const logger = createLogger('MemoryService')

logger.info('记忆已创建', { memoryId: 42, agentId: 'pero' })
logger.warn('LLM 调用重试', { attempt: 2, maxRetries: 3 })
logger.error('数据库操作失败', { error: err.message, stack: err.stack })
```

### 1.4 日志级别

| 级别    | 用途                                         |
| ------- | -------------------------------------------- |
| `error` | 系统异常、需要人工介入                       |
| `warn`  | 降级、重试、非致命异常                       |
| `info`  | 关键业务节点（创建/删除/配置变更/启动/关闭） |
| `debug` | 开发调试信息（生产环境默认关闭）             |

### 1.5 日志语言

**日志消息使用中文**，结构化数据字段用英文 key：

```typescript
// ✅
logger.info('记忆已创建', { memoryId: 42 })
// ❌
logger.info('Memory created', { memoryId: 42 })
```

---

## 2. 前端日志

```typescript
// lib/logger.ts
export const logger = {
  info: (tag: string, message: string, data?: unknown) => {
    console.log(`[${tag}] ${message}`, data ?? '')
    if ((window as any).electron) {
      ;(window as any).electron.send('log-from-renderer', `[${tag}] ${message}`)
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

禁止直接使用 `console.log`。

---

## 3. 请求日志中间件

统一使用 `packages/backend/src/middleware/requestLogger.ts`。HTTP 状态码 ≥400 时保留 `warn`；成功请求只有耗时严格超过分类阈值才使用 `warn`，其余使用 `trace`，默认不打印。阈值只控制日志告警，不改变请求超时、取消或重试行为。

| 操作分类 | 标黄阈值 | 典型请求 |
| --- | --- | --- |
| 普通读取 | 10 秒 | 状态、配置、历史记录、目录列表 |
| 普通写入 | 15 秒 | 保存配置、删除记忆、修改记录 |
| 远端调用 | 60 秒 | 服务商探测、远端模型列表、天气、知识检索、Token 预算预览、MCP 连接、子应用启停 |
| 文件处理 | 120 秒 | 上传、内容读取、文档预览、附件解析、SQLite 快照 |
| 模型生成 | 300 秒 | 非流式聊天、模型测试、TTS/ASR、据点对话、塔罗解读 |
| 批量维护 | 300 秒 | 索引重建、数据同步、重置 |
| SSE 响应建立 | 60 秒 | 只衡量返回流响应前的处理，不累计连接存活时间 |

分类按方法和具体操作路径匹配，不对 `/api/chat`、`/api/voice` 等整个模块统一放宽。流式响应优先按 SSE 响应建立分类；新增长耗时接口时同步维护分类规则。

---

## 4. 文件持久化

日志写入 `$PERO_DATA_DIR/logs/` 目录。

| 维度     | 策略                                           |
| -------- | ---------------------------------------------- |
| 文件命名 | `infos-2026-04-20.log`（按天）                 |
| 大小上限 | 5MB / 文件，超出分片 `.1.log`, `.2.log`        |
| 保留天数 | 14 天，启动时自动清理                          |
| 格式     | `[ISO8601] [LEVEL] [Module] 消息 {结构化数据}` |

---

## 5. 健康检查

```typescript
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    uptime: process.uptime(),
    version: APP_VERSION,
    memory: process.memoryUsage(),
  }),
)
```

Docker Compose 中配置 healthcheck：

```yaml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:9120/api/health']
  interval: 30s
  timeout: 5s
  retries: 3
```

---

_本文档由 Carola 整理，适用于 infOS-TS 日志规范。_
