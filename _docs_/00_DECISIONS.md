# PeroCore-TS 重构决策记录

> **版本**：0.3.0（临时定稿） · **更新时间**：2026-04-18
> **状态**：部分待定，标记为 `[待定]` 的条目将在后续讨论中确认

---

## 已确认决策

| #   | 决策项                 | 结果                                                     | 备注                                                                                            |
| --- | ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1  | 业务状态码格式         | **字符串枚举** (`ResponseCode`)                          | `'OK'`, `'NOT_FOUND'`, `'LLM_ERROR'` 等                                                         |
| D2  | HTTP 状态码策略        | **映射到对应 4xx/5xx**                                   | 继承现有规范「禁止 200+error」；具体码表 `[待定]`                                               |
| D3  | 文件命名               | **camelCase**                                            | TS 文件 `memoryService.ts`；Vue 组件 PascalCase                                                 |
| D3b | 代码命名               | **TS 官方标准**                                          | 变量/函数 camelCase，类/接口 PascalCase，常量 UPPER_SNAKE_CASE                                  |
| D4  | 依赖注入模式           | **构造函数注入**                                         | 既然重构了就做到位                                                                              |
| D5  | Monorepo 结构          | **pnpm workspace**                                       | `packages/shared` + `packages/backend` + `packages/frontend` + `electron/`                      |
| D6  | 前后端类型共享         | **手动 `@perocore/shared` 包**                           | 共享类型、常量、工具函数                                                                        |
| D7  | 后端框架               | **Hono**                                                 | 轻量、原生 TS、最像 FastAPI                                                                     |
| D8  | ORM                    | **Drizzle**                                              | SQL-like API、SQLite 一流支持                                                                   |
| D9  | 前端状态管理           | **Pinia + Composable 混用**                              | Pinia 管全局状态，Composable 管组件逻辑                                                         |
| D10 | Gateway 协议           | **保留 Protobuf**                                        | 音频传输场景优势明显                                                                            |
| D11 | Repository 层          | **引入**                                                 | SQLite (Drizzle) + TriviumDB 双数据源，Repo 层隔离                                              |
| D12 | 运行时                 | **Electron 用 Node.js，Docker 版优先 Bun**               | 开发环境也可用 Bun                                                                              |
| D13 | 双形态部署             | **Electron 桌面版 + Docker 后端版**                      | 前后端 0 个 Electron 依赖，Transport 抽象层隔离                                                 |
| D14 | code 命名风格          | **UPPER_SNAKE_CASE**                                     | `OK`, `LLM_ERROR`, `VALIDATION_ERROR` 等                                                        |
| D15 | HTTP 状态码数量        | **15 个**（不含 204）                                    | 含 422/415 等精细码                                                                             |
| D16 | 分页默认值             | **page=1, pageSize=20, max=100**                         |                                                                                                 |
| D17 | 日志库                 | **consola**                                              | 最接近 loguru 的 TS 方案                                                                        |
| D18 | HTTP 客户端            | **原生 fetch**，不引入 axios                             | ApiClient 统一封装                                                                              |
| D19 | i18n                   | **轻度预留**，不引入 vue-i18n                            | message 集中注册表，前端关键文本用常量                                                          |
| D20 | message 语言           | **中文，面向用户**                                       | 技术细节放 data 或日志                                                                          |
| D21 | Rust 模块管理          | **pnpm workspace + `packages/native/*`**                 | render-core直接搬，nit-runtime PyO3→N-API，auditor保留WASM，vision_core丢弃                     |
| D22 | 扩展系统架构           | **统一 ExtensionManager**（合并 Plugin+Mod+外部插件）    | 3 种类型：Tool / Hook / Service                                                                 |
| D23 | Service 扩展通信       | **v1: stdio JSON-RPC**，预留 HTTP/Zenoh 接口             | 与 MCP 协议一致                                                                                 |
| D24 | 用户扩展格式           | **TS + JS 双支持**                                       | Bun/tsx 直接跑 TS，JS 开箱即用                                                                  |
| D25 | 扩展权限               | **插件自治 + 可选全局底线**                              | 拓展自行声明所需权限                                                                            |
| D26 | 热重载                 | **支持**，开发模式自动/生产手动                          | 通过 API 或 Dashboard 触发                                                                      |
| D27 | Embedding/Reranker/ASR | **外部 API 服务为主**                                    | TS 代码与推理无关；Rust 模块可做纯 CPU 推理；用户可自部署 Ollama 等                             |
| D28 | 记忆系统拆分           | **按领域能力拆分 7 大子模块**                            | 见 `10_MEMORY_SYSTEM.md`                                                                        |
| D29 | 跨平台规范             | **路径禁止硬编码 + `@platform` 标注**                    | 统一路径工厂 + 平台策略模式，见 `11_CROSS_PLATFORM.md`                                          |
| D30 | 前端性能优化           | **keep-alive 白名单 + 虚拟滚动 + 流式增量渲染**          | 见 `12_FRONTEND_PERFORMANCE.md`                                                                 |
| D31 | 单元测试规范           | **Vitest + 模块同步测试 + 覆盖率红线**                   | 每开发一个模块必须同步编写对应测试，见 `13_TESTING_STANDARDS.md`                                |
| D32 | Gateway 端口           | **耦合同端口（:9120）**                                  | Hono WS 升级，部署最简，v1 已验证，单用户无需隔离                                               |
| D33 | Gateway 语言           | **TypeScript (Hono)**                                    | 消息路由是 IO-bound、需深度集成 Service 层、一套技术栈易维护                                    |
| D34 | 鉴权系统               | **单用户 Token/密码 + JWT 7天**                          | Docker 版必须鉴权，Electron 版跳过；环境变量或首次自动生成 Token，见 `07_DUAL_DEPLOYMENT.md` §8 |
| D35 | 记忆 Token 优化        | **⏳ 暂定：攒批 Scorer + 日记图谱一体化 + 人设注入修复** | 方向已确认，具体实现待定，见 `10_MEMORY_SYSTEM.md` §10-13                                       |
| D36 | Steam 模块边界         | **Electron 专属**                                        | steamService/cloudSync/workshop/achievement 全在 desktop 包，Docker 零 Steam 依赖               |
| D37 | 虚拟路径管理           | **PathResolver 四前缀**                                  | @app/@data/@workshop/@temp；@workshop 通过环境变量注入，Docker 为空                             |
| D38 | 资源覆盖优先级         | **custom > workshop > official**                         | 行业标准（Skyrim/Cities Skylines 等），AssetRegistry 不用 DI，条件扫描                          |
| D39 | 资源读取职责           | **后端直接读，不走 IPC**                                 | 后端通过 PathResolver 读提示词/人设/插件等；前端读 3D/UI；config 后端写前端只读                 |
| D40 | Cloud 同步策略         | **全量覆写 + 时间戳冲突解决**                            | 10GB 配额充足；运行时数据+用户自定义全同步；Workshop 走 Steam 自身同步                          |
| D41 | CI/CD                  | **GitHub Actions**                                       | lint → test → build → Electron 打包，见 `15_DEVOPS_OPERATIONS.md` §1                            |
| D42 | 数据库迁移             | **Drizzle Kit**                                          | generate + migrate，向前兼容，TriviumDB 无需迁移（二进制版本号自带兼容）                        |
| D43 | 版本发布策略           | **SemVer + changesets**                                  | GitHub Release + Steam Depot + Docker Hub 三渠道                                                |
| D44 | 代码搜索工具           | **换用 ripgrep 替代自研 CodeSearcher**                   | CodeSearcher 是简化版 rg，同样底层依赖，功能弱且徒增维护负担；rg 预编译二进制分发               |
| D45 | AuraVision             | **暂不迁移，功能冻结**                                   | 384 维模型不兼容重构后架构；相关后端/前端/模型代码全部不做迁移，待后续重新设计                  |
| D46 | 多目标构建             | **Edition + Platform 双轴解耦**                          | 6 变体；IS_STEAM 门控 + electron-builder 配置矩阵，见 `07_DUAL_DEPLOYMENT.md` §9               |
| D47 | 自动更新               | **Steam 自带 / electron-updater / docker pull**          | 标准版+便携版用 electron-updater + GitHub Releases                                             |
| D48 | 跨设备同步             | **Electron 远程直连 Docker 后端**                        | 零同步逻辑；无离线场景（依赖外部 API）；切换 base URL 即可，见 `07_DUAL_DEPLOYMENT.md` §10    |
| D49 | PEDSA v2               | **minGRU + Leiden + 检索反馈闭环**                       | 上下文感知的认知检索引擎，见 `10_MEMORY_SYSTEM.md` §14                                 |
| D50 | 三层记忆隔离           | **日记层(共享中转) + 事件记忆层(Store隔离) + 对话层**     | 日记作为跨模式安全中转，Store 级物理隔离，见 `10_MEMORY_SYSTEM.md` §15                  |
| D51 | Capability Gate        | **声明式能力门控矩阵 + Skill 渐进式加载**               | 取代 if-else 工具过滤，YAML 矩阵单一权威，见 `16_CAPABILITY_GATE.md`                     |
| D52 | 模式体系               | **桌面模式家族 + 群聊模式 + 社交模式**                  | 桌面模式包含 4 个 Profile: default / lightweight / companion / work。群聊独立。社交走 Adapter Extension |
| D53 | 群聊据点系统           | **保留 Stronghold/Facility/Room 概念**                  | RP 沉浸感；Room 关联 GroupChatRoom；调度器 + 视角转换；Butler 管家续作                      |
| D54 | 角色启用机制           | **运行时热启用/禁用**                                    | 不再需要 LauncherView 预选；.tdb 懒加载；配置文件可设 `enabled: true` 默认列表              |
| D55 | 社交模式粒度           | **角色级独立启用**                                       | 每个 Agent 可绑定独立社交账号 + 独立 NapCat 进程 + 独立 social.tdb                          |
| D56 | 报告统一               | **砍掉周报，所有报告统一为 DiaryEngine**                 | 社交日报/工作日志/桌宠日记 → 统一日记条目写入 shared/diary.tdb (Layer 3)                     |
| D57 | NIT v3                 | **Agent DSL 编排引擎，工具调用走 FC + ToolRegistry**     | 纯 TS 实现，安全沙箱，支持 if/for/parallel/try，与 MCP/Skill 无缝融合，见 `18_NIT_V3.md`    |

---

## 待定事项

以下将在后续讨论中逐一确认：

- [x] ~~D2 具体 HTTP 状态码映射表~~ → 15 个 HTTP 码 + 38 个 code，已定稿
- [x] ~~D2 `ResponseCode` 枚举的完整成员列表~~ → 38 个 code，已定稿
- [x] ~~D2 `message` 字段规范~~ → 中文面向用户，CODE_MESSAGES 注册表
- [x] ~~D2 `data` 字段在错误时的结构~~ → 按 code 类型定义，已定稿
- [x] ~~API 分页响应的具体格式~~ → page=1, pageSize=20, max=100
- [x] ~~日志库选型~~ → consola
- [x] ~~Protobuf Gateway 消息类型更新~~ → D32/D33 确认：TS + Hono 同端口 WS，Protobuf 编解码保留
- [x] ~~扩展市场 / Workshop 分发机制~~ → D38/D40 确认：AssetRegistry 条件扫描 + Steam Workshop + Cloud 同步
- [ ] SSE event 清单细化（实现聊天模块时完善）
- [ ] 进程管理方案（PM2 配置细节）
- [ ] `nit_rust_runtime` PyO3 → N-API 改造细节
- [ ] Hook 事件完整清单（需深入代码逻辑）
- [x] ~~MDP 渲染引擎选型确认~~ → 自研 Mustache 变体 (MdpEngine)
- [ ] 记忆系统 Hook 点定义（`memory:beforeCreate` 等）
- [ ] D35 Scorer 攒批阈值与余弦去重参数（见 `10_MEMORY_SYSTEM.md` §4）
- [ ] D35 日记系统触发时机与图谱存储方案
- [ ] D35 后台任务精简人设注入的内容边界
- [ ] D40 Cloud 同步 manifest 协议版本与迁移策略
- [ ] D53 群聊调度器算法细节（性格权重 + 话题匹配）
- [ ] D55 社交进程池管理方案（多 NapCat 实例资源控制）

---

## 继承自现有规范

以下规范从 PeroCore v1 `docs/` 直接继承，不做破坏性修改（但这些文档只有参考意义。具体实现规范一定要以 PeroCore-TS_docs\_ 目录下的文档为准！）：
| 来源文档 | 继承内容 |
|---|---|
| `BACKEND_API_STYLE_GUIDE.md` | 路由组织、路径命名、HTTP 方法语义、请求体建模、领域边界 |
| `COMMENT_TRANSLATION_STANDARDS.md` | 注释中文优先、术语对照表 |
| `PIXEL_UI_UPGRADE_PLAN.md` | 像素风 UI 视觉规范 |
| `TRIVIUMDB_MAINTENANCE_CHECKLIST.md` | TriviumDB 回归校验思路（API 将更新为 TS 版） |
| `STEAM_INTEGRATION_GUIDE.md` | Steam 集成方案（v2 扩展见 `14_STEAM_INTEGRATION.md`） |

---

_本文档由 Carola 整理，适用于 PeroCore-TS 重构规范体系。_
