/**
 * SocialAppRuntime — 社交应用运行时
 *
 * 实现 AgentAppRuntime 接口，接入 AIOS 应用层。
 *
 * 职责：
 * - 管理 SocialBridge 生命周期（适配器连接/断开）
 * - 管理 SocialSessionManager + SocialScheduler（由 SocialBridge 内部创建）
 * - 通过 SocialAppCompiler 独立编译上下文（方案 B）
 * - 不调用主 Agent 的 AgentService.chat，完全独立
 * - 社交消息走应用自己的 LLM 调用
 *
 * 启动流程：
 *   AppManager.launch → SocialAppRuntime.initialize
 *     ├─ 创建 SocialAppCompiler
 *     ├─ 创建 SocialBridge（含 SessionManager + Scheduler）
 *     ├─ 从配置读取 QQ→Agent 映射，创建 NapcatAdapter 并注册
 *     ├─ 启动 SocialBridge
 *     └─ 注册 NapcatAdapter 到 socialWsBridge 供 WS 升级使用
 *
 * 关闭流程：
 *   AppManager.stop → SocialAppRuntime.onStop
 *     ├─ 停止 SocialBridge（含调度器 + 适配器断开）
 *     └─ 生成最终检查点
 *
 * @module packages/apps/social/runtime
 */

import { readFileSync } from 'node:fs'
import type {
  AgentAppRuntime,
  AppCheckpoint,
  AppCommandRequest,
  AppCommandResult,
  AppEvent,
  AppRuntimeContext,
  ToolDefinition,
} from '@infos/backend/applicationHostAbi'
import { createLogger, setSocialNapcatAdapter } from '@infos/backend/applicationHostAbi'
import { SocialAppCompiler, type SocialHistoryMessage } from './compiler'
import { SocialBridge } from './socialBridge'
import type {
  DeferredSocialIntent,
  FlushReason,
  ParticipationState,
  SocialTurnOutcome,
} from './socialSessionManager'
import type { SocialStoragePort } from '@infos/shared'
import { ImageCacheManager } from './imageCacheManager'
import { StickerService } from './stickerService'
import { SocialScorerService } from './socialScorer'
import { NapcatAdapter } from '../adapters/napcat'
import {
  setSocialMessagingProvider,
  setSocialModeControlProvider,
  socialSetOwnerPrivateOnlyTool,
  socialSendMessageTool,
  socialGetContactsTool,
  socialGetGroupsTool,
  socialGetContactInfoTool,
  socialGetGroupInfoTool,
  socialGetGroupMembersTool,
  socialHandleRequestTool,
  socialReadForwardMsgTool,
  socialReadImageTool,
  socialReadDiaryTool,
  socialRememberContactImpressionTool,
  socialGetContactHistoryTool,
  setSocialImageReaderProvider,
  setSocialDiaryReaderProvider,
  setSocialContactMemoryProvider,
  type SocialImageReaderProvider,
  type SocialContactMemoryProvider,
} from '../tools'
import { SocialDataService } from './socialDataService'
import { createSocialRouter } from './social.router'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const logger = createLogger('SocialAppRuntime')

/**
 * 社交应用自己的模板根目录
 *
 * 解析方式：从当前文件 (runtime/index.ts) 向上一级到应用根目录，再进入 prompts/
 * 即 packages/apps/social/prompts/
 *
 * AIOS：社交应用通过 MdpEngine.addTemplateRoot() 注册自己的模板目录，
 * 前缀为 "apps/social"，用于隔离应用模板与主 Agent 模板。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 便携/打包环境（单文件 bundle 后 import.meta 失效）通过 PERO_APP_ROOT 定位内置应用；
// 开发/独立部署环境回退到源码树相对定位。
const appRoot = process.env.PERO_APP_ROOT
const SOCIAL_PROMPTS_DIR = appRoot
  ? path.resolve(appRoot, 'apps', 'social', 'prompts')
  : path.resolve(__dirname, '../prompts')

// ─────────────────────────────────────────────
// SocialAppRuntime
// ─────────────────────────────────────────────

export class SocialAppRuntime implements AgentAppRuntime {
  /** 运行时上下文（initialize 时注入） */
  private ctx?: AppRuntimeContext
  /** 应用自己的编译器 */
  private compiler?: SocialAppCompiler
  /** 社交桥接 */
  private socialBridge?: SocialBridge
  /** NapCat 适配器 */
  private napcatAdapter?: NapcatAdapter
  /** 社交消息仓库 */
  private socialMessageRepo?: SocialStoragePort
  private socialScorer?: SocialScorerService
  private socialScorerRunning = new Set<string>()
  /** 表情包服务（扫描 Agent stickers 目录，提供关键词列表） */
  private stickerService?: StickerService
  /**
   * 可用工具定义列表（从 manifest.json 解析为 OpenAI function calling 格式）
   * 传给 compiler.generateReply → llmService.chat(tools) 让 LLM 能发起 FC 调用
   */
  private toolDefinitions: ToolDefinition[] = []
  /**
   * 社交工具执行器（name → execute 映射）
   * 当 LLM 返回 toolCalls 时，compiler 通过此函数执行对应社交工具
   */
  private toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>
  /** 已注册的 Grant ID 列表（onStop 时撤销用） */
  private grantIds: string[] = []
  /** 是否已运行 */
  private running = false
  /** 当前单实例 Social 绑定的角色，由配置界面指定。 */
  private socialAgentId = 'pero'
  /**
   * 主人的 QQ 号（从 social 配置读取）
   *
   * 用途：
   * 1. 注入到 NapcatAdapter 用于识别入站消息是否来自主人
   * 2. 注入到 compiler 的 system prompt，让 Agent 知道主人是谁
   * 3. 通过 generateReply 传递给 compiler，按是否主人调整权限提示
   */
  private ownerQq: string | undefined
  private modeConfig = {
    proactiveGroupEnabled: true,
    minMessagesForReview: 3,
    nightSilenceEnabled: true,
    nightSilenceStart: 0,
    nightSilenceEnd: 8,
    strangerPolicy: 'allow' as 'allow' | 'ignore',
    groupWhitelist: [] as string[],
    groupBlacklist: [] as string[],
    userBlacklist: [] as string[],
    ownerPrivateOnlyAgentIds: [] as string[],
  }

  /** 统计信息 */
  private stats = {
    messagesProcessed: 0,
    repliesSent: 0,
  }

  // ── 生命周期 ──

  async initialize(ctx: AppRuntimeContext): Promise<{ success: boolean; error?: string }> {
    this.ctx = ctx

    try {
      // 校验必要依赖
      if (!ctx.socialStorage) {
        throw new Error('社交应用需要SocialStoragePort')
      }
      if (!ctx.storeRegistry) {
        throw new Error(
          '社交应用需要 storeRegistry 依赖（访问 social.tdb），请在 AppManager 中注入',
        )
      }
      if (!ctx.socialEvents || !ctx.socialExecutions) {
        throw new Error('社交应用需要SocialEventPort和SocialExecutionPort')
      }
      if (!ctx.configRepo) {
        throw new Error('社交应用需要 configRepo 依赖，请在 AppManager 中注入')
      }

      const initialSocialConfig = await this.readSocialConfig(ctx)
      const configuredAgentId =
        typeof initialSocialConfig.agentId === 'string'
          ? initialSocialConfig.agentId
          : ctx.hostAgentId
      if (!ctx.agentManager.getAgent(configuredAgentId)) {
        throw new Error(`社交配置指定的角色不存在: ${configuredAgentId}`)
      }
      this.socialAgentId = configuredAgentId
      if (initialSocialConfig.agentId !== configuredAgentId || 'bindings' in initialSocialConfig) {
        initialSocialConfig.agentId = configuredAgentId
        delete initialSocialConfig.bindings
        await ctx.configRepo.set('social', JSON.stringify(initialSocialConfig))
      }

      // 注册社交应用自己的模板根目录，所有模板都由当前角色主模型消费。
      ctx.mdpEngine.addTemplateRoot(SOCIAL_PROMPTS_DIR, 'apps/social')

      // 1. 创建应用自己的编译器（方案 B 核心）
      // AIOS 隔离原则：Compiler 不依赖 memoryProvider（主 Agent RAG），
      // 只通过 storeRegistry 访问应用自己的 social.tdb（PEDSA 社交图谱）
      this.compiler = new SocialAppCompiler(
        ctx.grantRegistry,
        ctx.agentManager,
        ctx.mdpEngine,
        ctx.storeRegistry!,
      )
      this.compiler.setLlmService(ctx.llmService)

      // 2. 注册资源授权（仅 persona）
      // AIOS 隔离原则：subagent 不直接读主 Agent 记忆（RAG/CanonicalMemory），
      // 只继承人格投影；记忆交换通过 Checkpoint.memoryCandidates 走 MemoryGate 审核
      await this.registerGrants(ctx)

      // 3. 绑定Kernel提供的收窄存储Port。
      this.socialMessageRepo = ctx.socialStorage

      // 4. 创建图片缓存管理器
      const imageCacheManager = ctx.pathResolver
        ? new ImageCacheManager({
            cacheDir: ctx.pathResolver.resolve('@data/social_images'),
          })
        : undefined

      // 5. 创建表情包服务（保存到类字段，供 generateReply 获取表情包关键词列表）
      this.stickerService = ctx.agentBuiltinDir
        ? new StickerService(ctx.agentBuiltinDir)
        : undefined

      // 6. 创建社交 Scorer 服务（可选，依赖 storeRegistry + 社交炼化模型）
      if (ctx.storeRegistry && ctx.getSocialScorerModel) {
        this.socialScorer = new SocialScorerService(
          this.socialMessageRepo,
          ctx.storeRegistry,
          ctx.llmService,
          ctx.getSocialScorerModel,
          ctx.mdpEngine,
          ctx.agentManager,
        )
      }

      // 7. 创建 SocialBridge（内部自动创建 SessionManager + Scheduler）
      this.socialBridge = new SocialBridge({
        socialEvents: ctx.socialEvents,
        executions: ctx.socialExecutions,
        socialMessageRepo: this.socialMessageRepo,
        imageCacheManager,
        stickerService: this.stickerService,
        inboundRouteRepo: ctx.inboundRouteRepo,
        shouldAcceptInbound: (message) => {
          // 单实例 Social 始终由配置角色处理，频道路由不得跨角色改派。
          message.agentId = this.socialAgentId
          if (this.modeConfig.ownerPrivateOnlyAgentIds.includes(message.agentId)) {
            return message.channelType === 'private' && message.isOwner === true
          }
          if (this.modeConfig.userBlacklist.includes(message.senderId)) return false
          if (message.channelType === 'group') {
            if (this.modeConfig.groupBlacklist.includes(message.channelId)) return false
            if (
              this.modeConfig.groupWhitelist.length > 0 &&
              !this.modeConfig.groupWhitelist.includes(message.channelId)
            )
              return false
          }
          if (
            message.channelType === 'private' &&
            this.modeConfig.strangerPolicy === 'ignore' &&
            !message.isOwner
          )
            return false
          return true
        },
        shouldAllowSession: (session) =>
          session.agentId === this.socialAgentId &&
          (!this.modeConfig.ownerPrivateOnlyAgentIds.includes(session.agentId) ||
            (session.channelType === 'private' && session.channelId === this.ownerQq)),
        onMessagePersisted: async (agentId) => {
          if (!this.socialScorer || this.socialScorerRunning.has(agentId)) return
          this.socialScorerRunning.add(agentId)
          try {
            if (ctx.socialExecutions) {
              await ctx.socialExecutions.run({
                taskId: `social-scorer:${agentId}:${Date.now()}`,
                class: 'background',
                priority: 1,
                resourceKey: `social-scorer:${agentId}`,
                maxDurationMs: 10 * 60_000,
                run: async () => this.socialScorer!.checkAndProcess(agentId),
              })
            } else {
              await this.socialScorer.checkAndProcess(agentId)
            }
          } finally {
            this.socialScorerRunning.delete(agentId)
          }
        },
        generateReply: async (params) => this.generateReply(params),
      })

      // 8. 从配置读取 QQ→Agent 映射，创建 NapcatAdapter 并注册
      await this.setupNapcatAdapter(ctx)

      // 9. 启动 SocialBridge
      await this.socialBridge.start()

      // 10. 注入社交工具 Provider（供 socialOps 工具使用）
      if (this.socialBridge.hasActiveAdapter()) {
        const socialProvider = this.socialBridge.createMessagingProvider()
        if (socialProvider) {
          setSocialMessagingProvider(socialProvider)
          ctx.logger.info(`社交工具 Provider 已注入 (平台: ${socialProvider.platform})`)
        }
      }
      setSocialModeControlProvider({
        setOwnerPrivateOnly: (agentId, enabled) => this.setOwnerPrivateOnly(agentId, enabled),
      })

      // 11. 注册 NapcatAdapter 到全局 WS 桥接（供 wsUpgrade 使用）
      if (this.napcatAdapter) {
        setSocialNapcatAdapter(this.napcatAdapter)
      }

      // 12. 读取社交工具 manifest，解析为 ToolDefinition[] 供 LLM function calling 使用
      //     路径: packages/apps/social/tools/manifest.json（与 prompts/ 同级）
      try {
        const manifestPath = path.resolve(SOCIAL_PROMPTS_DIR, '../tools/manifest.json')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
          tools?: Array<{
            name: string
            description: string
            parameters?: Record<string, unknown>
          }>
        }
        if (manifest.tools?.length) {
          this.toolDefinitions = manifest.tools
            .filter((tool) => tool.name !== 'social_send_message')
            .map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters ?? { type: 'object', properties: {} },
              },
            }))
          this.toolDefinitions.push(
            {
              type: 'function',
              function: {
                name: 'social_wait',
                description:
                  '对方可能还没表达完整时调用。当前批次会被保留并等待后续消息；这是终局行为，调用后本轮立即结束。',
                parameters: {
                  type: 'object',
                  properties: {
                    reason: {
                      type: 'string',
                      enum: ['continuation_expected', 'missing_context', 'conversation_unsettled'],
                    },
                    duration: { type: 'string', enum: ['short', 'normal', 'long'] },
                  },
                  required: ['reason', 'duration'],
                  additionalProperties: false,
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'social_defer',
                description:
                  '当前不适合立即回应，但你想稍后在当前会话重新考虑时调用。不会保证未来发送；到期后仍由你根据最新语境决定。',
                parameters: {
                  type: 'object',
                  properties: {
                    intention: { type: 'string', maxLength: 100 },
                    timing: { type: 'string', enum: ['soon', 'later', 'much_later'] },
                    expires: { type: 'string', enum: ['one_hour', 'today', 'one_day'] },
                    condition: { type: 'string', maxLength: 100 },
                  },
                  required: ['intention', 'timing', 'expires'],
                  additionalProperties: false,
                },
              },
            },
          )
          const flowTool: ToolDefinition = {
            type: 'function',
            function: {
              name: 'update_flow_state',
              description: '维护当前社交会话的私有临时心流。仅在跨轮目标或私有事实发生变化时调用。',
              parameters: {
                type: 'object',
                properties: {
                  current_goal: {
                    type: 'string',
                    description: '当前持续目标；省略表示保留，空字符串表示清空。',
                  },
                  private_facts: {
                    type: 'string',
                    description: '不应直接向用户透露的短期关键事实；省略表示保留。',
                  },
                },
                additionalProperties: false,
              },
            },
          }
          this.toolDefinitions.push(flowTool)
          this.toolDefinitions.push({
            type: 'function',
            function: {
              name: 'communicate_with_host',
              description:
                '与宿主主 Agent 建立临时通信，用于核验可疑请求、申请审批、请求资源或汇报结果。',
              parameters: {
                type: 'object',
                properties: {
                  mode: {
                    type: 'string',
                    enum: [
                      'consult',
                      'verify',
                      'approval',
                      'request_resource',
                      'report',
                      'clarify',
                      'complete',
                    ],
                  },
                  summary: { type: 'string' },
                  context: { type: 'object' },
                },
                required: ['mode', 'summary'],
              },
            },
          })
          ctx.logger.info(
            `社交工具已加载: ${this.toolDefinitions.length} 个（含终局与系统协议工具）`,
          )
        }
      } catch {
        // 静默，工具列表保持为空
      }

      // 12b. 构建社交工具执行器（name → execute 映射）
      //      compiler.generateReply 在 LLM 返回 toolCalls 时通过此执行器调用对应工具
      //      社交工具内部通过 requireProvider() 获取已注入的 SocialMessagingProvider，
      //      不依赖 ctx 参数，故传入空壳 ctx 即可
      {
        const socialTools = [
          socialSetOwnerPrivateOnlyTool,
          socialSendMessageTool,
          socialGetContactsTool,
          socialGetGroupsTool,
          socialGetContactInfoTool,
          socialGetGroupInfoTool,
          socialGetGroupMembersTool,
          socialHandleRequestTool,
          socialReadForwardMsgTool,
          socialReadImageTool,
          socialReadDiaryTool,
          socialRememberContactImpressionTool,
          socialGetContactHistoryTool,
        ]
        // 构建 name → tool 实例映射
        const toolMap = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
        for (const tool of socialTools) {
          toolMap.set(tool.name, async (args) => {
            const result = await tool.execute(args, {
              agentId: this.socialAgentId,
              sessionId: ctx.realm.descriptor.realmId,
              source: 'application',
              threadId: ctx.realm.descriptor.realmId,
              channel: 'application',
            })
            return typeof result === 'string' ? result : JSON.stringify(result)
          })
        }
        // 执行器：根据工具名查找并执行，未知工具返回错误 JSON
        this.toolExecutor = async (name, args) => {
          const fn = toolMap.get(name)
          if (!fn) {
            return JSON.stringify({ error: `未知社交工具: ${name}` })
          }
          try {
            return await fn(args)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            return JSON.stringify({ error: `工具 ${name} 执行失败: ${errMsg}` })
          }
        }
        ctx.logger.info(`社交工具执行器已构建: ${socialTools.length} 个工具`)

        // ── 注入图片读取 Provider ──
        // social_read_image 工具通过此 Provider 按 message_id 从 DB 查询消息，
        // 提取图片 URL，下载并转 data URL 返回给工具
        if (this.socialMessageRepo && imageCacheManager) {
          const repo = this.socialMessageRepo
          const imgCache = imageCacheManager
          const imageReader: SocialImageReaderProvider = {
            async readImages(
              agentId: string,
              messageIds: string[],
              maxImages = 3,
            ): Promise<string[]> {
              const images: string[] = []
              const collectedUrls = new Set<string>() // 去重

              for (const msgId of messageIds) {
                if (images.length >= maxImages) break
                try {
                  const row = await repo.getByMsgId(agentId, msgId)
                  if (!row?.rawEventJson || row.rawEventJson === '{}') continue
                  const urls = extractImageUrlsFromRawEvent(row.rawEventJson)
                  for (const url of urls) {
                    if (images.length >= maxImages) break
                    if (collectedUrls.has(url)) continue
                    const localPath = await imgCache.download(url)
                    if (localPath) {
                      const dataUrl = imgCache.readAsDataUrl(localPath)
                      if (dataUrl) {
                        images.push(dataUrl)
                        collectedUrls.add(url)
                      }
                    }
                  }
                } catch {
                  // 单条消息查询失败不影响其他消息
                }
              }
              return images
            },
          }
          setSocialImageReaderProvider(imageReader)
          ctx.logger.info('社交图片读取 Provider 已注入')
        }

        if (ctx.hostDiaryReader) {
          setSocialDiaryReaderProvider(ctx.hostDiaryReader)
          ctx.logger.info('宿主Agent日记只读Provider已注入')
        }

        if (this.socialMessageRepo) {
          const repo = this.socialMessageRepo
          const contactMemoryProvider: SocialContactMemoryProvider = {
            async rememberImpression(input) {
              await repo.upsertContactImpression({
                ...input,
                platform: 'qq',
              })
            },
            async getContactHistory(input: {
              agentId: string
              userId: string
              groupId?: string
              privateLimit?: number
              groupLimit?: number
              selfMessageLimit?: number
            }) {
              const privateMessages = await repo.getRecentPrivateBySender(
                input.agentId,
                input.userId,
                input.privateLimit ?? 20,
              )
              const commonGroupIds = await repo.getRecentGroupsByContact(
                input.agentId,
                input.userId,
                5,
              )
              const selfMessagesByGroup = await Promise.all(
                commonGroupIds.map(async (groupId) => ({
                  groupId,
                  messages: (
                    await repo.getRecentSelfGroupMessages(
                      input.agentId,
                      groupId,
                      input.selfMessageLimit ?? 5,
                    )
                  ).map((message) => ({
                    content: message.content,
                    timestamp: message.timestamp,
                  })),
                })),
              )
              const groupMessages = input.groupId
                ? await repo.getContactGroupMessages(
                    input.agentId,
                    input.userId,
                    input.groupId,
                    input.groupLimit ?? 30,
                  )
                : []
              const impression = await repo.getContactImpression(input.agentId, 'qq', input.userId)
              return {
                contact: {
                  userId: input.userId,
                  displayName:
                    impression?.displayName ||
                    privateMessages.find((message) => message.senderId === input.userId)
                      ?.senderName ||
                    groupMessages[0]?.senderName ||
                    '',
                  identity: impression?.identity ?? '',
                  impression: impression?.impression ?? '',
                },
                commonGroups: selfMessagesByGroup,
                privateMessages: privateMessages.map((message) => ({
                  sender: message.senderName || message.senderId,
                  senderId: message.senderId,
                  content: message.content,
                  timestamp: message.timestamp,
                })),
                groupMessages: groupMessages.map((message) => ({
                  groupId: message.channelId,
                  sender: message.senderName || message.senderId,
                  senderId: message.senderId,
                  content: message.content,
                  timestamp: message.timestamp,
                })),
              }
            },
          }
          setSocialContactMemoryProvider(contactMemoryProvider)
          ctx.logger.info('社交联系人印象与历史 Provider 已注入')
        }
      }

      // 13. 动态挂载社交 HTTP 路由到主 app
      // AIOS sub app 路由挂载机制：通过 ctx.mountRouter 注册 HTTP 端点，
      // 不直接接触主 app 实例（隔离原则）。
      // 暴露 /api/social/status（适配器状态）和 /api/social/send（调试发消息）给前端 Dashboard。
      if (ctx.mountRouter) {
        const dataService = new SocialDataService({
          storage: this.socialMessageRepo!,
          resetMemory: (agentId) => ctx.storeRegistry!.resetAgentStore(agentId, 'social'),
          getAgentName: (agentId) => ctx.agentManager.getAgent(agentId)?.name,
        })
        const socialRouter = createSocialRouter(this.socialBridge, {
          dataService,
          getAgentConfig: () => ({ agentId: this.socialAgentId }),
          updateAgentConfig: (agentId) => this.setSocialAgent(agentId),
          getModeConfig: () => ({ ...this.modeConfig }),
          updateModeConfig: async (config) => {
            const next = { ...this.modeConfig, ...config }
            next.minMessagesForReview = Math.min(Math.max(Number(next.minMessagesForReview), 1), 20)
            next.nightSilenceStart = Math.min(Math.max(Number(next.nightSilenceStart), 0), 23)
            next.nightSilenceEnd = Math.min(Math.max(Number(next.nightSilenceEnd), 0), 23)
            next.groupWhitelist = Array.isArray(next.groupWhitelist)
              ? next.groupWhitelist.map(String)
              : []
            next.groupBlacklist = Array.isArray(next.groupBlacklist)
              ? next.groupBlacklist.map(String)
              : []
            next.userBlacklist = Array.isArray(next.userBlacklist)
              ? next.userBlacklist.map(String)
              : []
            next.ownerPrivateOnlyAgentIds = Array.isArray(next.ownerPrivateOnlyAgentIds)
              ? [...new Set(next.ownerPrivateOnlyAgentIds.map(String))]
              : []
            this.modeConfig = next
            this.socialBridge?.updateSchedulerConfig({
              proactiveGroupEnabled: next.proactiveGroupEnabled,
              minMessagesForReview: next.minMessagesForReview,
              nightSilenceEnabled: next.nightSilenceEnabled,
              nightSilenceStart: next.nightSilenceStart,
              nightSilenceEnd: next.nightSilenceEnd,
            })
            const raw = await ctx.configRepo!.get('social')
            const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
            current.mode = next
            await ctx.configRepo!.set('social', JSON.stringify(current))
            return { ...next }
          },
        })
        ctx.mountRouter('/api/social', socialRouter)
      } else {
        ctx.logger.warn('ctx.mountRouter 未注入，社交 HTTP 路由未挂载（前端 /api/social/* 将 404）')
      }

      this.running = true
      ctx.logger.info('社交应用运行时已初始化（已接入真实组件）')
      return { success: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      ctx.logger.error(`社交应用初始化失败: ${errMsg}`)
      return { success: false, error: errMsg }
    }
  }

  /**
   * 注册资源授权（仅 persona）
   *
   * AIOS 资源隔离原则：
   * - persona grant：读取主 Agent 的 system_prompt.md 作为人格基础（只读投影）
   * - **不注册 memory grant**：subagent 不直接读主 Agent 的 RAG/CanonicalMemory
   * - 记忆交换：社交应用产生有价值的记忆时，通过 Checkpoint.memoryCandidates
   *   提交给主 Agent 的 MemoryGate 审核，通过后才并入 CanonicalMemory
   *
   * 授权为 auto 级别（应用启动自动授予），onStop 时统一撤销。
   */
  private async registerGrants(ctx: AppRuntimeContext): Promise<void> {
    const { grantRegistry, instanceId, hostAgentId } = ctx

    // 注册 persona grant（读取主 Agent 人格投影）
    const personaGrantId = await grantRegistry.grant({
      ownerAgentId: hostAgentId,
      holderId: instanceId,
      holderType: 'app',
      resource: {
        kind: 'persona',
        agentId: hostAgentId,
        allowAppPatch: false,
      },
      permissions: ['read'],
      grantedBy: 'auto',
      note: '社交应用自动授权：读取主 Agent 人格投影',
    })
    this.grantIds.push(personaGrantId)

    ctx.logger.info(`资源授权已注册: persona (holder=${instanceId}, host=${hostAgentId})`)
  }

  /**
   * 撤销所有已注册的资源授权
   *
   * onStop 时调用，确保社交应用停止后不再持有主 Agent 资源访问权。
   */
  private async revokeGrants(): Promise<void> {
    if (!this.ctx || this.grantIds.length === 0) return

    const { grantRegistry } = this.ctx
    let revokedCount = 0

    for (const grantId of this.grantIds) {
      try {
        const ok = await grantRegistry.revoke(grantId)
        if (ok) revokedCount++
      } catch (err) {
        this.ctx.logger.warn(`撤销授权失败: grantId=${grantId}, ${err}`)
      }
    }

    this.grantIds = []
    this.ctx.logger.info(`资源授权已撤销: ${revokedCount} 条`)
  }

  private async readSocialConfig(ctx: AppRuntimeContext): Promise<Record<string, unknown>> {
    const raw = await ctx.configRepo?.get('social')
    if (!raw) return {}
    try {
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private async setSocialAgent(agentId: string): Promise<{
    agentId: string
    closedSessions: number
  }> {
    if (!this.ctx?.configRepo || !this.socialBridge) throw new Error('社交应用尚未初始化')
    if (!this.ctx.agentManager.getAgent(agentId)) throw new Error(`角色不存在: ${agentId}`)
    if (agentId === this.socialAgentId) return { agentId, closedSessions: 0 }

    const current = await this.readSocialConfig(this.ctx)
    current.agentId = agentId
    delete current.bindings
    await this.ctx.configRepo.set('social', JSON.stringify(current))

    const closedSessions = this.socialBridge.closeSessionsExcept(() => false)
    await this.revokeGrants()
    this.socialAgentId = agentId
    this.napcatAdapter?.setAgentId(agentId)
    await this.registerGrants(this.ctx)
    this.ctx.logger.info(`[${agentId}] Social 单实例角色已切换，清理会话 ${closedSessions} 个`)
    return { agentId, closedSessions }
  }

  private async setOwnerPrivateOnly(
    agentId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean; closedSessions: number }> {
    if (!this.ctx?.configRepo || !this.socialBridge) throw new Error('社交应用尚未初始化')
    if (!this.ctx.agentManager.getAgent(agentId)) throw new Error(`角色不存在: ${agentId}`)
    if (enabled && !this.ownerQq) throw new Error('尚未配置主人 QQ，无法启用仅主人私聊模式')

    const ids = new Set(this.modeConfig.ownerPrivateOnlyAgentIds)
    if (enabled) ids.add(agentId)
    else ids.delete(agentId)
    this.modeConfig.ownerPrivateOnlyAgentIds = [...ids]

    const raw = await this.ctx.configRepo.get('social')
    let current: Record<string, unknown> = {}
    if (raw) {
      try {
        current = JSON.parse(raw) as Record<string, unknown>
      } catch {
        current = {}
      }
    }
    current.mode = { ...this.modeConfig }
    await this.ctx.configRepo.set('social', JSON.stringify(current))

    const closedSessions = enabled
      ? this.socialBridge.closeSessionsExcept(
          (session) =>
            session.agentId !== agentId ||
            (session.channelType === 'private' && session.channelId === this.ownerQq),
        )
      : 0
    this.ctx.logger.info(
      `[${agentId}] ${enabled ? '启用' : '关闭'}仅主人私聊激活模式，清理会话 ${closedSessions} 个`,
    )
    return { enabled, closedSessions }
  }

  /**
   * 设置 NapCat 适配器（单实例统一使用配置角色）
   */
  private async setupNapcatAdapter(ctx: AppRuntimeContext): Promise<void> {
    if (!ctx.configRepo) return

    const socialConfig = await this.readSocialConfig(ctx)

    if (socialConfig && typeof socialConfig === 'object') {
      // 读取主人 QQ 号（权限控制核心配置）
      // 存储在 social 配置的顶层 ownerQq 字段，值为字符串
      const rawOwnerQq = socialConfig.ownerQq
      this.ownerQq = rawOwnerQq ? String(rawOwnerQq) : undefined
      const mode = socialConfig.mode
      if (mode && typeof mode === 'object' && !Array.isArray(mode)) {
        const configured = mode as Partial<typeof this.modeConfig>
        this.modeConfig = {
          ...this.modeConfig,
          ...configured,
          groupWhitelist: Array.isArray(configured.groupWhitelist)
            ? configured.groupWhitelist.map(String)
            : [],
          groupBlacklist: Array.isArray(configured.groupBlacklist)
            ? configured.groupBlacklist.map(String)
            : [],
          userBlacklist: Array.isArray(configured.userBlacklist)
            ? configured.userBlacklist.map(String)
            : [],
          ownerPrivateOnlyAgentIds: Array.isArray(configured.ownerPrivateOnlyAgentIds)
            ? [...new Set(configured.ownerPrivateOnlyAgentIds.map(String))]
            : [],
        }
        this.socialBridge?.updateSchedulerConfig({
          proactiveGroupEnabled: this.modeConfig.proactiveGroupEnabled,
          minMessagesForReview: this.modeConfig.minMessagesForReview,
          nightSilenceEnabled: this.modeConfig.nightSilenceEnabled,
          nightSilenceStart: this.modeConfig.nightSilenceStart,
          nightSilenceEnd: this.modeConfig.nightSilenceEnd,
        })
      }
    }

    // 创建并注册 NapCat 适配器（注入 ownerQq 用于入站消息身份识别）
    this.napcatAdapter = new NapcatAdapter({
      defaultAgentId: this.socialAgentId,
      autoAcceptFriend: true,
      ownerQq: this.ownerQq,
    })
    this.socialBridge!.registerAdapter(this.napcatAdapter)

    ctx.logger.info(
      `NapCat 适配器已注册, Social Agent: ${this.socialAgentId}, ` +
        `主人QQ: ${this.ownerQq ?? '(未配置)'} (等待反向 WS 连接)`,
    )
  }

  /**
   * 回复生成回调（方案 B：使用应用自己的 Compiler + LLM）
   *
   * 由 SocialBridge.executeReply 调用。
   */
  private async generateReply(params: {
    agentId: string
    channelType: 'private' | 'group'
    channelId: string
    combinedMessage: string
    trigger: FlushReason
    participation: ParticipationState
    deferredIntent?: DeferredSocialIntent
    routeChannel?: string
    routeThreadId?: string
    isOwner?: boolean
    triggerSenderId?: string
    flushMsgIds?: string[]
    /** 触发消息中的图片附件（data URL 格式，供多模态 LLM 使用） */
    images?: string[]
    /** Bot 自身 QQ 号（注入到上下文） */
    botSelfId?: string
    /** Bot 自身昵称（注入到上下文） */
    botNickname?: string
  }): Promise<SocialTurnOutcome> {
    if (!this.ctx || !this.compiler) {
      throw new Error('社交应用未初始化，无法唤醒角色 Agent')
    }

    const { agentId, channelType, channelId, combinedMessage } = params

    // ── 从 DB 加载本会话最近 50 条聊天记录 ──
    // 无论是一直在线还是刚启动，都从 social_messages 表读取该频道的历史
    // 这样进程重启后 LLM 也能恢复上下文，不再依赖内存 Map
    // 加载量 50 条是 token 占用与上下文完整性的平衡点，后续如需调整只改此处即可
    let history: SocialHistoryMessage[] = []
    if (this.socialMessageRepo) {
      try {
        const dbRows = await this.socialMessageRepo.getRecent(agentId, channelId, channelType, 50)
        // 过滤掉本次 flush 的消息（handleInbound 已持久化到 DB，但 combinedMessage 会单独追加，
        // 不过滤会导致同一条消息在 messages 中出现两次）
        const excludeIds = new Set(params.flushMsgIds ?? [])
        const filteredRows =
          excludeIds.size > 0 ? dbRows.filter((r) => !excludeIds.has(r.msgId)) : dbRows
        // 转换为 compiler 需要的 SocialHistoryMessage 格式
        // - senderId='self' 的是 Agent 回复 → role=assistant
        // - 其他都是用户消息 → role=user
        history = filteredRows.map((row) => ({
          role: (row.senderId === 'self' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: row.content,
          senderName: row.senderId === 'self' ? undefined : row.senderName || row.senderId,
          timestamp: row.timestamp ?? new Date().toISOString(),
        }))
      } catch (err) {
        logger.warn(`从 DB 加载会话历史失败 (非致命): ${err}`)
      }
    }

    // ── 跨会话上下文注入：群聊被 @ 时拉取触发者的最近私聊记录 ──
    // 场景：用户 A 在群里 @ Agent，Agent 能看到与 A 的最近私聊作为补充上下文
    // 仅群聊场景需要（私聊时当前会话本身就是私聊，已在 history 中）
    let crossSessionContext: string | undefined
    const contactUserId = channelType === 'private' ? channelId : params.triggerSenderId
    const contactImpression = contactUserId
      ? await this.socialMessageRepo?.getContactImpression(agentId, 'qq', contactUserId)
      : null
    if (channelType === 'group' && params.triggerSenderId && this.socialMessageRepo) {
      try {
        const privateMsgs = await this.socialMessageRepo.getRecentPrivateBySender(
          agentId,
          params.triggerSenderId,
          10,
        )
        if (privateMsgs.length > 0) {
          // 格式化为紧凑的私聊摘要，注入 system prompt
          const lines = privateMsgs.map((m) => {
            const role = m.senderId === 'self' ? 'Pero' : m.senderName || m.senderId
            return `[${role}]: ${m.content}`
          })
          crossSessionContext = lines.join('\n')
          logger.debug(
            `跨会话上下文: sender=${params.triggerSenderId}, 私聊记录=${privateMsgs.length} 条`,
          )
        }
      } catch (err) {
        // 静默，跨会话上下文是可选的
        logger.debug(`跨会话上下文加载失败 (非致命): ${err}`)
      }
    }

    // ── Realm私有会话心流，不创建或复用主应用Thread。──
    const realmSessionId = `${channelType}:${channelId}`
    const flowState = await this.ctx.flowStateService.getRealm(
      this.ctx.realm.descriptor.realmId,
      realmSessionId,
      agentId,
    )
    const flowStatePrompt = this.ctx.flowStateService.formatForPrompt(flowState)

    // ── 编译上下文（方案 B：基于 GrantRegistry 授权）──
    const stickerList = this.stickerService?.loadAgentStickers(agentId)
    const compiled = await this.compiler.compile({
      instanceId: this.ctx.instanceId,
      hostAgentId: this.socialAgentId,
      history,
      userMessage: combinedMessage,
      channelType,
      ownerQq: this.ownerQq,
      isOwner: params.isOwner ?? false,
      flowStatePrompt,
      // 用户称呼：取该 Agent 的 agent.json owner_appellation（兜底"主人"），用于替换社交规则/身份提示中的"主人"占位
      ownerAppellation: this.ctx.agentManager.getOwnerAppellation(this.socialAgentId),
      // 主人名称：主人在主 app 里登记的名字（owner.name，兜底"用户"），与称呼语义区分
      ownerName: (await this.ctx.configRepo?.get('owner.name')) ?? '用户',
      stickerList,
      contactImpression: contactImpression
        ? {
            userId: contactImpression.userId,
            displayName: contactImpression.displayName,
            identity: contactImpression.identity ?? '',
            impression: contactImpression.impression,
          }
        : undefined,
      crossSessionContext,
      triggerSenderId: params.triggerSenderId,
      images: params.images,
      botSelfId: params.botSelfId,
      botNickname: params.botNickname,
    })

    // 社交回复属于角色自身表达，使用当前角色指派的模型。
    const model = this.ctx.getAgentModel ? await this.ctx.getAgentModel(agentId) : null
    if (!model) throw new Error('未配置角色主模型，无法处理社交回合')

    let terminalOutcome: SocialTurnOutcome | undefined
    const diaryAllowed = channelType === 'private' && params.isOwner === true
    const turnToolDefinitions = diaryAllowed
      ? this.toolDefinitions
      : this.toolDefinitions.filter((tool) => tool.function.name !== 'social_read_diary')
    const terminalTools = new Set(['social_wait', 'social_defer'])
    const situation = [
      `触发方式: ${params.trigger}`,
      `当前参与关系: ${params.participation}`,
      params.trigger === 'proactive_review' ? '没有人要求你回复；是否参与完全由你自己决定。' : '',
      params.deferredIntent
        ? `你之前想稍后重新考虑：${params.deferredIntent.intention}${params.deferredIntent.condition ? `；当时的条件：${params.deferredIntent.condition}` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
    const last = compiled.messages.at(-1)
    if (last && typeof last.content === 'string') {
      last.content = `<social_situation>\n${situation}\n</social_situation>\n\n${last.content}`
    }

    // 调用同一角色 Agent 的有限 ReAct。终局控制工具只提交行为，不执行外部副作用。
    const scopedToolExecutor = async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> => {
      if (name === 'social_read_diary' && !diaryAllowed) {
        return JSON.stringify({ success: false, error: '只有主人私聊可以读取当前角色的日记' })
      }
      if (name === 'social_wait') {
        const reason = String(args.reason ?? '') as
          | 'continuation_expected'
          | 'missing_context'
          | 'conversation_unsettled'
        const duration = String(args.duration ?? '') as 'short' | 'normal' | 'long'
        if (
          !['continuation_expected', 'missing_context', 'conversation_unsettled'].includes(reason)
        ) {
          return JSON.stringify({ success: false, error: '无效的等待原因' })
        }
        if (!['short', 'normal', 'long'].includes(duration)) {
          return JSON.stringify({ success: false, error: '无效的等待时长' })
        }
        terminalOutcome = { type: 'wait', wait: { reason, duration } }
        return JSON.stringify({ success: true, terminal: true })
      }
      if (name === 'social_defer') {
        const intention = String(args.intention ?? '')
          .trim()
          .slice(0, 100)
        const timing = String(args.timing ?? '') as 'soon' | 'later' | 'much_later'
        const expires = String(args.expires ?? '') as 'one_hour' | 'today' | 'one_day'
        if (!intention || !['soon', 'later', 'much_later'].includes(timing)) {
          return JSON.stringify({ success: false, error: '延后意图参数无效' })
        }
        if (!['one_hour', 'today', 'one_day'].includes(expires)) {
          return JSON.stringify({ success: false, error: '延后意图有效期无效' })
        }
        terminalOutcome = {
          type: 'defer',
          intent: {
            intention,
            timing,
            expires,
            condition:
              typeof args.condition === 'string' ? args.condition.trim().slice(0, 100) : undefined,
          },
        }
        return JSON.stringify({ success: true, terminal: true })
      }
      if (name === 'update_flow_state') {
        const currentGoal = typeof args.current_goal === 'string' ? args.current_goal : undefined
        const privateFacts = typeof args.private_facts === 'string' ? args.private_facts : undefined
        if (currentGoal === undefined && privateFacts === undefined) {
          return JSON.stringify({
            success: false,
            error: '至少需要提供 current_goal 或 private_facts',
          })
        }
        const updated = await this.ctx!.flowStateService.updateRealm({
          realmId: this.ctx!.realm.descriptor.realmId,
          sessionId: realmSessionId,
          agentId,
          currentGoal,
          privateFacts,
        })
        return JSON.stringify({
          success: true,
          message: '当前社交会话心流已更新',
          revision: updated.revision,
        })
      }
      if (name === 'communicate_with_host') {
        const mode = String(args.mode ?? 'consult') as
          | 'consult'
          | 'verify'
          | 'approval'
          | 'request_resource'
          | 'report'
          | 'clarify'
          | 'complete'
        return JSON.stringify(
          await this.ctx!.communicateWithHost({
            correlationId: crypto.randomUUID(),
            mode,
            summary: String(args.summary ?? ''),
            context:
              args.context && typeof args.context === 'object' && !Array.isArray(args.context)
                ? (args.context as Record<string, unknown>)
                : undefined,
          }),
        )
      }
      return this.toolExecutor
        ? this.toolExecutor(name, args)
        : JSON.stringify({ success: false, error: `工具执行器不可用: ${name}` })
    }
    const reply = await this.compiler.generateReply(compiled.messages, model, {
      tools: turnToolDefinitions,
      toolExecutor: scopedToolExecutor,
      isTerminalTool: (name) => terminalTools.has(name),
    })

    const outcome: SocialTurnOutcome = terminalOutcome
      ? terminalOutcome
      : isPassReply(reply)
        ? { type: 'pass' }
        : { type: 'reply', content: reply }

    this.stats.messagesProcessed++
    if (outcome.type === 'reply' && outcome.content.trim()) this.stats.repliesSent++

    this.ctx.emitEvent({
      type: 'progress',
      instanceId: this.ctx.instanceId,
      progress: 0,
      message:
        outcome.type === 'reply'
          ? `已生成频道 ${channelId} 的回复：${outcome.content.slice(0, 50)}`
          : `频道 ${channelId} 选择 ${outcome.type.toUpperCase()}`,
      timestamp: new Date().toISOString(),
    })

    return outcome
  }

  /** 获取 NapCat 适配器（供外部 WS 升级使用） */
  getNapcatAdapter(): NapcatAdapter | undefined {
    return this.napcatAdapter
  }

  async onPause(): Promise<void> {
    this.running = false
    // 暂停时停止调度器（SocialBridge.stop 会停止调度器和适配器）
    if (this.socialBridge) {
      await this.socialBridge.stop()
    }
    this.ctx?.logger.info('社交应用已暂停')
  }

  async onResume(): Promise<void> {
    this.running = true
    // 恢复时重新启动 SocialBridge
    if (this.socialBridge) {
      await this.socialBridge.start()
    }
    this.ctx?.logger.info('社交应用已恢复')
  }

  async onStop(): Promise<AppCheckpoint | undefined> {
    this.running = false

    // 停止 SocialBridge（含调度器 + 适配器断开）
    if (this.socialBridge) {
      await this.socialBridge.stop()
    }

    // 注销全局桥接与工具 Provider，避免应用停止后保留失效引用
    setSocialNapcatAdapter(null)
    setSocialMessagingProvider(null)
    setSocialModeControlProvider(null)
    setSocialImageReaderProvider(null)
    setSocialDiaryReaderProvider(null)
    setSocialContactMemoryProvider(null)

    // 撤销资源授权（仅 persona）
    await this.revokeGrants()

    this.ctx?.logger.info('社交应用已停止')

    return this.getCheckpoint()
  }

  getCheckpoint(): AppCheckpoint | undefined {
    if (!this.ctx) return undefined

    const connectedPlatforms = this.socialBridge?.hasActiveAdapter() ? ['qq'] : []

    return {
      instanceId: this.ctx.instanceId,
      appId: this.ctx.appId,
      status: this.running ? 'running' : 'completed',
      summary: `社交应用${this.running ? '运行中' : '已停止'}，已处理 ${this.stats.messagesProcessed} 条消息，发送 ${this.stats.repliesSent} 条回复`,
      progress: this.running ? 0.5 : 1,
      fields: {
        connectedPlatforms,
        activeSessions: this.socialBridge?.listSessions().length ?? 0,
        messagesProcessed: this.stats.messagesProcessed,
        repliesSent: this.stats.repliesSent,
      },
      changedArtifacts: [],
      blockers: [],
      nextActions: [],
      updatedAt: new Date().toISOString(),
    }
  }

  // ── 会话管理（supportsMultipleSessions=false，但内部维护多频道历史）──

  async createSession(_params?: { title?: string }): Promise<string> {
    // 社交应用不通过此接口创建会话，会话由入站消息自动创建
    return this.ctx?.instanceId ?? 'unknown'
  }

  async listSessions(): Promise<Array<{ id: string; title: string; status: string }>> {
    return (this.socialBridge?.listSessions() ?? []).map((session) => ({
      id: `${session.agentId}:${session.channelType}:${session.channelId}`,
      title: `${session.channelType === 'private' ? '私聊' : '群聊'} ${session.channelId}`,
      status: `${session.participation}:${session.phase}`,
    }))
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const [agentId, , channelId] = sessionId.split(':')
    return Boolean(agentId && channelId && this.socialBridge?.closeSession(agentId, channelId))
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const [agentId, channelType, channelId] = sessionId.split(':')
    const provider = this.socialBridge?.createMessagingProvider()
    if (!provider || !agentId || !channelId) throw new Error('SOCIAL_SESSION_UNAVAILABLE')
    await provider.sendMessage(
      agentId,
      channelId,
      content,
      channelType === 'group' ? 'group' : 'private',
    )
  }

  subscribeSession(_sessionId: string, _handler: (event: AppEvent) => void): () => void {
    // TODO: 应用内部事件流订阅
    return () => {}
  }

  async executeCommand(request: AppCommandRequest): Promise<AppCommandResult> {
    if (request.action !== 'chat_in_group') {
      return {
        correlationId: request.correlationId,
        status: 'failed',
        summary: '不支持的社交动作',
        error: request.action,
      }
    }
    if (!this.ctx || !this.socialBridge || !this.socialMessageRepo) {
      return { correlationId: request.correlationId, status: 'failed', summary: '社交应用尚未就绪' }
    }
    const groupId = String(request.input.group_id ?? '').trim()
    if (!groupId) {
      return { correlationId: request.correlationId, status: 'failed', summary: '缺少目标群号' }
    }
    const intent = String(request.input.intent ?? '自然参与当前话题，不强行开启无关话题')
    const outcome = await this.generateReply({
      agentId: this.socialAgentId,
      channelType: 'group',
      channelId: groupId,
      combinedMessage: `【主 Agent 委派的单次社交任务】${intent}\n请结合群聊近期记录判断如何自然参与；直接给出准备发送到群里的内容。`,
      trigger: 'proactive_review',
      participation: 'idle',
      isOwner: true,
      triggerSenderId: this.ownerQq,
    })
    if (outcome.type !== 'reply' || !outcome.content.trim()) {
      return {
        correlationId: request.correlationId,
        status: 'completed',
        summary: '社交 Agent 判断本次无需发言',
        output: { sent: false, groupId },
      }
    }
    const reply = outcome.content.trim()
    await this.socialBridge.sendReply('qq', {
      channelId: groupId,
      channelType: 'group',
      content: reply,
    })
    await this.socialMessageRepo.insert({
      msgId: `agent_command_${Date.now()}`,
      platform: 'qq',
      channelId: groupId,
      channelType: 'group',
      senderId: 'self',
      senderName: this.socialAgentId,
      content: reply,
      agentId: this.socialAgentId,
    })
    return {
      correlationId: request.correlationId,
      status: 'completed',
      summary: `已在群 ${groupId} 完成一次自然参与`,
      output: { sent: true, groupId, content: reply },
    }
  }

  // ── 记忆回流 ──

  /**
   * 获取社交应用在某日产生的记忆摘要列表
   *
   * 实现 AIOS 记忆回流通道：从 social.tdb 读取当日 SocialScorer 炼化的
   * Event 节点（零向量 + payload），返回其 content 字段作为摘要。
   *
   * 这些摘要会被主 Agent 的 DiaryEngine 聚合，与桌面对话摘要合并后
   * 生成带向量的日记节点，从而让社交信息通过日记回流到主 Agent 的 RAG。
   *
   * 设计要点：
   * - social.tdb 的 Event 节点是零向量（省 embedding 开销），不能直接被 RAG 检索
   * - 但通过日记这个"带向量的载体"，社交信息最终可被主 Agent 检索
   * - 主 Agent 不直接读 social.tdb，只消费此方法返回的字符串列表（解耦）
   *
   * @param date ISO 日期字符串（如 "2026-08-08"）
   * @returns 当日社交 Event 的摘要列表
   */
  async getDailySummaries(date: string): Promise<string[]> {
    if (!this.ctx?.storeRegistry) return []

    const summaries: string[] = []
    try {
      const store = this.ctx.storeRegistry.getAgentStore(this.socialAgentId, 'social')
      if (store.nodeCount() === 0) return []

      // 计算当日 00:00 的 Unix 秒数（本地时区）
      const dayStart = new Date(`${date}T00:00:00`)
      const dayStartSec = Math.floor(dayStart.getTime() / 1000)

      // 遍历所有节点，筛选当日 Event 节点
      for (const id of store.allNodeIds()) {
        const node = store.get(id)
        if (!node) continue

        const payload = node.payload as Record<string, unknown>
        if (payload?.type !== 'event') continue

        const ts = (payload?.timestamp as number) ?? 0
        if (ts >= dayStartSec) {
          const content = (payload?.content as string) ?? ''
          if (content) summaries.push(content)
        }
      }
    } catch (err) {
      logger.warn(`读取社交当日记忆摘要失败: ${err}`)
    }

    return summaries
  }
}

// ─────────────────────────────────────────────
// 内置应用运行时工厂
// ─────────────────────────────────────────────

/**
 * 应用运行时工厂函数
 *
 * Backend通过受信任的内置Runtime注册表创建SocialAppRuntime实例。
 */
export default function createRuntime(): AgentAppRuntime {
  return new SocialAppRuntime()
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

function isPassReply(reply: string): boolean {
  return reply.trim().toUpperCase() === 'PASS'
}

/**
 * 从 OneBot 原始事件的 JSON 字符串中提取图片 URL
 *
 * 用于 social_read_image 工具：从 DB 查询到消息的 rawEventJson 后，
 * 解析 OneBot message segments，提取 image 段的 url 字段。
 *
 * OneBot v11 image 段格式：
 *   { "type": "image", "data": { "url": "https://...", "file": "xxx.jpg" } }
 */
function extractImageUrlsFromRawEvent(rawEventJson: string): string[] {
  try {
    const event = JSON.parse(rawEventJson) as {
      message?: Array<{ type: string; data: Record<string, unknown> }>
    }
    if (!Array.isArray(event.message)) return []
    const urls: string[] = []
    for (const seg of event.message) {
      if (seg.type === 'image' && typeof seg.data.url === 'string') {
        urls.push(seg.data.url)
      }
    }
    return urls
  } catch {
    return []
  }
}
