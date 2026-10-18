# 测试逐文件审查与清理

日期：2026-10-11

## 范围

上一轮只处理了已定位的例子和模式扫描命中项，没有读完所有测试；本轮补齐逐文件源码审阅。

- 本轮开始时清单共 **186 个测试文件、33,241 行**，全部已读。包含同位 __tests__、各包测试和 Electron 测试。
- 本轮删除 1 个文件，当前剩余 **185 个**。已再次枚举 test/spec 文件，清单没有遗漏；tsconfig.test.json 是配置文件，不计入测试文件。
- 每个文件的结论见下表。审查覆盖用例主体、Mock边界、断言依据、失败路径与清理行为；静态类型检查覆盖全部剩余测试。

| 范围 | 本轮清单文件数 |
| --- | ---: |
| Electron | 6 |
| Arca前端 | 4 |
| Arca应用 | 4 |
| 后端 | 129 |
| document-engine | 5 |
| 前端 | 32 |
| node-host | 2 |
| shared | 4 |

## 本轮补充处理的主要问题

1. 删除不调用产品实现的常量断言、以测试自写过滤器冒充产品策略的用例，以及给已删除依赖注入失败却从未触发失败的用例。
2. 恢复路由真实错误处理中间件。非法输入按400、禁止操作按403、资源不存在按404核对，删除将框架默认500反写成预期的做法。
3. 默认出生、社交消息与Outbox原子性、心流清空修订使用真实SQLite验证。后台任务仓库夹具按ID查找、按期望状态迁移。
4. NIT并发与据点串行使用阻塞依赖验证；高级工具检查每个禁止项，并继续到第三轮验证展开后的持续可用性。
5. Vue和Pinia使用真实响应式与宿主生命周期；补定时器、监听器、环境变量、平台属性及子进程清理。
6. 记忆容量通过公开模型配置推导预算，验证Pair完整、分批与内容覆盖；退避和租约按持久化公布的时点推进。
7. SSE夹具在UTF-8字符和事件边界分片，验证正文、思考、工具身份及参数。移除默认Token预算、生成ID时间戳和回退型号锁；HTTP请求体按JSON数据核对，不锁键序。
8. 删除颜色/样式类目录、默认文案和无业务依据的展示长度锁。普通单测不再使用本机耗时做性能门禁，批量输入仍验证内容正确性。

固定值并非一律删除：HTTP状态、协议字段、Windows键码、显式测试配置、需求规定的结果上限与真实输入内容仍然保留。Mock外部依赖本身也不构成删除理由。

## 覆盖率门禁

- vitest.config.ts 已删除 coverage.thresholds，手动覆盖率报告仍可用。
- .github/workflows/ci.yml 已删除重复覆盖率运行及Codecov上传；CI仍运行一次功能测试。
- 开发规范和DevOps文档已同步，不再要求最低覆盖率百分比。

## 验证

- 后端：tsc --noEmit，全部后端测试及其源码依赖，通过。
- 前端与Arca前端：vue-tsc --noEmit，全部对应测试及Vue组件依赖，通过。
- Electron：tsc --noEmit，包含项目既有环境声明，通过。
- 文档引擎、共享协议、Arca应用与Node Host：tsc --noEmit，通过。
- 所有剩余测试的TypeScript语法解析通过；本轮涉及的测试文件Git差异空白检查通过。
- **未运行测试套件、构建、打包或任何生成构建产物的编译。** 静态检查通过不代表运行时测试已通过。

全工作树差异检查另有既存Wiki空白问题，本次未修改该部分。

## 上一轮已经删除的文件

- packages/backend/tests/unit/architectureStandards.test.ts：源码正则扫描，相关依赖边界迁移为ESLint规则。
- packages/apps/arca/client/tests/designTokens.test.ts：CSS/设计Token字符串目录锁。
- packages/frontend/tests/unit/toolAtelier.test.ts：视觉映射目录锁。
- 知识库的Mock伪集成用例：改由knowledgeRuntime中真实工具注册链路覆盖。

这些历史删除不重复计入本轮186项清单。

## 逐文件结论

“保留”指用例有业务或契约价值，不代表当前覆盖完备或不存在未来缺陷；部分保留文件同步修正了过时接口夹具。

| 序号 | 文件 | 结论 |
| ---: | --- | --- |
| 1 | electron/main/services/applicationLauncher.test.ts | 保留：应用精确匹配、歧义拒绝和窗口复用契约 |
| 2 | electron/main/services/desktopCoordinates.test.ts | 保留：截图坐标、DPI、负原点和越界保护 |
| 3 | electron/main/services/napcat.test.ts | 保留：真实配置文件初始化、幂等及其他应用连接保护 |
| 4 | electron/main/services/updater.test.ts | 保留：版本优先级和 hotfix 兼容 |
| 5 | electron/main/windows/manager.test.ts | 改写：断言窗口透明性，移除固定主题色 |
| 6 | electron/main/windows/windowState.test.ts | 保留：原生最大化与还原 |
| 7 | packages/apps/arca/client/tests/confirmDialog.test.ts | 改写：验证 ARIA 引用而非固定 ID；保留危险操作交互 |
| 8 | packages/apps/arca/client/tests/discovery.test.ts | 保留：Endpoint 发现优先级 |
| 9 | packages/apps/arca/client/tests/draftRecovery.test.ts | 保留：本地 Draft 恢复及删除 |
| 10 | packages/apps/arca/client/tests/visualSystemV2.test.ts | 改写：隔离 localStorage 和组件生命周期；保留编辑、IME、语义 Diff |
| 11 | packages/apps/arca/tests/applicationHost.test.ts | 改写：Outbox 用多个事件验证顺序及失败停止；保留真实 Host 生命周期 |
| 12 | packages/apps/arca/tests/documentCollaborationLifecycle.test.ts | 保留：真实 Session Principal、修订、协作与重启；改写无意义 generation>0 断言 |
| 13 | packages/apps/arca/tests/modelAuthority.test.ts | 保留：凭据不明文落盘、空凭据更新和删除联动 |
| 14 | packages/apps/arca/tests/processFederation.test.ts | 改写：子进程已退出时清理会永久等待，修复退出监听时序；保留真实跨进程协议 |
| 15 | packages/backend/tests/integration/deploymentAcceptance.test.ts | 删除：不调用项目实现，仅断言测试自己构造的常量数组 |
| 16 | packages/backend/tests/integration/observability.test.ts | 保留：真实 createApp、中间件、trace 与指标观测 |
| 17 | packages/backend/tests/unit/applications/applicationCapabilityClient.test.ts | 保留：能力 Principal 收窄、关闭和可选依赖 |
| 18 | packages/backend/tests/unit/applications/applicationIntegrationService.test.ts | 保留：Manifest 授权、声明不一致与类型错配 |
| 19 | packages/backend/tests/unit/applications/applicationRealm.test.ts | 保留：Realm 隔离、生命周期与工具冲突 |
| 20 | packages/backend/tests/unit/applications/applicationResourceAccessService.test.ts | 保留：真实 Capability Handle 的 Grant 拒绝和放行 |
| 21 | packages/backend/tests/unit/applications/applicationTaskPort.test.ts | 保留：任务移交、幂等与因果身份 |
| 22 | packages/backend/tests/unit/applications/socialBundleTransport.test.ts | 保留：独立 bundle 与真实 WebSocket 回归 |
| 23 | packages/backend/tests/unit/applications/socialWsBridge.test.ts | 保留：重连旧 close 不清新连接 |
| 24 | packages/backend/tests/unit/applications/sqliteSocialStoragePort.test.ts | 改写：增加 SQLite/Outbox 写入失败回滚验证，现有成功路径不能证明原子性 |
| 25 | packages/backend/tests/unit/capabilities/arcaApplicationController.test.ts | 改写：去掉固定缺失产物文案；保留外部进程所有权保护 |
| 26 | packages/backend/tests/unit/capabilities/arcaCapabilityRuntime.test.ts | 改写：按可观察状态等待，移除 setTimeout(0) 时序猜测 |
| 27 | packages/backend/tests/unit/capabilities/browserToolRuntime.test.ts | 改写：按工具注册状态等待，移除 setTimeout(0) 时序猜测 |
| 28 | packages/backend/tests/unit/capabilities/capabilityGate.test.ts | 改写：提示描述按工具内容断言，不锁拼接换行格式；权限测试保留 |
| 29 | packages/backend/tests/unit/capabilities/desktopCapabilityDefinitions.test.ts | 保留：远端 Offer 合同对 applicationLaunch 的兼容 |
| 30 | packages/backend/tests/unit/capabilities/skillLoader.test.ts | 保留：真实 Skill 文件解析、越界、缓存及用户目录写入 |
| 31 | packages/backend/tests/unit/core/collectDaemonDeps.test.ts | 保留：发行依赖可选性及重复依赖归并 |
| 32 | packages/backend/tests/unit/core/coreUtilities.test.ts | 改写：删除固定清理日志文案；清理误导性 Trivium Mock/重复 Store 测试，统计需使用非空真实数据 |
| 33 | packages/backend/tests/unit/core/databaseConnection.test.ts | 保留：真实标准迁移链、旧数据保留和幂等升级 |
| 34 | packages/backend/tests/unit/kernel/backgroundTaskProjection.test.ts | 改写：验证输入问题、进度和任务状态内容，不能只检查节点种类 |
| 35 | packages/backend/tests/unit/kernel/browserInteractionWorld.test.ts | 保留：浏览器注入阻断、Handle、执行效果和敏感输入 |
| 36 | packages/backend/tests/unit/kernel/browserToolAbi.test.ts | 改写：禁止工具列表逐个断言，当前 not.arrayContaining 只能拦全部同时泄漏 |
| 37 | packages/backend/tests/unit/kernel/capabilityDirectory.test.ts | 保留：Bound Port 身份、越权、离线与 Deadline |
| 38 | packages/backend/tests/unit/kernel/conversationSurface.test.ts | 保留：流式帧序号、正文限长、工具身份及历史投影 |
| 39 | packages/backend/tests/unit/kernel/conversationSurfaceProjector.test.ts | 改写：验证独立稳定节点，不锁拼接格式 |
| 40 | packages/backend/tests/unit/kernel/crossDomainSurfaceProjection.test.ts | 改写：投影应包含真实联系人和连接状态，不只检查标题/ID |
| 41 | packages/backend/tests/unit/kernel/dataDirectoryGuard.test.ts | 保留：物理路径别名拒绝和目录解析 |
| 42 | packages/backend/tests/unit/kernel/inputSeatOwnership.test.ts | 保留：Input Seat 唯一性、身份限制和断线撤销 |
| 43 | packages/backend/tests/unit/kernel/kernelFoundation.test.ts | 保留：逆序释放、收窄权限和对象归属 |
| 44 | packages/backend/tests/unit/kernel/kernelOutbox.test.ts | 改写：清理保护用例补死信数据；其余真实事务/发布重试验证保留 |
| 45 | packages/backend/tests/unit/kernel/kernelProtocol.test.ts | 改写：补 Payload 上限边界，避免标题声称覆盖却未验证 |
| 46 | packages/backend/tests/unit/kernel/kernelScheduler.test.ts | 改写：移除固定睡眠，按状态等待；预算用例补 Token/Tool/I/O 真正超额 |
| 47 | packages/backend/tests/unit/kernel/nodeFoundation.test.ts | 保留：Node Identity、Session、Authority、Placement 及 fail-closed |
| 48 | packages/backend/tests/unit/kernel/nodeHost.test.ts | 保留：远端 Bridge 端到端参数与本地误注册拒绝 |
| 49 | packages/backend/tests/unit/kernel/observerService.test.ts | 改写：去除 workload 标定常数和解释文案锁；保留去重、隔离及双重 Policy |
| 50 | packages/backend/tests/unit/kernel/packageInstaller.test.ts | 改写：授权撤销用可观察状态等待；签名、权限和版本安全用例保留 |
| 51 | packages/backend/tests/unit/kernel/packageManifest.test.ts | 保留：历史 Manifest 投影和必需能力归并 |
| 52 | packages/backend/tests/unit/kernel/packageRuntime.test.ts | 保留：逆序释放、必需依赖及原子回滚 |
| 53 | packages/backend/tests/unit/kernel/performanceBaseline.test.ts | 保留：确定性统计规格和样本校验 |
| 54 | packages/backend/tests/unit/kernel/resourceFoundation.test.ts | 保留：文件防篡改、生命周期、Transfer 状态机和凭据范围 |
| 55 | packages/backend/tests/unit/kernel/resourcePersistence.test.ts | 保留：真实 SQLite 资源元数据往返 |
| 56 | packages/backend/tests/unit/kernel/runtimeAdapter.test.ts | 保留：Runtime Generation、旧 Handle、取消与 Deadline |
| 57 | packages/backend/tests/unit/kernel/strongholdProjection.test.ts | 改写：核对正文/成员投影内容，不能只匹配 Shell ID |
| 58 | packages/backend/tests/unit/kernel/webObjectStore.test.ts | 保留：页面导航后旧句柄失效 |
| 59 | packages/backend/tests/unit/middleware/auth.test.ts | 保留：真实 Hono 鉴权；移除固定错误文案断言 |
| 60 | packages/backend/tests/unit/migrations/migrationManager.test.ts | 保留：迁移排序、Journal 失败恢复和幂等 |
| 61 | packages/backend/tests/unit/multiNode/singleAuthorityAcceptance.test.ts | 改写：第二用例没有 Seat 迁移，收窄标题到实际目标选择与离线保护；真实协议验证保留 |
| 62 | packages/backend/tests/unit/nit/lexer.test.ts | 保留：词法 Token、转义、注释与错误位置 |
| 63 | packages/backend/tests/unit/nit/parser.test.ts | 保留：AST 语法规格、优先级及非法输入 |
| 64 | packages/backend/tests/unit/nit/runtime.test.ts | 改写：并行测试使用阻塞工具证明真正并发；工具上限校验实际调用次数 |
| 65 | packages/backend/tests/unit/nit/spokenReplyFilter.test.ts | 保留：口语/正文分离、标签分片和 TTS 符号过滤 |
| 66 | packages/backend/tests/unit/nit/streamFilter.test.ts | 改写：别名思考块验证采集到完整内容，不能只检查事件类型 |
| 67 | packages/backend/tests/unit/projections/conversationInteractiveProjection.test.ts | 改写：求助/审批投影验证具体问题和操作，保留缓存失效场景 |
| 68 | packages/backend/tests/unit/repositories/facts.repo.test.ts | 保留：真实 SQLite/TDB 故障恢复、幂等、撤回与取代关系 |
| 69 | packages/backend/tests/unit/repositories/fileSnapshot.repo.test.ts | 保留：撤回级联范围、中断回复与首次文件前态 |
| 70 | packages/backend/tests/unit/repositories/flowState.repo.test.ts | 保留：对话检查点回退与同轮多次更新 |
| 71 | packages/backend/tests/unit/repositories/storeRegistry.test.ts | 保留：真实 Store 维度、节点统计和全部旁路文件清理 |
| 72 | packages/backend/tests/unit/repositories/thread.repo.test.ts | 保留：真实 SQL 会话用途隔离、跨角色防串及历史游标 |
| 73 | packages/backend/tests/unit/routers/apiContract.test.ts | 改写：默认消息对齐集中 Code 消息契约，避免锁文案 |
| 74 | packages/backend/tests/unit/routers/apiRoutersBatch.test.ts | 改写：CRUD 校验实际删除/启停/重载；去成功文案与时间展示锁；语音非法输入经真实 errorHandler 返回400，并验证实际音频字节 |
| 75 | packages/backend/tests/unit/routers/arcaUiRouter.test.ts | 改写：目录穿越必须实际创建 UI 外文件并使用不被 URL 规范化吞掉的编码路径 |
| 76 | packages/backend/tests/unit/routers/backgroundTaskRouter.test.ts | 保留：缺少 send_to_chat 目标必须拒绝派发 |
| 77 | packages/backend/tests/unit/routers/chatRouter.test.ts | 改写：缺少 errorHandler 导致把400/404写成500；Mock 服务使用真实 AppError；移除固定文案并修正过度宣称的编排标题 |
| 78 | packages/backend/tests/unit/routers/configHealthRouters.test.ts | 改写：移除响应信封中的默认文案锁；保留维度拒绝、配置热更新、覆盖策略与日志访问测试 |
| 79 | packages/backend/tests/unit/routers/resetRouter.test.ts | 保留：危险重置确认短语、拒绝无副作用及知识清除范围 |
| 80 | packages/backend/tests/unit/routers/routerPromptBatch.test.ts | 改写：移除响应信封中的默认文案锁；保留 nullable 模型字段和系统聚合契约 |
| 81 | packages/backend/tests/unit/routers/strongholdRouter.test.ts | 改写：真实 errorHandler 恢复400/403/404；默认出生改真实SQLite；双成员验证@all，阻塞首个回复证明mention串行；移除默认上下文窗口锁 |
| 82 | packages/backend/tests/unit/routers/terminalRouter.test.ts | 改写：按业务错误码/状态核对身份拒绝，去除固定原因文案 |
| 83 | packages/backend/tests/unit/services/agent/agentManager.test.ts | 保留：真实角色文件、公开字段白名单、导出边界与旧副本修复 |
| 84 | packages/backend/tests/unit/services/agent/agentService.test.ts | 改写：删除旧持久化/Scorer及triggerMemoryPipeline空Mock用例；流式测试只验证实际正文增量；移除旧依赖并逐项恢复环境变量 |
| 85 | packages/backend/tests/unit/services/agent/petStateService.test.ts | 保留：真实 SQL 临时台词去重和过期丢弃 |
| 86 | packages/backend/tests/unit/services/agent/reactLoop.test.ts | 改写：状态按语义核对；取消由生产者状态变化触发；高级工具逐个禁止并验证第三轮仍可用；finish拒绝后提供新的自然回复流 |
| 87 | packages/backend/tests/unit/services/agent/taskManager.test.ts | 改写：去掉状态广播固定文案；保留消费即清除指令、暂停和显式超时 |
| 88 | packages/backend/tests/unit/services/agent/toolExecutor.test.ts | 改写：审批附言和截断不锁排版；逐次审批标题按实际场景修正；保留Realm、通道、路径、真实Approval状态及副作用保护 |
| 89 | packages/backend/tests/unit/services/attachmentService.test.ts | 保留：附件20MB边界、媒体拒绝与 Thread 绑定 |
| 90 | packages/backend/tests/unit/services/butlerService.test.ts | 改写：实际LLM输入不得含数据库自定义persona；未知维护动作逐个校验无写入；删除客厅校验无删除副作用 |
| 91 | packages/backend/tests/unit/services/companionScheduler.test.ts | 保留：有界陪伴调度、防排队及失败冷却 |
| 92 | packages/backend/tests/unit/services/context/contextRegionRuntime.test.ts | 改写：Generation 缓存用正文变化证明失效，移除强制保留两份缓存的内部数量锁；优先级标题按实际覆盖收窄 |
| 93 | packages/backend/tests/unit/services/context/toolContextService.test.ts | 改写：来源退化移除固定解释句；回滚/窗口退出必须仍保留来源，不让空结果通过否定断言 |
| 94 | packages/backend/tests/unit/services/conversation/conversationTurnService.test.ts | 改写：删除对已移除 appendAutomaticWorkContext 的空 Mock 断言；核对来源真正写入 assistant 元数据；提示词预期独立快照；其余持久化、草稿顺序与角色归属保留 |
| 95 | packages/backend/tests/unit/services/distributedSyncService.test.ts | 保留：真实加密快照文件范围、机器身份保留与回滚 |
| 96 | packages/backend/tests/unit/services/embedding/embeddingService.test.ts | 改写：降级重排核对顺序和有限单调分数，删除固定0.99评分及重复getter转发；保留API索引还原、429及重排上限 |
| 97 | packages/backend/tests/unit/services/execution/agentInputService.test.ts | 改写：永久等待需跨时间边界验证；保留必答/取消；错误按code而非固定句 |
| 98 | packages/backend/tests/unit/services/execution/approvalPersistence.test.ts | 改写：重启拒绝只校验安全状态与审计，去掉固定拒绝文案；真实SQLite保留 |
| 99 | packages/backend/tests/unit/services/execution/policyApproval.test.ts | 改写：allow_once先验证参数不匹配不消费；永久等待移除25ms伪验证；固定系统解释句去文案锁 |
| 100 | packages/backend/tests/unit/services/execution/terminalManager.test.ts | 保留：真实终端进程、缓冲游标、cwd 与会话隔离；创建短命令避免初态时间竞争 |
| 101 | packages/backend/tests/unit/services/execution/virtualWorkspace.test.ts | 保留：真实文件行窗口、原子编辑、软链接越界和diff |
| 102 | packages/backend/tests/unit/services/flow/flowStateService.test.ts | 改写：清空修订搬到真实仓库验证，删除仅返回Mock的空转发测试；标签不锁换行；纠正历史列已移除的标题 |
| 103 | packages/backend/tests/unit/services/gateway/gatewayHub.test.ts | 改写：off用例先验证监听确实可触发，再注销；其余信封和路由验证保留 |
| 104 | packages/backend/tests/unit/services/gateway/multiNodeGateway.test.ts | 保留：真实 Node/Gateway 重连、角色路由与Cursor恢复 |
| 105 | packages/backend/tests/unit/services/knowledgeIngestion.test.ts | 保留：上一轮完整重写，阈值拒绝和修正均真实判断 |
| 106 | packages/backend/tests/unit/services/knowledgeRuntime.test.ts | 保留：上一轮完整重写，真实SQLite/索引/工具及向量故障 |
| 107 | packages/backend/tests/unit/services/knowledgeSearch.test.ts | 保留：上一轮完整重写，独立版本快照、游标全量读回与多路召回 |
| 108 | packages/backend/tests/unit/services/llm/llmKernelAccounting.test.ts | 保留：真实调度器与 LLM Provider 边界的用量记账 |
| 109 | packages/backend/tests/unit/services/llm/modelRoles.test.ts | 保留：任务/角色模型指派、删除配置回退 |
| 110 | packages/backend/tests/unit/services/llm/providers/llmProviders.test.ts | 改写：SSE在UTF-8及事件边界分片；Responses核对FC身份和参数；删除时间戳ID、默认Token预算及回退型号锁；还原全局Spy |
| 111 | packages/backend/tests/unit/services/mcpRegistrySynchronizer.test.ts | 改写：工具更新标题需实际覆盖重新同步定义，保留AbortSignal传递 |
| 112 | packages/backend/tests/unit/services/memory/contextRnnGating.test.ts | 保留：ContextRNN 基础/高级开关及在途检索/反馈关闭竞态 |
| 113 | packages/backend/tests/unit/services/memory/eventMemoryFallbackService.test.ts | 改写：通过公开模型配置验证容量分批、Pair完整与正文覆盖；删除私有方法计算预期；夹具返回依赖并显式推进时钟 |
| 114 | packages/backend/tests/unit/services/memory/eventMemoryService.test.ts | 改写：日记按公布的重试时点验证退避，不锁默认10分钟；查询补节点/Token预算；重建先真正丢弃TDB；去进度展示文案；双库故障/关系/幂等真实测试保留 |
| 115 | packages/backend/tests/unit/services/memory/legacyMemoryRemoval.test.ts | 保留：上一轮已完整清理源码扫描，保留真实升级数据清除 |
| 116 | packages/backend/tests/unit/services/prompt/mdpEngine.test.ts | 改写：最大递归深度不用固定第11层做预期；禁用Slot测试补真正disabled输入，避免标题假覆盖 |
| 117 | packages/backend/tests/unit/services/pureLogic.test.ts | 改写：ModelRole环境变量逐项stub恢复；真实资产扫描、覆盖和模型解析保留 |
| 118 | packages/backend/tests/unit/services/retrieval/contextRnn.test.ts | 改写：PathResolver不能强制Windows分隔符；损坏权重恢复必须真的加载并还原状态/偏置，不只判断Float32Array |
| 119 | packages/backend/tests/unit/services/retrieval/contextRnnRuntime.test.ts | 保留：按需实例、脏检查点、关闭代次和反馈开关隔离 |
| 120 | packages/backend/tests/unit/services/retrieval/feedbackAndImageCache.test.ts | 改写：Buffer.buffer导出内存池错误，验证图片字节完整性；清理通过明确mtime排序，删除无用Date/mtime>0断言和sleep |
| 121 | packages/backend/tests/unit/services/schedulerService.test.ts | 改写：按持久化的下次重试/租约时点推进，去默认退避时间锁；保留真实派发、角色、幂等及每日限额 |
| 122 | packages/backend/tests/unit/services/serviceBatch.test.ts | 改写：Key脱敏验证不泄漏而非星号排版；连通性不锁探测句与50字符；周期启动真正推进时间触发，再验证停止；NapCat解析保留 |
| 123 | packages/backend/tests/unit/services/social/socialBridgeScheduler.test.ts | 改写：阻塞真实入口的持久化依赖，写入完成前禁止发布/回复；按发布信号等待并停止Bridge；保留回复决策隔离测试 |
| 124 | packages/backend/tests/unit/services/social/socialOwnerPrivateOnly.test.ts | 改写：删除以测试自写过滤器冒充主人私聊策略的用例；保留工具角色绑定、参数拒绝与无副作用 |
| 125 | packages/backend/tests/unit/services/social/socialReasoningReplay.test.ts | 保留：Social Compiler到真实OpenAI序列化的严格思考续轮 |
| 126 | packages/backend/tests/unit/services/social/socialReplySegmenter.test.ts | 保留：上一轮完整改写分块内容完整性及延迟单调/上限性质 |
| 127 | packages/backend/tests/unit/services/social/socialSchedulerStateMachine.test.ts | 改写：通过公开start/stop和虚拟时间触发候选选择、延后意图及重试，移除私有scan/nextGroupReviewAt注入 |
| 128 | packages/backend/tests/unit/services/social/socialServices.test.ts | 改写：缓存清理目前没改变文件，noop也能过；加入真实文件变动核对缓存失效；非法日记不得调用read |
| 129 | packages/backend/tests/unit/services/social/socialStateMachine.test.ts | 保留：真实会话收集、运行时新消息隔离、WAIT重审和DEFER时点 |
| 130 | packages/backend/tests/unit/services/system/systemService.test.ts | 改写：恢复process.platform；Windows路径显式按win32解析，mac/Linux使用原生绝对路径；去默认错误句 |
| 131 | packages/backend/tests/unit/services/task/backgroundTaskScheduler.test.ts | 改写：Repository Mock 必须尊重ID及期望状态，幂等查找不能始终返回首行；移除10ms睡眠；跟进预算按普通/受限关系验证而非默认魔数 |
| 132 | packages/backend/tests/unit/services/tokenizer/tokenCounter.test.ts | 保留：确定 tokenizer 的规格样例及消息开销 |
| 133 | packages/backend/tests/unit/services/workspace/workspaceCheckpointService.test.ts | 保留：toolCallId映射防回滚丢身份，以及真实文件人工改动保护 |
| 134 | packages/backend/tests/unit/services/workspace/workspaceService.test.ts | 改写：保留真实文件和通道边界，去掉截断标记的固定文案 |
| 135 | packages/backend/tests/unit/shared/llmJsonParser.test.ts | 保留：LLM JSON 提取和失败上下文；不测试提示词模板 |
| 136 | packages/backend/tests/unit/tools/askUser.test.ts | 改写：跨超时边界等待真实回答；改按 pending 状态等待并在 afterEach 还原时钟 |
| 137 | packages/backend/tests/unit/tools/codeSearcher.test.ts | 保留：真实文件搜索、列号、无效正则和打包 rg 解析；50 项为公开结果上限 |
| 138 | packages/backend/tests/unit/tools/desktopAutomation.test.ts | 改写：错误按结构化 code 和无副作用验证，去掉默认错误句 |
| 139 | packages/backend/tests/unit/tools/fileOpsDiff.test.ts | 改写：保留文件版本冲突和审批保护；Diff 预览只验证有界且完整统计，不锁展示长度 |
| 140 | packages/backend/tests/unit/tools/flowStateRegistration.test.ts | 保留：工具注册和 Gemini Schema 兼容是实际公开契约，单个知识工具是明确需求 |
| 141 | packages/backend/tests/unit/tools/openApplication.test.ts | 保留：名称歧义、离线和参数拒绝；供应端提供的错误需保留 |
| 142 | packages/backend/tests/unit/tools/toolUserLabels.test.ts | 保留：文案完整性、扩展覆盖和内部术语不泄漏，不锁默认文案 |
| 143 | packages/backend/tests/unit/tools/updateState.test.ts | 保留：触碰部位归一化、未知字段不保存和实际角色广播 |
| 144 | packages/document-engine/tests/advancedDocumentCapabilities.test.ts | 保留：便携包损坏拒绝、结构约束、评论与合并路径；修正插入操作的联合类型和损坏字节边界 |
| 145 | packages/document-engine/tests/contentExchange.test.ts | 改写：删除重复调用和自身比较的 Hash 断言，保留语义往返与篡改拒绝 |
| 146 | packages/document-engine/tests/contentModel.test.ts | 改写：文本、Markdown、HTML和演示导出校验内容；保留安全转义、岛声明权限与便携包签名验证 |
| 147 | packages/document-engine/tests/documentEngine.test.ts | 保留：事务回滚、幂等冲突、审批身份与可变状态隔离；修正泛型操作夹具类型 |
| 148 | packages/document-engine/tests/sqliteDocumentEngine.test.ts | 保留：真实SQLite重启、事务失败、Outbox与坏Checkpoint拒绝；插入夹具返回明确node.insert类型 |
| 149 | packages/frontend/src/composables/__tests__/useTabAutoFollow.test.ts | 改写：保留滚动跟随行为，补全全局 ResizeObserver 恢复 |
| 150 | packages/frontend/tests/applicationSurfaceSdk.test.ts | 保留：Manifest 未声明 Surface 拒绝、注销和加载器契约 |
| 151 | packages/frontend/tests/unit/api/client.test.ts | 保留：成功/失败信封转换和 JSON/multipart 编码；测试输入中的消息不是文案锁 |
| 152 | packages/frontend/tests/unit/api/errors.test.ts | 改写：网络错误只要求含状态和上游原因，不锁中文排版 |
| 153 | packages/frontend/tests/unit/api/modulesBatch.test.ts | 保留：上一轮已删普通转发；保留 nullable/覆盖选项、角色身份及查询编码 |
| 154 | packages/frontend/tests/unit/api/stream.test.ts | 改写：SSE 按 UTF-8 字节和事件边界分片，按完成信号等待，不猜测8次微任务 |
| 155 | packages/frontend/tests/unit/api/transport.test.ts | 改写：window 用 stubGlobal 自动恢复；保留 Web/Electron 路由与错误信封 |
| 156 | packages/frontend/tests/unit/api/voiceApi.test.ts | 改写：删除仅验证 getStatus 转发的用例；保留二进制、取消和错误处理 |
| 157 | packages/frontend/tests/unit/chatRichRenderer.test.ts | 保留：富文本隔离、安全净化与内部标签不泄漏，选择器用于定位而非视觉快照 |
| 158 | packages/frontend/tests/unit/companionActivity.test.ts | 保留：建议采纳副作用、角色竞态、隐藏停轮询及权限停止 |
| 159 | packages/frontend/tests/unit/components/petHud.test.ts | 保留：思考可见、事项按需出现、录音优先及字幕 Unicode 完整性 |
| 160 | packages/frontend/tests/unit/components/pixelDisplay.test.ts | 保留：上轮已改为真实禁用/加载状态阻止点击，不锁视觉 CSS |
| 161 | packages/frontend/tests/unit/components/pixelForm.test.ts | 改写：保留表单交互和边界，自动卸载宿主避免资源串扰 |
| 162 | packages/frontend/tests/unit/components/pixelOverlay.test.ts | 改写：保留选项禁用、确认输入及浮层关闭；自动卸载宿主 |
| 163 | packages/frontend/tests/unit/components/pixelRemaining.test.ts | 改写：保留日期、菜单、图片导航交互；自动卸载宿主 |
| 164 | packages/frontend/tests/unit/components/updateCenterDialog.test.ts | 改写：移除渠道颜色 class 和静态中文标签锁，保留实际版本展示、下载及安装 |
| 165 | packages/frontend/tests/unit/composables/avatarInteraction.test.ts | 保留：骨骼别名和未知骨骼按点击高度识别，真实 Three 场景 |
| 166 | packages/frontend/tests/unit/composables/baseComposables.test.ts | 改写：移除整套 Vue 替身，用真实响应式和宿主生命周期验证定时器及事件重绑定 |
| 167 | packages/frontend/tests/unit/compositor.test.ts | 改写：保留代次去重、提交替换、窗口隔离和 Seat 校验；终止状态去文案锁 |
| 168 | packages/frontend/tests/unit/embeddedWebPreview.test.ts | 改写：沙箱检查 CSP 和桥接，标题不声称已验证 HTML 未承载的同源权限 |
| 169 | packages/frontend/tests/unit/historyExport.test.ts | 保留：导出隐私开关必须真实删除思考和工具内容 |
| 170 | packages/frontend/tests/unit/memoriesTab.test.ts | 改写：自动卸载并去展示标签断言；保留分页、检索、来源错误和图谱加载 |
| 171 | packages/frontend/tests/unit/performanceGates.test.ts | 改写：去本机耗时门禁与自造 P95 基准，保留批量帧和大 Markdown 的内容正确性 |
| 172 | packages/frontend/tests/unit/petVoice.test.ts | 保留：录音只提交一次、短按取消、权限迟到及麦克风释放 |
| 173 | packages/frontend/tests/unit/programmableSurfaceSandbox.test.ts | 保留：摘要校验、网络拒绝、协议身份与大小上限是安全边界 |
| 174 | packages/frontend/tests/unit/socialConnectionStatus.test.ts | 保留：扫码后更新、慢请求复用、角色/激活竞态和权限停止轮询 |
| 175 | packages/frontend/tests/unit/stores/coreStores.test.ts | 改写：移除 Vue/Pinia 手写替身与 Ref 强制类型，使用真实 Store 和响应式 getter |
| 176 | packages/frontend/tests/unit/stores/threadActivation.test.ts | 保留：真实 Pinia 下初始化并发、旧角色和历史选择竞态及原始错误保留 |
| 177 | packages/frontend/tests/unit/strongholdChat.test.ts | 改写：全体成员测试标题收窄到实际等待状态，保留竞态和级联删除 |
| 178 | packages/frontend/tests/unit/taskDetailInput.test.ts | 保留：单次审批决策和附言、失败保留重试，真实用户交互 |
| 179 | packages/frontend/tests/unit/toolCallCard.test.ts | 改写：保留展开/收起和详情交互，去状态文案锁并自动卸载定时器 |
| 180 | packages/frontend/tests/unit/workspaceTerminal.test.ts | 保留：403停轮询、KeepAlive和切角色迟到请求，实际问题回归 |
| 181 | packages/node-host/tests/loopbackProcess.test.ts | 改写：子进程清理避免已退出后等待 exit 悬挂，Hello 使用公开等待接口 |
| 182 | packages/node-host/tests/nodeHost.test.ts | 改写：Hello 公开等待接口替代猜测10ms；保留真实传输、配对和权限验证 |
| 183 | packages/shared/tests/applicationProtocol.test.ts | 改写：删除自行构造 trace 再证明没字段的空断言；保留实际协议验证 |
| 184 | packages/shared/tests/multiNodeContract.test.ts | 改写：删除纯类型对象赋值/常量比较的两项伪契约测试；保留实际校验器及路由政策 |
| 185 | packages/shared/tests/petControls.test.ts | 保留：默认麦克风关闭、Windows 键码映射及非法绑定拒绝 |
| 186 | packages/shared/tests/unit/constants/responseCodes.test.ts | 保留：HTTP Code 分类和特殊映射是公共 API 契约，不锁中文句子 |


## 2026-10-11 再次复核补充

上一轮逐文件审阅仍遗漏了若干默认文案与内部默认值断言，不能将“已全量阅读”理解为“低价值断言已经绝对清零”。本节补充并更新上表对应文件的处理结论。

- 再次扫描剩余 185 个测试文件的字符串断言，并结合测试输入、产品实现和需求判定其依据；本次补改 51 个文件。
- 移除工具错误提示、群聊调度说明、记忆页面栏目、录音提示、更新按钮、脱敏占位文字等默认文案断言。存在结构化错误码时按错误码断言，拒绝操作继续验证无副作用；仅有普通 Error 时结合拒绝状态、正常路径和副作用判断。
- 删除错误展示映射的默认策略目录测试、普通 GET/DELETE 转发用例，以及重复或仅断言结果存在的检查。
- 输出截断和工具循环保护改为验证结果有界、确实终止，不锁当前内部长度或次数默认值；显式需求中的 10K/400K Token、最多 20 条知识检索结果等保留。
- 保留测试输入的转换、往返、传播与流式拼接结果，以及 HTTP/协议/键码和安全约束。界面交互测试仍可能用可见按钮文字定位控件；这类定位不是默认文案目录，但文案变化时仍可能需要同步选择器。
- 后端 tsc --noEmit、前端 vue-tsc --noEmit、文档引擎和共享模块 tsc --noEmit 均通过；本轮修改文件的 Git 差异空白检查通过；剩余测试 TypeScript 语法解析无错误。
- 未运行测试套件、构建或打包；静态通过不代表运行时测试已通过。覆盖率百分比门禁和 CI 中重复覆盖率运行仍已移除。

### 本次补改文件

- `packages/backend/tests/unit/services/execution/virtualWorkspace.test.ts`
- `packages/backend/tests/unit/services/execution/agentInputService.test.ts`
- `packages/backend/tests/unit/services/flow/flowStateService.test.ts`
- `packages/backend/tests/unit/services/attachmentService.test.ts`
- `packages/backend/tests/unit/services/schedulerService.test.ts`
- `packages/backend/tests/unit/services/knowledgeIngestion.test.ts`
- `packages/backend/tests/unit/services/butlerService.test.ts`
- `packages/backend/tests/unit/services/execution/terminalManager.test.ts`
- `packages/backend/tests/unit/kernel/kernelFoundation.test.ts`
- `packages/backend/tests/unit/kernel/capabilityDirectory.test.ts`
- `packages/backend/tests/unit/kernel/dataDirectoryGuard.test.ts`
- `packages/backend/tests/unit/capabilities/skillLoader.test.ts`
- `packages/backend/tests/unit/services/conversation/conversationTurnService.test.ts`
- `packages/backend/tests/unit/services/agent/agentManager.test.ts`
- `packages/backend/tests/unit/routers/strongholdRouter.test.ts`
- `packages/backend/tests/unit/tools/codeSearcher.test.ts`
- `packages/backend/tests/unit/tools/fileOpsDiff.test.ts`
- `packages/backend/tests/unit/services/social/socialBridgeScheduler.test.ts`
- `packages/backend/tests/unit/services/workspace/workspaceService.test.ts`
- `packages/backend/tests/unit/core/coreUtilities.test.ts`
- `packages/backend/tests/unit/repositories/facts.repo.test.ts`
- `packages/backend/tests/unit/nit/runtime.test.ts`
- `packages/backend/tests/unit/nit/parser.test.ts`
- `packages/backend/tests/unit/nit/lexer.test.ts`
- `packages/document-engine/tests/contentModel.test.ts`
- `packages/frontend/tests/unit/api/voiceApi.test.ts`
- `packages/backend/tests/unit/shared/llmJsonParser.test.ts`
- `packages/backend/tests/unit/services/agent/reactLoop.test.ts`
- `packages/backend/tests/unit/services/agent/toolExecutor.test.ts`
- `packages/backend/tests/unit/services/task/backgroundTaskScheduler.test.ts`
- `packages/backend/tests/unit/kernel/conversationSurface.test.ts`
- `packages/frontend/tests/unit/toolCallCard.test.ts`
- `packages/frontend/tests/unit/taskDetailInput.test.ts`
- `packages/frontend/tests/unit/socialConnectionStatus.test.ts`
- `packages/frontend/tests/unit/strongholdChat.test.ts`
- `packages/frontend/tests/unit/historyExport.test.ts`
- `packages/frontend/tests/unit/components/petHud.test.ts`
- `packages/frontend/tests/unit/components/pixelRemaining.test.ts`
- `packages/shared/tests/petControls.test.ts`
- `packages/frontend/tests/unit/memoriesTab.test.ts`
- `packages/backend/tests/unit/services/prompt/mdpEngine.test.ts`
- `packages/frontend/tests/unit/api/errors.test.ts`
- `packages/frontend/tests/unit/stores/coreStores.test.ts`
- `packages/frontend/tests/unit/api/client.test.ts`
- `packages/frontend/tests/unit/api/stream.test.ts`
- `packages/frontend/tests/unit/api/transport.test.ts`
- `packages/backend/tests/unit/services/social/socialOwnerPrivateOnly.test.ts`
- `packages/frontend/tests/unit/components/updateCenterDialog.test.ts`
- `packages/backend/tests/unit/services/agent/agentService.test.ts`
- `packages/backend/tests/unit/kernel/browserInteractionWorld.test.ts`
- `packages/backend/tests/unit/services/execution/policyApproval.test.ts`
