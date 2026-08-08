/**
 * SocialAppCompiler — 社交应用独立上下文编译器
 *
 * 方案 B 核心：社交应用有自己的 Compiler，独立编译上下文。
 * 不依赖主 Agent 的 ContextCompiler / AgentService.chat pipeline。
 *
 * AIOS 资源隔离原则：
 * - 人格投影：通过 GrantRegistry 授权读取主 Agent 的 system_prompt.md（只读）
 * - 记忆检索：只查应用自己的 social.tdb（SocialScorer 炼化的图谱）
 *   **不直接访问主 Agent 的 RAG / CanonicalMemory**
 * - 记忆交换：通过 Checkpoint.memoryCandidates 提交给主 Agent 审核
 *
 * 编译流程：
 * 1. 查询 GrantRegistry 获取 persona 授权
 * 2. 读取主 Agent 人格投影（system_prompt.md）
 * 3. 检索应用自己的社交记忆（social.tdb，BM25 + 关键词，零 Embedding）
 * 4. 组装 system prompt（人格 + 社交场景规则 + 社交记忆）
 * 5. 拼装 LLM Messages（system + history + user）
 *
 * @module packages/apps/social/runtime/compiler
 */

import type { GrantRegistry } from '../../../backend/src/applications/grantRegistry'
import type { ResourceRef } from '../../../backend/src/applications/types'
import type { LlmService, ModelConfig } from '../../../backend/src/services/llm/llmService'
import type { ContentPart, ChatMessage, ToolDefinition, ToolCall } from '../../../backend/src/services/llm/types'
import type { MdpEngine } from '../../../backend/src/services/prompt/mdpEngine'
import type { AgentManager } from '../../../backend/src/services/agent/agentManager'
import type { MemoryStoreRegistry } from '../../../backend/src/repositories/storeRegistry'
import type { TriviumDB } from 'triviumdb'
import { readFileSync } from 'node:fs'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialAppCompiler')

/** 截断长文本用于日志输出（与桌面模式 reactLoop 对齐，避免终端被超长 prompt 刷屏） */
function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `... (共${text.length}字符)`
}

/**
 * 从工具返回的 JSON 字符串中提取图片 data URL
 *
 * social_read_image 工具返回 { success, count, images: ["data:image/..."] } 格式，
 * 此函数解析 JSON 并提取 images 数组中的 data URL。
 * 如果工具返回值不是有效 JSON 或没有 images 字段，返回空数组。
 */
function extractImagesFromToolResult(result: string): string[] {
  try {
    const parsed = JSON.parse(result) as { images?: unknown }
    if (Array.isArray(parsed.images)) {
      return parsed.images.filter((url): url is string => typeof url === 'string')
    }
  } catch {
    // 非 JSON 返回值，忽略
  }
  return []
}

/**
 * 过滤 LLM 回复中的 Thinking/Monologue 块
 *
 * 多重匹配过滤机制，防止【】内的思考内容外泄到社交平台：
 * 支持三种括号格式：
 *   【Thinking...】  [Thinking...]  (Thinking...)
 *   【Monologue...】 [Monologue...] (Monologue...)
 *
 * 非贪婪匹配，删除从开始标记到闭合括号的全部内容（含括号本身）。
 * 未闭合的块（只有开始没有结束）也会被过滤（防止 LLM 输出格式错误）。
 */
function stripThinkingBlocks(text: string): string {
  // 多重匹配：三种括号 × 两种标签 = 6 种组合
  // 非贪婪匹配 + 全局替换
  const patterns = [
    /【Thinking[\s\S]*?】/g,
    /\[Thinking[\s\S]*?\]/g,
    /\(Thinking[\s\S]*?\)/g,
    /【Monologue[\s\S]*?】/g,
    /\[Monologue[\s\S]*?\]/g,
    /\(Monologue[\s\S]*?\)/g,
  ]
  let result = text
  for (const pattern of patterns) {
    result = result.replace(pattern, '')
  }
  // 处理未闭合的块（只有开始标记没有结束标记）
  // 从开始标记到字符串末尾全部删除
  const unclosedPatterns = [
    /【Thinking[\s\S]*$/g,
    /\[Thinking[\s\S]*$/g,
    /\(Thinking[\s\S]*$/g,
    /【Monologue[\s\S]*$/g,
    /\[Monologue[\s\S]*$/g,
    /\(Monologue[\s\S]*$/g,
  ]
  for (const pattern of unclosedPatterns) {
    result = result.replace(pattern, '')
  }
  // 清理首尾多余空白
  return result.trim()
}

// ─────────────────────────────────────────────
// 文本格式工具调用解析（兜底：模型不支持 API 级 FC 时退化为文本输出）
// ─────────────────────────────────────────────

/**
 * 解析文本格式的工具调用标签
 *
 * 某些模型（如 Qwen 系列）在不支持 API 级 Function Calling 时，
 * 会在回复文本中输出如下格式的工具调用标签：
 *
 * ```xml
 * <tool_call>
 *   <function=social_get_contact_info>
 *     <parameter=user_id>3256548622</parameter>
 *   </function>
 * </tool_call>
 * ```
 *
 * 此函数将这种文本格式解析为结构化的 ToolCall 数组，
 * 让兜底逻辑能像处理 API 级 FC 一样执行工具。
 *
 * @returns 解析出的工具调用列表；无匹配返回空数组
 */
function parseTextToolCalls(text: string): Array<{
  name: string
  args: Record<string, unknown>
}> {
  const results: Array<{ name: string; args: Record<string, unknown> }> = []

  // 匹配 <tool_call>...</tool_call> 块（非贪婪，支持多个）
  const toolCallBlockRegex = /<tool_call>\s*([\s\S]*?)<\/tool_call>/gi
  let blockMatch: RegExpExecArray | null

  while ((blockMatch = toolCallBlockRegex.exec(text)) !== null) {
    const block = blockMatch[1]!
    // 匹配 <function=工具名>...</function>
    const funcMatch = /<function\s*=\s*([a-zA-Z0-9_]+)\s*>([\s\S]*?)<\/function>/i.exec(block)
    if (!funcMatch) continue

    const toolName = funcMatch[1]!
    const funcBody = funcMatch[2] ?? ''
    const args: Record<string, unknown> = {}

    // 匹配所有 <parameter=参数名>值</parameter>
    const paramRegex = /<parameter\s*=\s*([a-zA-Z0-9_]+)\s*>([\s\S]*?)<\/parameter>/gi
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRegex.exec(funcBody)) !== null) {
      const paramName = paramMatch[1]!
      const paramValue = (paramMatch[2] ?? '').trim()
      args[paramName] = paramValue
    }

    results.push({ name: toolName, args })
  }

  return results
}

/**
 * 从 LLM 回复文本中剥离工具调用标签，提取纯文本部分
 *
 * 用于将 `<tool_call>` 标签从回复中移除，
 * 避免标签文本被当作普通回复发送到社交平台。
 */
function stripToolCallTags(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*$/gi, '') // 未闭合的标签也清理
    .trim()
}

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 社交会话历史消息（应用内独立存储，不复用 Thread） */
export interface SocialHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  /** 发送者名称（role=user 时有值） */
  senderName?: string
  timestamp: string
}

/** 编译结果 */
export interface CompiledSocialContext {
  /** LLM Messages（content 支持多模态：string 或 ContentPart[]） */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }>
  /** 编译清单（调试/审计用） */
  manifest: {
    personaSource?: string
    memoryCount: number
    historyCount: number
    tokenEstimate: number
  }
}

// ─────────────────────────────────────────────
// SocialAppCompiler
// ─────────────────────────────────────────────

/**
 * 社交应用上下文编译器
 *
 * 基于 GrantRegistry 授权编译上下文，独立于主 Agent 的 ContextCompiler。
 *
 * 记忆隔离：不访问主 Agent 的 RAG（CanonicalMemory / MemoryProvider），
 * 只检索应用自己的 social.tdb（由 SocialScorer 炼化的社交图谱）。
 */
export class SocialAppCompiler {
  constructor(
    private grantRegistry: GrantRegistry,
    private agentManager: AgentManager,
    private mdpEngine: MdpEngine,
    /** 记忆存储注册表（用于访问 social.tdb，应用自己的社交图谱） */
    private storeRegistry: MemoryStoreRegistry,
  ) {}

  /**
   * 编译社交会话的上下文
   *
   * @param instanceId    应用实例 ID（GrantRegistry 查询用）
   * @param hostAgentId   主 Agent ID
   * @param history       社交会话历史（已由调用方按 DB 加载量截断，compiler 不再二次切片）
   * @param userMessage   本次用户消息
   * @param channelType   会话类型（private/group）
   * @param ownerQq       主人 QQ 号（可选，未配置时不注入主人身份信息）
   * @param isOwner       本次触发回复的消息是否来自主人（权限提示用）
   */
  async compile(params: {
    instanceId: string
    hostAgentId: string
    history: SocialHistoryMessage[]
    userMessage: string
    channelType: 'private' | 'group'
    ownerQq?: string
    isOwner?: boolean
    /** 表情包关键词列表（逗号分隔，由 StickerService.loadAgentStickers 提供） */
    stickerList?: string
    /** 可用工具描述文本（由 SocialAppRuntime 从 tools/manifest.json 格式化） */
    toolsDesc?: string
    /**
     * 跨会话上下文（群聊被 @ 时，触发者与 Agent 的最近私聊记录摘要）
     *
     * 格式：每行一条消息，形如 `[用户名]: 内容` / `[Pero]: 回复`
     * 注入到 system prompt 的独立区块，让 Agent 记得与该用户的历史互动
     */
    crossSessionContext?: string
    /** 触发者 senderId（用于跨会话上下文标注） */
    triggerSenderId?: string
    /**
     * 触发消息中包含的图片（data URL 格式：data:image/xxx;base64,...）
     *
     * 当用户在群聊/私聊中发送图片时，适配器层下载到本地后由 Bridge 转 data URL 传入。
     * compiler 将其组装为多模态 ContentPart[]，让多模态 LLM 能"看到"图片。
     */
    images?: string[]
    /**
     * Bot 自身 QQ 号（从适配器 accountInfo 获取）
     *
     * 注入到 <session_context> 中，让 Agent 知道自己的 QQ 号，
     * 用于身份识别和消息归属判断。
     */
    botSelfId?: string
    /**
     * Bot 自身昵称（从适配器 accountInfo 获取）
     *
     * 注入到 <session_context> 中，让 Agent 知道自己在平台上的昵称。
     */
    botNickname?: string
  }): Promise<CompiledSocialContext> {
    const { instanceId, hostAgentId, history, userMessage, channelType } = params
    const ownerQq = params.ownerQq
    const isOwner = params.isOwner ?? false
    const stickerList = params.stickerList
    const toolsDesc = params.toolsDesc
    const crossSessionContext = params.crossSessionContext
    const triggerSenderId = params.triggerSenderId
    const images = params.images ?? []
    const botSelfId = params.botSelfId
    const botNickname = params.botNickname

    // 1. 查询 persona 授权（只查 persona，不查 memory — subagent 不直接读主 Agent 记忆）
    const grants = await this.grantRegistry.queryGrants({
      holderId: instanceId,
      activeOnly: true,
    })

    // 2. 提取人格投影（从 persona grant）
    let systemPrompt = ''
    let personaSource: string | undefined
    let agentName = hostAgentId // 默认用 agentId，后续从 agent 对象覆盖
    const personaGrant = grants.find((g) => g.resource.kind === 'persona')
    if (personaGrant && personaGrant.permissions.includes('read')) {
      const persona = personaGrant.resource as Extract<ResourceRef, { kind: 'persona' }>
      const agent = this.agentManager.getAgent(persona.agentId)
      if (agent) {
        // 读取主 Agent 的 system_prompt.md 作为人格基础
        systemPrompt = readFileSync(agent.promptPath, 'utf-8')
        personaSource = persona.agentId
        agentName = agent.name || persona.agentId
        logger.debug(`人格投影已加载: ${persona.agentId}`)
      }
    }

    // 3. 检索应用自己的社交记忆（social.tdb，BM25 + 关键词，零 Embedding 开销）
    //    AIOS 隔离原则：subagent 不访问主 Agent 的 RAG，只查应用自己的记忆图谱
    const { memoryContext, memoryCount } = await this.searchSocialMemory(hostAgentId, userMessage)

    // 4. 渲染社交模板各片段（后续用 XML 标签嵌套组装）
    //    模板文件位于 packages/apps/social/prompts/，已通过 mdpEngine.addTemplateRoot 注册

    // 4a. 渲染表情包能力片段（填充 sticker_list 变量）
    const stickerExpression = this.mdpEngine.render('apps/social/abilities/sticker_expression', {
      sticker_list: stickerList || '（暂无可用表情包）',
    })

    // 4b. 渲染社交规则模板（安全指令 + 回复原则 + 可用能力 + 双重思考决策）
    //     不再注入 current_mode 字段：被召唤并非"必须回复"，LLM 可经双重思考后选择 PASS 跳过
    const rules = this.mdpEngine.render('apps/social/social_rules', {
      owner_qq: ownerQq || '未配置',
      available_tools_desc: toolsDesc || '（暂无可用工具）',
    })

    // 4c. 当前对话身份提示（运行时动态信息，模板中无此变量）
    //     isOwner 由适配器层识别，提示 Agent 当前对话对象是否为主人
    //     同时注入 channelType 场景信息（私聊/群聊）
    let ownerHint = ''
    if (ownerQq) {
      const scene = channelType === 'private' ? '私聊' : '群聊'
      ownerHint = isOwner
        ? `你的主人正在${scene}中和你说话，可以执行主人请求的任何操作。`
        : `当前${scene}对象不是你的主人，拒绝敏感指令。`
    }

    // 5. 用 XML 标签嵌套组装 system prompt
    //    结构顺序（从上到下）：
    //    1. <long_term_memory> 长期社交记忆（最前，跨会话炼化的图谱摘要）
    //    2. <chat_history> 聊天记录（本会话历史 + 跨会话私聊补充）
    //    3. <persona> 人格投影（system_prompt.md + 表情包能力）
    //    4. <abilities> 可用工具能力
    //    5. <social_rules> 社交规则（交互模式/安全指令/回复原则/思考决策）
    //    6. <session_context> 会话上下文（当前身份/频道类型）

    const sections: string[] = []

    // ── 1. 长期社交记忆（最前）──
    if (memoryContext) {
      sections.push(`<long_term_memory>\n${memoryContext}\n</long_term_memory>`)
    }

    // ── 2. 聊天记录（本会话历史 + 跨会话私聊补充）──
    //    历史消息交替拼成 XML 标签合在一起，不再用多轮 user/assistant messages
    //    注意：history 已由调用方 (index.ts) 按 DB 加载量截断，此处直接使用，不再二次切片
    const historyLines: string[] = []
    for (const msg of history) {
      if (msg.role === 'user') {
        const sender = msg.senderName || '用户'
        historyLines.push(`<user sender="${sender}">${msg.content}</user>`)
      } else {
        // assistant 消息是 Pero 自己发的，加 sender="self" 标识
        historyLines.push(`<assistant sender="self">${msg.content}</assistant>`)
      }
    }
    // 跨会话私聊记录（群聊被 @ 时，触发者与 Agent 的最近私聊）
    if (crossSessionContext && triggerSenderId) {
      historyLines.push(
        `<cross_session_private_chat trigger_sender="${triggerSenderId}">\n${crossSessionContext}\n</cross_session_private_chat>`,
      )
    }
    if (historyLines.length > 0) {
      sections.push(`<chat_history>\n${historyLines.join('\n')}\n</chat_history>`)
    }

    // ── 3. 人格投影（system_prompt.md + 表情包能力）──
    const personaBlock = `<persona name="${agentName}">\n${systemPrompt}\n\n${stickerExpression}\n</persona>`
    sections.push(personaBlock)

    // ── 4. 可用工具能力 ──
    if (toolsDesc) {
      sections.push(`<abilities>\n${toolsDesc}\n</abilities>`)
    }

    // ── 5. 社交规则（含思考决策指南）──
    sections.push(`<social_rules>\n${rules}\n</social_rules>`)

    // ── 6. 会话上下文（当前身份/频道类型/Bot 自身信息）──
    //     不再注入"交互模式: SUMMONED"提示：被召唤≠必须回复，LLM 可经双重思考后 PASS
    const sessionParts: string[] = [
      `当前频道类型: ${channelType === 'private' ? '私聊' : '群聊'}`,
    ]
    // Bot 自身 QQ 号和昵称（常驻上下文，让 Agent 知道自己是谁）
    if (botSelfId) {
      sessionParts.push(`你的 QQ 号: ${botSelfId}`)
    }
    if (botNickname) {
      sessionParts.push(`你的昵称: ${botNickname}`)
    }
    if (ownerQq) {
      sessionParts.push(`主人 QQ: ${ownerQq}`)
    }
    if (ownerHint) {
      sessionParts.push(`当前对话身份: ${ownerHint}`)
    }
    sections.push(`<session_context>\n${sessionParts.join('\n')}\n</session_context>`)

    // 组装最终 system prompt
    const finalSystemPrompt = sections.join('\n\n')

    // 6. 拼装 LLM Messages（只有 system + user 两条）
    //    所有历史记录已合并到 system prompt 的 <chat_history> 标签内
    //    user 角色只带本次触发的消息（combinedMessage），满足 LLM API 消息体设计
    //    如果有图片附件，user content 使用多模态 ContentPart[] 格式（text + image_url）
    const userContent: string | ContentPart[] =
      images.length > 0
        ? [
            { type: 'text' as const, text: userMessage },
            ...images.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ]
        : userMessage

    const messages: CompiledSocialContext['messages'] = [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userContent },
    ]

    // 7. 估算 Token（粗略：每 4 字符约 1 token）
    const tokenEstimate = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0)

    logger.debug(
      `上下文编译完成: instance=${instanceId}, memories=${memoryCount}, history=${history.length}, tokens≈${tokenEstimate}`,
    )

    return {
      messages,
      manifest: {
        personaSource,
        memoryCount,
        historyCount: history.length,
        tokenEstimate,
      },
    }
  }

  /**
   * 检索应用自己的社交记忆（social.tdb）
   *
   * 社交图谱由 SocialScorer 炼化，采用 PEDSA 理性轨道（RAG-less）：
   * - Event 节点：零向量 + 摘要 payload + BM25 文本索引
   * - Feature 节点：关键词 + AC 自动机索引
   *
   * 检索方式：零向量 + BM25 文本检索（searchHybrid 传零向量，纯靠文本分数）
   * 零 Embedding API 开销，适合社交高频场景。
   *
   * @returns memoryContext 格式化后的记忆文本, memoryCount 命中条数
   */
  private async searchSocialMemory(
    agentId: string,
    query: string,
  ): Promise<{ memoryContext: string; memoryCount: number }> {
    try {
      // 获取社交图谱 store（data/agent_{agentId}/social.tdb）
      const store = this.storeRegistry.getAgentStore(agentId, 'social') as TriviumDB

      // 零向量（社交图谱是 PEDSA 架构，所有节点都是零向量）
      const zeroVector = new Array(1536).fill(0)

      // searchHybrid: 向量分数（零向量→0 分）+ BM25 文本分数
      // 传入零向量后，检索结果完全由 BM25 文本相关性决定
      const hits = store.searchHybrid(zeroVector, query, 5, 2, 0.01)

      if (!hits || hits.length === 0) {
        return { memoryContext: '', memoryCount: 0 }
      }

      // 格式化记忆上下文
      const memoryLines: string[] = []
      for (const hit of hits) {
        const node = store.get(hit.id)
        if (node && node.payload?.type === 'event') {
          // 只注入 event 节点（事件摘要），不注入 feature 节点（关键词）
          const summary = String(node.payload.content ?? '')
          if (summary) {
            memoryLines.push(`- ${summary}`)
          }
        }
      }

      return {
        memoryContext: memoryLines.join('\n'),
        memoryCount: memoryLines.length,
      }
    } catch (err) {
      logger.warn(`社交记忆检索失败 (agentId=${agentId}): ${err}`)
      return { memoryContext: '', memoryCount: 0 }
    }
  }

  /**
   * 调用 LLM 生成回复
   *
   * 调试对齐：在调用 LLM 前后打印完整 prompt 与回复（与桌面模式 reactLoop 对齐），
   * 通过 sseReporter 广播到 Dashboard 终端面板，方便调试社交模式提示词。
   * 使用 info 级别确保终端面板可见（社交模式 LLM 调用频率低，不会刷屏）。
   *
   * 工具调用循环（对齐 social_rules.md 的「单轮限制」设计）：
   * 1. 第一轮调用 LLM（传入 tools 定义，让 LLM 能发起 Function Calling）
   * 2. 如果 LLM 返回 toolCalls → 逐个执行工具 → 将结果作为 role:'tool' 消息追加
   * 3. 第二轮调用 LLM（不传 tools，强制直接回复）
   * 4. 返回最终文本
   *
   * 如果 LLM 第一轮没有 toolCalls，直接返回文本（零额外开销）。
   *
   * @param messages  编译后的 LLM Messages
   * @param model     模型配置
   * @param opts      可选：工具定义列表 + 工具执行器（启用 FC 工具调用循环）
   * @returns LLM 回复文本
   */
  async generateReply(
    messages: CompiledSocialContext['messages'],
    model: ModelConfig,
    opts?: {
      /** 工具定义列表（OpenAI function calling 格式） */
      tools?: ToolDefinition[]
      /** 工具执行器：根据工具名执行，返回结果 JSON 字符串 */
      toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>
    },
  ): Promise<string> {
    // ── 打印完整 prompt 供调试（对齐桌面模式 reactLoop 的 [Prompt] 标签）──
    logger.info(`[Social LLM] 调用模型: ${model.modelId}, messages=${messages.length} 条`)
    for (const msg of messages) {
      // 多模态 content（ContentPart[]）摘要显示：图片只展示类型和大小，不打印 base64
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((part) => {
                if (part.type === 'image_url') {
                  const url = part.image_url.url
                  // data:image/jpeg;base64,/9j/... → 显示格式和长度
                  const match = /^data:([^;]+);base64,/.exec(url)
                  const mime = match?.[1] ?? 'unknown'
                  return `[image: ${mime}, ${url.length} 字符]`
                }
                if (part.type === 'text') return part.text
                return JSON.stringify(part)
              })
              .join('\n')
      if (msg.role === 'system') {
        logger.info(`[Social Prompt] System:\n${truncate(content, 8000)}`)
      } else if (msg.role === 'user') {
        logger.info(`[Social Prompt] User: ${truncate(content, 4000)}`)
      } else {
        logger.info(`[Social Prompt] Assistant: ${truncate(content, 2000)}`)
      }
    }

    const tools = opts?.tools
    const toolExecutor = opts?.toolExecutor

    // 构建可变的 ChatMessage[]（工具调用循环需要追加 assistant + tool 消息）
    const llmMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // ── 第一轮 LLM 调用（传入 tools 让 LLM 能发起 FC）──
    const completion = await this.llmService.chat(model, llmMessages, {
      temperature: 0.7,
      tools: tools?.length ? tools : undefined,
    })

    const choice = completion.choices[0]
    if (!choice) {
      logger.warn('[Social LLM] 无回复')
      return ''
    }

    const assistantMsg = choice.message
    const toolCalls: ToolCall[] | undefined = assistantMsg.toolCalls

    // ── 无 API 级工具调用 → 检查文本格式兜底 ──
    // 某些模型（如 Qwen 系列）不支持 API 级 FC，会在回复文本中输出 <tool_call> 标签。
    // 此兜底逻辑解析文本格式工具调用，避免标签被当作普通回复发到社交平台。
    if ((!toolCalls?.length || !toolExecutor) && toolExecutor) {
      const rawText = assistantMsg.content ?? ''
      const textToolCalls = parseTextToolCalls(rawText)

      if (textToolCalls.length > 0) {
        // 检测到文本格式工具调用，走兜底执行流程
        logger.info(
          `[Social LLM] 检测到文本格式工具调用（模型未走 API 级 FC）: ${textToolCalls.length} 个`,
        )

        // 将剥离标签后的文本作为 assistant 消息（可能为空）
        const strippedText = stripToolCallTags(rawText)
        llmMessages.push({
          role: 'assistant',
          content: strippedText || null,
        })

        // 逐个执行工具，将结果作为 user 消息追加（文本格式无 toolCallId，用 user 角色）
        // 同时收集工具返回的图片（social_read_image 工具会返回 images 字段）
        const textCollectedImages: string[] = []
        for (const tc of textToolCalls) {
          logger.info(
            `[Social Tool] 执行(文本兜底): ${tc.name}, args=${truncate(JSON.stringify(tc.args), 200)}`,
          )
          const result = await toolExecutor(tc.name, tc.args)
          logger.info(`[Social Tool] 结果: ${truncate(result, 2000)}`)

          // 检测工具返回值中是否包含图片 data URL
          const imgUrls = extractImagesFromToolResult(result)
          if (imgUrls.length > 0) {
            textCollectedImages.push(...imgUrls)
            logger.info(
              `[Social Tool] ${tc.name} 返回 ${imgUrls.length} 张图片，将注入多模态输入`,
            )
          }

          llmMessages.push({
            role: 'user',
            content: `[工具结果 ${tc.name}]: ${result}`,
          })
        }

        // 如果工具返回了图片，追加一条包含多模态 content 的 user 消息
        if (textCollectedImages.length > 0) {
          llmMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: '以下是工具读取到的图片：' },
              ...textCollectedImages.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          })
        }

        // 二次调用 LLM 生成最终回复（不传 tools，强制直接回复）
        const completion2 = await this.llmService.chat(model, llmMessages, {
          temperature: 0.7,
        })
        const reply = stripThinkingBlocks(completion2.choices[0]?.message?.content ?? '')
        logger.info(`[Social LLM回复] ${truncate(reply, 4000)}`)
        return reply
      }
    }

    // ── 无工具调用（API 级 + 文本格式都没有）→ 直接返回文本 ──
    if (!toolCalls?.length || !toolExecutor) {
      const reply = stripThinkingBlocks(assistantMsg.content ?? '')
      logger.info(`[Social LLM回复] ${truncate(reply, 4000)}`)
      return reply
    }

    // ── 有工具调用 → 进入 ReAct 循环（最多 5 轮）──
    // 每轮：执行工具 → 将结果加入 messages → 调用 LLM → 检查是否还需调用工具
    logger.info(`[Social LLM] 收到 ${toolCalls.length} 个工具调用请求，进入 ReAct 循环`)

    // 将 assistant 消息（含 toolCalls）加入 messages
    // 必须携带 toolCalls，否则后续 role:'tool' 消息会成为「孤儿消息」被 API 报错
    llmMessages.push({
      role: 'assistant',
      content: assistantMsg.content,
      toolCalls: toolCalls,
    })

    const MAX_REACT_TURNS = 5
    let currentToolCalls: ToolCall[] | undefined = toolCalls

    for (let turn = 1; turn <= MAX_REACT_TURNS; turn++) {
      logger.info(`[Social ReAct] 第 ${turn}/${MAX_REACT_TURNS} 轮: 执行 ${currentToolCalls!.length} 个工具`)

      // 逐个执行工具，将结果作为 tool 消息加入 messages
      // 同时收集工具返回的图片（social_read_image 工具会返回 images 字段）
      const collectedImages: string[] = []
      for (const tc of currentToolCalls!) {
        const toolName = tc.function.name
        // 解析工具参数（LLM 返回的是 JSON 字符串）
        let args: Record<string, unknown>
        try {
          args = JSON.parse(tc.function.arguments || '{}')
        } catch {
          args = {}
        }
        logger.info(
          `[Social Tool] 执行: ${toolName}, args=${truncate(JSON.stringify(args), 200)}`,
        )
        const result = await toolExecutor(toolName, args)
        logger.info(`[Social Tool] 结果: ${truncate(result, 2000)}`)

        // 检测工具返回值中是否包含图片 data URL
        // social_read_image 工具返回 { success, count, images: [...] } 格式
        const images = extractImagesFromToolResult(result)
        if (images.length > 0) {
          collectedImages.push(...images)
          logger.info(`[Social Tool] ${toolName} 返回 ${images.length} 张图片，将注入多模态输入`)
        }

        llmMessages.push({
          role: 'tool',
          content: result,
          toolCallId: tc.id,
        })
      }

      // 如果工具返回了图片，追加一条 user 消息包含多模态 content
      // role:'tool' 消息只能携带字符串 content，图片必须通过 user 消息注入
      if (collectedImages.length > 0) {
        const imageContent: ContentPart[] = [
          { type: 'text', text: '以下是工具读取到的图片：' },
          ...collectedImages.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ]
        llmMessages.push({
          role: 'user',
          content: imageContent,
        })
      }

      // 调用 LLM（最后一轮不传 tools，强制直接回复；非最后一轮继续传 tools）
      const isLastTurn = turn === MAX_REACT_TURNS
      const turnCompletion = await this.llmService.chat(model, llmMessages, {
        temperature: 0.7,
        // 最后一轮不传 tools，强制 LLM 直接回复
        tools: isLastTurn ? undefined : (tools?.length ? tools : undefined),
      })

      const turnMsg = turnCompletion.choices[0]?.message
      if (!turnMsg) {
        logger.warn(`[Social ReAct] 第 ${turn} 轮无回复`)
        return ''
      }

      // 检查是否还有工具调用
      const nextToolCalls: ToolCall[] | undefined = turnMsg.toolCalls

      if (!nextToolCalls?.length || isLastTurn) {
        // 没有更多工具调用，或已到最大轮次 → 返回最终回复
        const reply = stripThinkingBlocks(turnMsg.content ?? '')
        logger.info(
          `[Social ReAct] 循环结束（第 ${turn} 轮），最终回复: ${truncate(reply, 4000)}`,
        )
        return reply
      }

      // 还有工具调用 → 将 assistant 消息（含 toolCalls）加入 messages，继续下一轮
      logger.info(`[Social ReAct] 第 ${turn} 轮触发 ${nextToolCalls.length} 个新工具调用，继续循环`)
      llmMessages.push({
        role: 'assistant',
        content: turnMsg.content,
        toolCalls: nextToolCalls,
      })
      currentToolCalls = nextToolCalls
    }

    // 理论上不会走到这里（循环内会 return），但作为安全兜底
    return ''
  }

  // LlmService 通过构造函数注入更合理，这里临时持有
  private _llmService?: LlmService

  /** 设置 LLM 服务（由 runtime.initialize 时注入） */
  setLlmService(llmService: LlmService): void {
    this._llmService = llmService
  }

  /** 获取 LLM 服务 */
  private get llmService(): LlmService {
    if (!this._llmService) {
      throw new Error('LlmService 未注入，请先调用 setLlmService')
    }
    return this._llmService
  }
}
