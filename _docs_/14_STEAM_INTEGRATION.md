# Steam 集成与资产联邦化规范

> **版本**：0.1.0（定稿） · **更新时间**：2026-04-18
> **适用范围**：`packages/desktop/src/services/steam*`、`packages/backend/src/core/`
> **依赖规范**：[07_DUAL_DEPLOYMENT](./07_DUAL_DEPLOYMENT.md)、[04_BACKEND_ARCHITECTURE](./04_BACKEND_ARCHITECTURE.md)
> **继承自**：PeroCore v1 `docs/STEAM_INTEGRATION_GUIDE.md`（资产元数据格式、Asset ID 规范）

---

## 1. 概述

PeroCore 同时支持 **Electron 桌面版（Steam 上架）** 和 **Docker 后端版**。Steam 相关功能（Workshop、Cloud Sync、成就、Overlay）仅存在于 Electron 版，Docker 版完全不涉及 Steam。

本规范覆盖：
- Steam 功能模块在 TS 重构中的架构设计
- 虚拟路径管理器（PathResolver）
- 资产联邦化注册表（AssetRegistry）
- 资源覆盖优先级与用户热修改
- Steam Cloud 多设备同步策略
- 配置权限模型

---

## 2. 模块职责划分 (D36)

### 2.1 Electron 专属 — Steam 服务

```
packages/desktop/src/services/
  ├── steamService.ts           ← steamworks.js 封装（初始化/用户/Overlay）
  ├── steamCloudSync.ts         ← Steam Cloud 同步实现
  ├── workshopService.ts        ← 创意工坊管理（订阅/下载/状态）
  └── achievementService.ts     ← 成就系统（仅预留接口）
```

- 全部通过 IPC 暴露给渲染进程
- Docker 版中这些 Service **完全不存在**
- `steamworks.js` native addon 延迟加载，先检查 `steam_api64.dll` 存在性（防 segfault）

### 2.2 后端共享 — 路径与资产核心

```
packages/backend/src/core/
  ├── pathResolver.ts           ← 虚拟路径管理（@app/@data/@workshop/@temp）
  └── assetRegistry.ts          ← 统一资产注册表
```

- 两种部署模式通用
- 数据源差异通过 PathResolver 的 roots 配置自然消化

### 2.3 职责边界

| 职责 | Electron | Docker |
|---|---|---|
| Steam 初始化 / Overlay | ✅ steamService | ❌ 不存在 |
| Workshop 管理 | ✅ workshopService | ❌ 不存在 |
| Cloud 同步 | ✅ steamCloudSync | ❌ 不存在 |
| 成就解锁 | ✅ achievementService (预留) | ❌ 不存在 |
| PathResolver | ✅ 含 @workshop | ✅ 无 @workshop |
| AssetRegistry | ✅ 扫描 3 层 | ✅ 扫描 2 层（无 workshop） |
| 资源读取 | 后端直接读 + 前端读 UI/3D | 后端直接读 |

---

## 3. 虚拟路径管理器 — PathResolver (D37)

### 3.1 逻辑前缀定义

| 前缀 | 含义 | 可写 | Electron 映射 | Docker 映射 |
|---|---|---|---|---|
| `@app/` | 程序安装根目录 | ❌ 只读 | `resources/` 或项目根 | 容器内应用目录 |
| `@data/` | 用户可写数据 | ✅ | `%APPDATA%/PeroCore/` | `PERO_DATA_DIR` 或 `./data` |
| `@workshop/` | Steam Workshop | ❌ 只读 | `steamapps/workshop/content/4457100/` | ❌ 不可用 |
| `@temp/` | 运行时临时 | ✅ | 系统 temp | 系统 temp |

### 3.2 实现要点

```typescript
class PathResolver {
  private roots: Map<string, string>

  constructor(env: RuntimeEnv) {
    this.roots = new Map([
      ['@app',      env.appRoot],
      ['@data',     env.dataDir],
      ['@temp',     env.tempDir],
      ['@workshop', env.workshopDir ?? ''],  // Docker 版为空
    ])
  }

  resolve(logicalPath: string): string { /* 前缀匹配 → 拼接 */ }

  /** 检查前缀是否可用（路径非空且存在） */
  isAvailable(prefix: string): boolean {
    const root = this.roots.get(prefix)
    return !!root && existsSync(root)
  }
}
```

### 3.3 Workshop 路径传递

Electron 版启动后端进程时，通过环境变量注入：

```typescript
// packages/desktop/src/services/backendLauncher.ts
const workshopDir = getWorkshopInstallPath()  // 从 steamworks.js 获取
spawn(backendProcess, {
  env: {
    ...process.env,
    PERO_WORKSHOP_DIR: workshopDir ?? '',  // 注入给后端
  }
})
```

Docker 版不设此环境变量，`@workshop` 自然为空。

---

## 4. 资产联邦化注册表 — AssetRegistry (D38)

### 4.1 覆盖优先级

```
@data/custom/  (用户手动) > @workshop/  (用户订阅) > @app/  (官方内置)
```

行业惯例（Skyrim/Cities Skylines/Minecraft 等均采用此顺序）：用户主动意图 > 订阅内容 > 系统默认。

### 4.2 实现要点

```typescript
class AssetRegistry {
  constructor(private pathResolver: PathResolver) {}

  async scanAll(): Promise<void> {
    // 按优先级从低到高扫描（后扫覆盖先扫）
    // 1. Official — 总是扫
    await this.scanDir(this.pathResolver.resolve('@app/agents'), 'official')
    await this.scanDir(this.pathResolver.resolve('@app/prompts'), 'official')

    // 2. Workshop — 有就扫，没有就跳
    if (this.pathResolver.isAvailable('@workshop')) {
      await this.scanDir(this.pathResolver.resolve('@workshop'), 'workshop')
    }

    // 3. Local — 总是扫
    await this.scanDir(this.pathResolver.resolve('@data/custom'), 'local')
  }
}
```

**不使用 DI 注入 Source**，直接条件判断，足够务实。

### 4.3 Asset ID 规范（继承自 v1）

反向域名格式：`<scope>.<type>.<name>`

| scope | 来源 | 示例 |
|---|---|---|
| `com.perocore` | 官方内置 | `com.perocore.persona.pero` |
| `com.workshop` | 创意工坊 | `com.workshop.model.123456` |
| `com.user` | 用户自定义 | `com.user.plugin.my_tool` |

### 4.4 元数据格式（继承自 v1）

新资产必须使用 `asset.json`，同时兼容旧版 `manifest.json` / `description.json` / `mod.toml`。

---

## 5. 资源读取与用户热修改 (D39)

### 5.1 资源读取职责

| 资源类型 | 读取者 | 原因 |
|---|---|---|
| 提示词 (prompts) | **后端** | LLM 调用在后端 |
| 人设 (agents) | **后端** | 人设注入 system prompt |
| 插件 schema | **后端** | Tool calling 在后端 |
| 记忆数据 (tdb/db) | **后端** | 记忆查询在后端 |
| 3D 模型 (.pero) | **Electron** | Three.js 渲染在渲染进程 |
| UI 资产 (图片/音频) | **Electron** | 前端展示 |
| config.json | **后端写，前端只读** | 后端为权威源 |

**后端通过 PathResolver 直接读取资源，不经过 Electron IPC。**

### 5.2 打包后目录结构

```
PeroCore/                          (安装根目录 = @app/)
├── PeroCore.exe
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

%APPDATA%/PeroCore/                 (@data/ = 用户可写)
├── db/
│   ├── perocore.db
│   └── social_storage.db
├── memory/
│   ├── memory.tdb
│   └── agents/
├── workspace/
│   ├── diary/
│   └── reports/
├── custom/                        ← 用户覆盖层
│   ├── prompts/                   ← 用户修改的提示词（覆盖 @app 同名）
│   ├── agents/                    ← 用户自建人设
│   ├── models/                    ← 用户导入的 3D 模型
│   └── plugins/                   ← 用户导入的插件
├── config.json
└── sync_manifest.json
```

### 5.3 提示词覆盖查找

```typescript
class PromptTemplateLoader {
  constructor(private pathResolver: PathResolver) {}

  async load(templatePath: string): Promise<string> {
    // 1. 用户自定义优先
    const customPath = this.pathResolver.resolve(
      `@data/custom/prompts/${templatePath}`
    )
    if (await pathExists(customPath)) {
      return readFile(customPath, 'utf-8')
    }

    // 2. 回退到官方
    const officialPath = this.pathResolver.resolve(
      `@app/prompts/${templatePath}`
    )
    return readFile(officialPath, 'utf-8')
  }
}
```

### 5.4 用户修改资源的工作流

后端提供 API，支持将官方模板导出到用户层进行修改：

```
POST /api/assets/export-to-custom
body: { assetId: "com.perocore.prompts.scorer_summary" }

→ 将 @app/prompts/scorer/summary.md
  复制到 @data/custom/prompts/scorer/summary.md
→ 返回可编辑的文件路径
```

前端可在"资源管理器"UI 中：
- 浏览所有资源（标记 official / custom / workshop）
- 官方资源 → "复制到自定义"
- 自定义资源 → "编辑" / "恢复为默认"（删除 custom 中的文件）

---

## 6. Steam Cloud 多设备同步 (D40)

### 6.1 同步策略

**全量覆写**（Steam Cloud 配额 10GB，足够）

### 6.2 同步内容分类

| 分类 | 内容 | 同步 | 说明 |
|---|---|---|---|
| **运行时数据** | SQLite DB、TriviumDB、日记、周报、config | ✅ 同步 | 用户产生、随时变化 |
| **用户自定义资源** | agents、prompts、plugins、models | ✅ 同步 | Blockbench 模型几 MB，不大 |
| **Workshop 资源** | 创意工坊订阅内容 | ❌ 不同步 | Steam 本身管理订阅和下载 |
| **官方资源** | @app/ 内的内置资源 | ❌ 不同步 | 随安装包分发 |
| **临时/敏感** | WAL、gateway_token、模型缓存 | ❌ 排除 | 运行时临时或安全敏感 |

### 6.3 多设备冲突处理

单用户多设备场景（家里/公司两台电脑），采用**时间戳最新者胜**策略：

```typescript
interface SyncManifest {
  lastSyncTime: number           // 最后同步时间戳
  deviceId: string               // 设备标识
  version: number                // 同步协议版本
  files: Record<string, {
    hash: string                 // 文件内容 hash
    modifiedAt: number           // 最后修改时间
    sizeBytes: number            // 文件大小
  }>
}
```

同步流程：
1. **启动时**：下载云端 `sync_manifest.json`，与本地比较
2. **冲突检测**：同一文件双方都有修改 → 取 `modifiedAt` 更新的版本
3. **旧版本备份**：被覆盖的文件自动备份到 `@data/sync_backup/<timestamp>/`
4. **退出时**：上传变更文件 + 更新 `sync_manifest.json`

### 6.4 同步触发时机

| 事件 | 动作 |
|---|---|
| 应用启动 | 异步下载云端数据（不阻塞启动） |
| 应用退出 | 上传本地变更到云端 |
| 用户手动 | 前端 UI "立即同步" 按钮 |

---

## 7. 成就系统（预留）

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

## 8. 迁移清单

从 PeroCore v1 迁移至 TS 重构时，按此清单执行：

- [ ] `path_resolver.py` → `pathResolver.ts`（逻辑前缀映射 + isAvailable）
- [ ] `asset_registry.py` → `assetRegistry.ts`（扫描 + 覆盖策略）
- [ ] `steam.ts` → `packages/desktop/src/services/steamService.ts`（纯 Electron 层）
- [ ] `cloudSync.ts` → `packages/desktop/src/services/steamCloudSync.ts`（加入 manifest + 冲突检测）
- [ ] `assets.ts` 中的 3D 扫描 → 整合到 `assetRegistry.ts`
- [ ] `asset://` 协议 → 保留在 Electron 层
- [ ] 验证 Docker 版不包含任何 Steam 依赖（零 Electron 渗透）
- [ ] 提示词覆盖查找逻辑接入 MDP 模板引擎

---

*本文档由 Carola 整理，适用于 PeroCore-TS Steam 集成与资产管理规范。*
