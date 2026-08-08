# Workspace 模型

> Principal Workspace 是主 Agent 的个人文件空间，独立于应用工作区和 PeroCore 数据目录。

---

## 1. 定义

Principal Workspace 是 PrincipalAgent 的一个一等资源，负责：

- 主 Agent 的个人文件管理
- 日记、笔记、草稿、计划的存储
- 文件操作的资源级权限边界

Workspace **不负责**：
- 应用项目文件（那是未来 Application Workspace 的事）
- 数据库和配置（那是 Runtime Data Space 的事）
- 上下文编译（那是 Context Runtime 的事）

---

## 2. 三种 Workspace 的区别

| 类型 | 所属 | 目的 | 权限主体 |
|---|---|---|---|
| **Principal Workspace** | 主 Agent | 日常事务、日记、草稿 | 主 Agent |
| **Application Workspace** | 应用（暂不实现） | 项目文件、代码、产物 | 应用实例/次 Agent |
| **Runtime Data Space** | PeroCore Runtime | DB、配置、向量索引 | 系统服务 |

另外存在 `pnpm workspace`，它只属于构建系统，与运行时无关。

---

## 3. Principal Workspace 结构

```text
@data/agents/{agentId}/workspace/
├─ inbox/          ← 待处理事项
├─ notes/          ← 日常笔记
├─ diary/          ← 日记
├─ drafts/         ← 草稿
├─ plans/          ← 计划
├─ documents/      ← 文档
├─ attachments/    ← 附件
├─ exports/        ← 导出文件
└─ archive/        ← 归档
```

---

## 4. 领域模型

```text
PrincipalWorkspace
├─ agentId: string                ← 归属主 Agent
├─ rootPath: string               ← 工作区根目录
├─ quota: WorkspaceQuota
│  ├─ maxTotalSize: number        ← 总容量上限（字节）
│  ├─ maxFileSize: number         ← 单文件上限
│  └─ maxFileCount: number        ← 文件数量上限
├─ policies: WorkspacePolicy[]
│  ├─ allowedExtensions: string[] ← 允许的文件类型
│  ├─ deniedPaths: string[]       ← 禁止的路径模式
│  ├─ allowSymlinks: boolean      ← 是否允许软链接
│  └─ allowExecutable: boolean    ← 是否允许可执行文件
└─ createdAt: string
```

---

## 5. 文件安全边界

### 5.1 Containment 检查

所有文件操作必须经过路径规范化后的 containment 检查：

```text
1. realpath(target) 解析软链接和 junction
2. path.relative(rootPath, resolvedTarget)
3. 如果结果以 '..' 开头或为绝对路径 → 拒绝
4. 检查盘符和 UNC 路径
5. 检查文件扩展名是否在 allowedExtensions
```

### 5.2 当前问题

现有文件工具接受任意绝对路径，无 containment 检查：

- `write_file` 可对任意路径创建父目录并写入
- `terminal_execute` 默认在用户主目录运行任意命令
- `search_files` 和 `code_search` 存在命令拼接风险

新架构要求所有文件工具默认 scope 限制在 Principal Workspace。

---

## 6. 与现有代码的对应

| 现有 | 新架构 | 处理方式 |
|---|---|---|
| 提示词虚设的 workspace 工具 | 真实实现 | 新建 workspace 文件工具 |
| `write_workspace_file` 等 | 真实实现 | 新建 handler 和 manifest |
| `PathResolver` 无 `@principal` | 新增 | 增加 `@principal` 前缀 |
| 通用 `read_file/write_file` | 加 scope 边界 | 默认限制在 workspace |
| `terminal_execute` 无限制 | 加 cwd 限制 | 默认 cwd 为 workspace |
| Agent 创建不建 workspace | 自动创建 | 创建 Agent 时创建 workspace 目录 |
| 无配额管理 | 新增 | 实现 WorkspaceQuota |
| 无 containment 检查 | 新增 | 实现 realpath + relative 检查 |

---

## 7. 第一版简化

```text
1. 创建 Agent 时自动创建 workspace 目录
2. PathResolver 增加 @principal 前缀
3. 文件工具加 containment 检查
4. 暂不实现配额
5. 暂不实现软链接和可执行文件策略
```
