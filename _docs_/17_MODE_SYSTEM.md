# 模式体系与角色管理规范

> **版本**：0.1.0（临时定稿） · **更新时间**：2026-04-19
> **适用范围**：PeroCore-TS 全局模式切换与多角色管理
> **关联决策**：D52 / D53 / D54 / D55 / D56

---

## 1. 模式总览

```
PeroCore 运行模式
│
├── 桌面模式 (source = "desktop") ← 标准模式家族
│   ├── Profile: default     → 完整功能，所有 Enricher 启用
│   ├── Profile: lightweight → 精简模式，跳过 Memory/Tool Enricher
│   ├── Profile: companion   → 陪伴模式，default + 定时主动行为
│   └── Profile: work        → 工作模式，default + 隔离会话 + 工作工具链
│
├── 群聊模式 (source = "group_chat") ← 多角色据点
│   └── 用户 + 多个 Agent 在 Room 中互动
│   └── 复用 AgentService.chat() + 视角转换
│
└── 社交模式 (source = "social") ← Adapter Extension
    └── 每角色独立: Agent × NapCat 实例 × social.tdb
    └── 不在核心后端中，通过 Extension 扩展
```

> [!IMPORTANT]
> **工作模式不是独立模式**，而是桌面模式的一个 Profile。
> 其本质是 `source = "desktop"` + `SessionService.enterWorkMode()` 切换到隔离会话。

---

## 2. 桌面模式家族 (D52)

### 2.1 Profile 定义

| Profile | 说明 | Enricher 门控 | 特殊行为 |
|---|---|---|---|
| **default** | 默认完整体验 | 全部启用 | 无 |
| **lightweight** | 轻量模式 | 跳过 MemoryEnricher、ToolEnricher | 降低 Token 消耗 |
| **companion** | 陪伴模式 | 全部启用 | 启用 BackgroundScheduler (定时主动对话) |
| **work** | 工作模式 | 全部启用 + WorkToolEnricher | 隔离 session + 启用工作工具链 |

### 2.2 Profile 切换机制

Profile 通过 `ConfigRepository` 存储，运行时可随时切换：

```typescript
// 获取当前 Profile
const profile = await configRepo.get('desktop.profile') ?? 'default'

// Enricher 门控示例
class MemoryEnricher implements Enricher {
  shouldApply(context: EnrichmentContext): boolean {
    return context.profile !== 'lightweight'
  }
}
```

### 2.3 工作模式细节

工作模式**不改变 source**，只改变 Session 状态：

```
进入工作模式:
  1. SessionService.enterWorkMode(agentId, taskName)
  2. 生成隔离 session_id: "work_pero_20260419_143000"
  3. ConfigRepo 写入 profile = "work"
  4. ToolRegistry 启用工作工具链 (Enricher 通过 profile 门控判断)

退出工作模式:
  1. SessionService.exitWorkMode(agentId)
  2. Scorer 总结工作日志 → DiaryEngine → diary.tdb
  3. 恢复 session_id = "default"
  4. ConfigRepo 恢复 profile = "default"
```

---

## 3. 角色管理 (D54)

### 3.1 角色生命周期

```
安装/创建          运行时启用          设为主角色          运行时禁用
─────────── → agents/{id}/ → ──────────── → ──────────── → ────────────
              config.json       AgentManager     AgentManager      关闭 .tdb
              system_prompt.md  .enableAgent()   .setActiveAgent()  .disableAgent()
```

### 3.2 主角色 vs 启用角色

| 概念 | 说明 | 数量 |
|---|---|---|
| **主角色** (active) | 桌面模式中与用户直接对话的角色 | 恰好 1 个 |
| **启用角色** (enabled) | 已加载到内存、可参与群聊的角色 | 0 ~ N 个 |
| **已安装角色** (installed) | agents/ 目录下有配置文件的角色 | 0 ~ N 个 |

### 3.3 热启用 / 热禁用

```typescript
// AgentManager 新增方法
enableAgent(agentId: string): void {
  this.enabledAgents.add(agentId)
  // .tdb 由 StoreRegistry 懒加载，无需在此打开
}

disableAgent(agentId: string): void {
  if (agentId === this.activeAgentId) {
    throw new Error('不能禁用主角色')
  }
  this.enabledAgents.delete(agentId)
  // 可选: 通知 StoreRegistry 关闭该角色的 .tdb（释放内存）
}
```

> [!NOTE]
> v1 的 LauncherView 预选机制废弃。角色默认启用列表通过 `config.json` 中的 `"enabled": true` 字段控制。

---

## 4. 群聊据点系统 (D53)

### 4.1 核心概念

```
Stronghold (据点)
├── Facility (设施) — 如 "我的据点"、"学校"
│   ├── Room (房间) — 如 "客厅"、"书房"、"厨房"
│   │   ├── Agent 位置 — 角色当前在哪个房间
│   │   ├── 环境变量 — 光照/温度/音乐等 (RP 沉浸感)
│   │   └── GroupChatRoom — 关联的群聊会话
│   └── Room ...
└── Butler (管家) — 管理设施/房间/移动角色的系统角色
```

### 4.2 群聊消息流

```
用户在 Room 发消息
    │
    ├── 1. 保存消息 (GroupChatMessage)
    │
    ├── 2. 为房间内每个 Agent 注入记忆上下文
    │       (视角转换: 自己说 → "I said"; 别人说 → "{name} said")
    │
    ├── 3. 调度器判定: 谁接话？
    │       ├── 轻量判定: 性格 + 话题匹配 + 积极度权重
    │       └── 可能多个 Agent 回复 (按积极度排序)
    │
    └── 4. 选中的 Agent 调用 AgentService.chat()
            ├── source = "group_chat"
            ├── session_id = "group_{roomId}"
            └── 历史 = Room 最近 N 条消息 (视角转换后)
```

### 4.3 调度器设计 (待细化)

v1 的调度器用一次 LLM 调用来决定谁接话，太贵。v2 建议：

```
Step 1: 规则预筛 (零 LLM 开销)
  - 被 @mention 的 Agent → 一定回复
  - 最近 3 条都是同一个 Agent 说的 → 冷却期，跳过
  - 用户只说了 "嗯"、"好" 等短回复 → 概率降低

Step 2: 轻量判定 (可选 LLM，几十 tokens)
  - 注入角色性格描述 + 最近 1 条消息
  - 判定: "你会接话吗？回答 YES/NO"
  - 或者: 基于 embedding 余弦相似度 (零 LLM)
```

---

## 5. 社交模式 (D55)

### 5.1 角色级独立启用

```json
// agents/pero/config.json
{
  "social": {
    "enabled": true,
    "adapter": "napcat",
    "account": "QQ_12345678",
    "config": {
      "auto_reply_groups": ["group_001"],
      "reply_probability": 0.3
    }
  }
}

// agents/neko/config.json
{
  "social": {
    "enabled": false
  }
}
```

### 5.2 数据隔离

```
data/
├── agent_pero/
│   ├── main.tdb       ← 桌面模式记忆
│   └── social.tdb     ← Pero 的社交模式记忆 (独立)
├── agent_neko/
│   ├── main.tdb       ← 桌面模式记忆
│   └── (无 social.tdb, 未启用社交)
└── shared/
    └── diary.tdb      ← 统一日记 (所有角色/模式写入)
```

### 5.3 社交 → 桌面 信息流

```
Pero 在 QQ 聊到 "主人在学画画"
  → 社交 Scorer → 提取记忆 → social.tdb
  → 社交 DiaryEngine → 日记条目 → diary.tdb

次日桌面聊天:
  → PEDSA v2 检索 main.tdb (不包含社交细节)
  → LLM 用 NIT 查 diary_by_topic("最近生活")
  → 找到日记提到 "画画"
  → "是不是画画太辛苦了？我记得你最近在学呢~"
```

---

## 6. DiaryEngine 统一报告 (D56)

### 6.1 替代关系

| v1 (各自独立) | v2 (统一) |
|---|---|
| 桌宠日记 `desktop_diary` | DiaryEngine (profile="default") |
| 社交日报 `social_daily` | DiaryEngine (profile="social") |
| 工作日志 `work_log` | DiaryEngine (profile="work") |
| 周报 `weekly_report` | ❌ 砍掉 |
| Waifu 台词 `waifu_text_updater` | Hook 扩展 (可选) |

### 6.2 DiaryEngine 输出

```typescript
interface DiaryEntry {
  date: string              // "2026-04-19"
  agentId: string           // "pero"
  profile: string           // "default" | "social" | "work"
  diary: string             // 日记正文
  entities: string[]        // 实体抽取 ["螺蛳粉", "画画"]
  relations: DiaryRelation[] // 图谱边
  mood: string              // 情感 "happy"
  highlights: string[]      // 亮点
}
```

### 6.3 触发时机

- **桌面日记**: Scorer 攒批后，每日结束时或对话间隔 > 2 小时
- **社交日记**: 社交 Scorer 攒批后 (同上)
- **工作日记**: `SessionService.exitWorkMode()` 时自动生成

---

## 7. 与现有代码对照

| v2 模块 | 状态 | 说明 |
|---|---|---|
| `AgentManager.enableAgent/disableAgent` | 🟡 待实装 | 热启用能力 |
| `SessionService.enterWorkMode/exitWorkMode` | ✅ 已实装 | 工作模式隔离会话 |
| `Enricher.shouldApply()` 门控 | ✅ 已设计 | Profile 条件注入 |
| `StrongholdService` | ❌ 待设计 | 群聊据点 CRUD |
| `GroupChatService` | ❌ 待设计 | 多角色群聊消息 |
| `GroupChatDispatcher` | ❌ 待设计 | 调度器 |
| `DiaryEngine` | ❌ 待设计 | 统一日记生成 |
| 社交 Adapter Extension | ❌ 待设计 | P5 Extension 系统完成后 |

---

_本文档由 Carola 整理，适用于 PeroCore-TS 模式体系规范。_
