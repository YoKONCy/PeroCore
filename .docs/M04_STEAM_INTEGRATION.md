# Steam 集成与资产联邦化规范

> **版本**：0.2.0 · **更新时间**：2026-04-22
> **适用范围**：`electron/main/services/steam*`、`packages/backend/src/core/`
> **依赖规范**：[A04_DEPLOYMENT](./A04_DEPLOYMENT.md)、[A02_BACKEND_ARCHITECTURE](./A02_BACKEND_ARCHITECTURE.md)

---

## 1. 概述

infOS 同时支持 **Electron 桌面版（Steam 上架）** 和 **Docker 后端版**。Steam 相关功能（Workshop、Cloud Sync、成就、Overlay）仅存在于 Electron 版，Docker 版完全不涉及 Steam。

---

## 2. 模块职责划分

### 2.1 Electron 专属 — Steam 服务

```
electron/main/services/
  ├── steam.ts                ← steamworks.js 封装（初始化/用户/Overlay）
  ├── cloudSync.ts            ← Steam Cloud 同步实现
  ├── workshopService.ts      ← 创意工坊管理（订阅/下载/状态）
  └── achievementService.ts   ← 成就系统（仅预留接口）
```

- 全部通过 IPC 暴露给渲染进程
- Docker 版中这些 Service **完全不存在**
- `steamworks.js` native addon 延迟加载，先检查 `steam_api64.dll` 存在性（防 segfault）

### 2.2 后端共享 — 路径与资产核心

```
packages/backend/src/core/
  ├── pathResolver.ts         ← 虚拟路径管理（@app/@data/@workshop/@temp）
  └── assetRegistry.ts        ← 统一资产注册表
```

### 2.3 职责边界

| 职责 | Electron | Docker |
|---|---|---|
| Steam 初始化 / Overlay | ✅ steamService | ❌ 不存在 |
| Workshop 管理 | ✅ workshopService | ❌ 不存在 |
| Cloud 同步 | ✅ steamCloudSync | ❌ 不存在 |
| 成就解锁 | ✅ achievementService (预留) | ❌ 不存在 |
| PathResolver | ✅ 含 @workshop | ✅ 无 @workshop |
| AssetRegistry | ✅ 扫描 3 层 | ✅ 扫描 2 层（无 workshop） |

---

## 3. 虚拟路径管理器 — PathResolver

### 3.1 逻辑前缀定义

| 前缀 | 含义 | 可写 | Electron 映射 | Docker 映射 |
|---|---|---|---|---|
| `@app/` | 程序安装根目录 | ❌ 只读 | `resources/` 或项目根 | 容器内应用目录 |
| `@data/` | 用户可写数据 | ✅ | 统一应用数据目录 | `PERO_DATA_DIR` |
| `@workshop/` | Steam Workshop | ❌ 只读，多订阅根 | 由 `steamApi.workshop.installInfo()` 发现 | ❌ 不可用 |
| `@temp/` | 运行时临时 | ✅ | 系统 temp | 系统 temp |

### 3.2 Workshop 路径传递

Electron 版启动后端进程时，通过环境变量注入：

```typescript
// electron/main/services/backendLauncher.ts
const workshopDir = getWorkshopInstallPath()  // 从 steamworks.js 获取
spawn(backendProcess, {
  env: {
    ...process.env,
    PERO_WORKSHOP_DIR: workshopDir ?? '',
  }
})
```

Docker 版不设此环境变量，`@workshop` 自然为空。

---

## 4. 资产联邦化注册表 — AssetRegistry

### 4.1 覆盖优先级

```
@data/custom/ (用户手动) > @workshop/ (用户订阅) > @app/ (官方内置)
```

行业惯例（Skyrim / Cities Skylines / Minecraft 等均采用此顺序）。

### 4.2 Asset ID 规范（继承自 v1）

反向域名格式：`<scope>.<type>.<name>`

| scope | 来源 | 示例 |
|---|---|---|
| `com.infos` | 官方内置 | `com.infos.persona.pero` |
| `com.workshop` | 创意工坊 | `com.workshop.model.123456` |
| `com.user` | 用户自定义 | `com.user.plugin.my_tool` |

### 4.3 资源读取职责

| 资源类型 | 读取者 | 原因 |
|---|---|---|
| 提示词 (prompts) | **后端** | LLM 调用在后端 |
| 人设 (agents) | **后端** | 人设注入 system prompt |
| 插件 schema | **后端** | Tool calling 在后端 |
| 3D 模型 (.pero) | **Electron** | Three.js 渲染在渲染进程 |
| UI 资产 (图片/音频) | **Electron** | 前端展示 |
| config.json | **后端写，前端只读** | 后端为权威源 |

### 4.4 提示词覆盖查找

```typescript
class PromptTemplateLoader {
  async load(templatePath: string): Promise<string> {
    // 1. 用户自定义优先
    const customPath = pathResolver.resolve(`@data/custom/prompts/${templatePath}`)
    if (await pathExists(customPath)) return readFile(customPath, 'utf-8')

    // 2. 回退到官方
    return readFile(pathResolver.resolve(`@app/prompts/${templatePath}`), 'utf-8')
  }
}
```

---

## 5. Steam Cloud 多设备同步

### 5.1 同步策略

**全量覆写**（Steam Cloud 配额 10GB，足够）。

### 5.2 同步内容分类

| 分类 | 内容 | 同步 | 说明 |
|---|---|---|---|
| **运行时数据** | SQLite DB、TriviumDB、日记、config | ✅ 同步 | 用户产生、随时变化 |
| **用户自定义资源** | agents、prompts、plugins、models | ✅ 同步 | 用户创建 |
| **Workshop 资源** | 创意工坊订阅内容 | ❌ 不同步 | Steam 本身管理 |
| **官方资源** | @app/ 内的内置资源 | ❌ 不同步 | 随安装包分发 |
| **临时/敏感** | WAL、gateway_token、模型缓存 | ❌ 排除 | 运行时临时或安全敏感 |

### 5.3 多设备冲突处理

采用**时间戳最新者胜**策略：

```typescript
interface SyncManifest {
  lastSyncTime: number
  deviceId: string
  version: number
  files: Record<string, {
    hash: string
    modifiedAt: number
    sizeBytes: number
  }>
}
```

同步流程：
1. **启动时**：下载云端 `sync_manifest.json`，与本地比较
2. **冲突检测**：同一文件双方都有修改 → 取 `modifiedAt` 更新的版本
3. **旧版本备份**：被覆盖的文件自动备份到 `@data/sync_backup/<timestamp>/`
4. **退出时**：上传变更文件 + 更新 `sync_manifest.json`

### 5.4 同步触发时机

| 事件 | 动作 |
|---|---|
| 应用启动 | 异步下载云端数据（不阻塞启动） |
| 应用退出 | 上传本地变更到云端 |
| 用户手动 | 前端 UI "立即同步" 按钮 |

---

## 6. 成就系统（预留）

仅定义接口，不实现具体触发逻辑：

```typescript
interface AchievementProvider {
  unlock(id: string): boolean
  isUnlocked(id: string): boolean
}

const ACHIEVEMENTS = {
  FIRST_ENCOUNTER: 'FIRST_ENCOUNTER',
  WEEKLY_COMPANION: 'WEEKLY_COMPANION',
  MONTHLY_BESTIE: 'MONTHLY_BESTIE',
  INTERACTION_MASTER: 'INTERACTION_MASTER',
} as const

// Electron: SteamAchievementProvider (基于 steamworks.js)
// Docker: NoOpAchievementProvider (空实现)
```

App ID 硬编码 `4457100`，无需提取为配置。

---

## 7. 打包后目录结构

```
infOS/                          (安装根目录 = @app/)
├── infOS.exe
├── steam_api64.dll
├── resources/
│   ├── app.asar                   ← 前端 + 主进程代码（只读）
│   ├── app.asar.unpacked/         ← native addon
│   ├── backend/
│   │   ├── dist/                  ← 后端 JS 编译产物（只读）
│   │   ├── prompts/               ← 官方提示词模板（只读）
│   │   └── agents/                ← 官方人设定义（只读）
│   └── assets/
│       └── 3d/                    ← 官方 3D 模型（只读）

%APPDATA%/infOS/                 (@data/ = 用户可写)
├── db/
│   ├── infos.db
│   └── social_storage.db
├── memory/
│   ├── memory.tdb
│   └── agents/
├── workspace/
│   ├── diary/
│   └── reports/
├── custom/                        ← 用户覆盖层
│   ├── prompts/
│   ├── agents/
│   ├── models/
│   └── plugins/
├── config.json
└── sync_manifest.json
```

---

*本文档由 Carola 整理，适用于 infOS Steam 集成与资产管理规范。*
