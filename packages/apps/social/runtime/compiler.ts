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

import type {
  AgentManager,
  ContentPart,
  GrantRegistry,
  LlmService,
  MdpEngine,
  MemoryStoreRegistry,
  ModelConfig,
  ResourceRef,
} from '@infos/backend/applicationHostAbi'
import type { TriviumDB } from 'triviumdb'
import { runSocialGeneration, type SocialGenerationOptions } from './socialGeneration'
import { readFileSync } from 'node:fs'
import { createLogger, tokenCounter } from '@infos/backend/applicationHostAbi'

const logger = createLogger('SocialAppCompiler')

/** 图片只通过多模态部分传递，避免 base64 同时成为巨量文字输入。 */
function compactImageToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.images)) return result
    const { images, ...text } = parsed
    return JSON.stringify({ ...text, imageCount: images.length })
  } catch {
    return result
  }
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

function parseTerminalAcceptance(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as { success?: unknown; terminal?: unknown }
    return parsed.success === true && parsed.terminal === true
  } catch {
    return false
  }
}

/**
 * 过滤 LLM 回复中的思考块
 *
 * 思考块统一使用 XML 标签格式：`<think>...</think>`。
 * 过滤规则（多层兜底，防止思考内容外泄到社交平台）：
 * - 标准闭合：`<think>...</think>`（含标签内多行、嵌套文本）
 * - 变体标签：thinking / Think / THINK（大小写不敏感）
 * - 未闭合的块（只有 <think> 没有 </think>）整体删除（防止 LLM 输出格式错误）
 */
function stripThinkingBlocks(text: string): string {
  let result = text

  // 1. 标准闭合块：<think>...</think>（非贪婪匹配，忽略大小写，可跨行）
  result = result.replace(/<think[\s\S]*?<\/think>/gi, '')

  // 2. 未闭合块：只有 <think> 开始标签，没有 </think> → 删除到末尾
  result = result.replace(/<think[\s\S]*$/gi, '')

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

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 社交会话历史消息（应用内独立存储，不复用 Thread） */
export interface SocialHistoryMessage {
  key?: string
  role: 'user' | 'assistant'
  content: string
  /** 发送者名称（role=user 时有值） */
  senderName?: string
  senderId?: string
  timestamp: string
}

/** 编译结果 */
export interface CompiledSocialContext {
  variableCommit?: import('@infos/shared').PromptVariableCommit
  currentMessageIndex?: number
  historyMessageIndices?: number[]
  /** LLM Messages（content 支持多模态：string 或 ContentPart[]） */
  messages: import('@infos/backend/applicationHostAbi').ChatMessage[]
  /** 编译清单（调试/审计用） */
  manifest: {
    promptRevision?: string
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
    private canReadMemory?: (agentId: string) => Promise<boolean>,
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
    variableSessionId?: string
    modelName?: string
    modelContextTokens?: number
    modelOutputTokens?: number
    instanceId: string
    hostAgentId: string
    history: SocialHistoryMessage[]
    userMessage: string
    channelType: 'private' | 'group'
    ownerQq?: string
    isOwner?: boolean
    /** 当前私有会话的心流数据，协议由共用能力组件渲染。 */
    flowState?: { currentGoal: string; privateFacts: string }
    /** 当前社交账号是否可以使用收藏表情。 */
    stickersAvailable?: boolean
    /**
     * 跨会话上下文（群聊被 @ 时，触发者与 Agent 的最近私聊记录摘要）
     *
     * 格式：每行一条消息，形如 `[用户名]: 内容` / `[Pero]: 回复`
     * 注入到 system prompt 的独立区块，让 Agent 记得与该用户的历史互动
     */
    crossSessionContext?: string
    /** 当前主要交互对象的持久联系人印象。 */
    contactImpression?: {
      userId: string
      displayName?: string
      identity?: string
      impression: string
    }
    /** 触发者 senderId（用于跨会话上下文标注） */
    triggerSenderId?: string
    triggerSenderName?: string
    /**
     * 触发消息中包含的图片（data URL 格式：data:image/xxx;base64,...）
     *
     * 当用户在群聊/私聊中发送图片时，适配器层下载到本地后由 Bridge 转 data URL 传入。
     * compiler 将其组装为多模态 ContentPart[]，让多模态 LLM 能"看到"图片。
     */
    images?: string[]
    imageSources?: string[]
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
    /**
     * 用户自定义称呼（如 主人/哥哥/老师），默认"主人"
     *
     * 用于渲染社交规则与身份提示中的称呼占位符，与主提示词人格框架保持一致。
     */
    ownerAppellation?: string
    /**
     * 主人在主 app 中登记的名称（owner.name），默认"用户"
     *
     * 与 ownerAppellation 语义不同：
     * - ownerName：主人的名字，用于客观/中性指代
     * - ownerAppellation：角色对主人的亲密称呼，用于直接对话/呼叫
     * 社交规则模板中会同时注入两者并明确区分，避免 Agent 混淆。
     */
    ownerName?: string
  }): Promise<CompiledSocialContext> {
    const promptSnapshot = this.mdpEngine.capturePromptSnapshot?.()
    const { instanceId, hostAgentId, history, userMessage, channelType } = params
    const ownerQq = params.ownerQq
    const crossSessionContext = params.crossSessionContext
    const contactImpression = params.contactImpression
    const triggerSenderId = params.triggerSenderId
    const isOwner = Boolean(ownerQq && triggerSenderId && triggerSenderId === ownerQq)
    const images = params.images ?? []
    const botSelfId = params.botSelfId
    const botNickname = params.botNickname
    // 用户自定义称呼（如 主人/哥哥/老师），默认"主人"
    const ownerAppellation = params.ownerAppellation ?? '主人'
    // 主人在主 app 中登记的名称，默认"用户"（与称呼区分，用于客观/中性指代）
    const ownerName = params.ownerName ?? '用户'

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
    const { memoryContext, memoryCount } =
      !this.canReadMemory || (await this.canReadMemory(hostAgentId))
        ? await this.searchSocialMemory(hostAgentId, userMessage)
        : { memoryContext: '', memoryCount: 0 }

    // 4. 渲染社交模板各片段（后续用 XML 标签嵌套组装）
    //    模板文件位于 packages/apps/social/prompts/，已通过 mdpEngine.addTemplateRoot 注册

    // 4a. 注入当前账号的表情使用协议，不加载角色预设或全量收藏。
    const stickerExpression =
      params.stickersAvailable && !this.mdpEngine.managedFramework
        ? this.mdpEngine.render('apps/social/abilities/sticker_expression', {})
        : ''

    // 4b. 渲染社交规则模板（安全指令 + 回复原则 + 可用能力 + 双重思考决策）
    //     不再注入 current_mode 字段：被召唤并非"必须回复"，LLM 可经双重思考后选择 PASS 跳过
    const rules = this.mdpEngine.managedFramework
      ? ''
      : this.mdpEngine.render('apps/social/social_rules', {
          owner_qq: ownerQq || '未配置',
          owner_appellation: ownerAppellation,
          owner_name: ownerName,
        })

    // 主人身份只由可信 QQ 标识确定，人设称呼、联系人印象与其他人的发言不改变身份。
    const ownerHint = !ownerQq
      ? '尚未绑定主人 QQ，当前联系人不能被识别为主人；不要对普通联系人使用主人专属称呼。'
      : isOwner
        ? `当前主要对话对象是你的${ownerAppellation}。同批其他发送者仍是普通联系人；操作须遵守本轮工具权限。`
        : `当前主要对话对象不是你的${ownerAppellation}。按对方昵称自然称呼，不要称其为${ownerAppellation}；不能代替主人授权敏感操作。`

    // 5. 用 XML 标签嵌套组装 system prompt
    //    结构顺序（从上到下）：
    //    1. <long_term_memory> 长期社交记忆（最前，跨会话炼化的图谱摘要）
    //    2. <chat_history> 聊天记录（本会话历史 + 跨会话私聊补充）
    //    3. <persona> 人格投影（system_prompt.md + 表情包能力）
    //    4. <social_rules> 社交规则（交互模式/安全指令/回复原则/思考决策）
    //    5. <session_context> 会话上下文（当前身份/频道类型）

    const sections: string[] = []

    // ── 1. 长期社交记忆（最前）──
    if (memoryContext) {
      sections.push(`<long_term_memory>\n${memoryContext}\n</long_term_memory>`)
    }

    // ── 2. 聊天记录（本会话历史 + 跨会话私聊补充）──
    //    历史消息交替拼成 XML 标签合在一起，不再用多轮 user/assistant messages
    //    注意：history 已由调用方 (index.ts) 按 DB 加载量截断，此处直接使用，不再二次切片
    const historyLines: string[] = []
    if (contactImpression) {
      const displayName = escapeXmlAttribute(
        contactImpression.displayName || contactImpression.userId,
      )
      const identity = contactImpression.identity
        ? `\n<identity>${escapeXmlText(contactImpression.identity)}</identity>`
        : ''
      historyLines.push(
        `<contact_context user_id="${escapeXmlAttribute(contactImpression.userId)}" display_name="${displayName}">${identity}\n<impression>${escapeXmlText(contactImpression.impression)}</impression>\n</contact_context>`,
      )
    }
    // 跨会话私聊记录放在最前面（群聊消息之前）：
    // 群聊被 @ 时，先给 Agent 补充"触发者与 Agent 的最近私聊"作为背景，
    // 再展示当前群聊的聊天记录，让 Agent 先回忆起与该用户的私交，再处理群聊话题
    if (crossSessionContext && triggerSenderId) {
      historyLines.push(
        `<cross_session_private_chat trigger_sender="${escapeXmlAttribute(triggerSenderId)}">\n${escapeXmlText(crossSessionContext)}\n</cross_session_private_chat>`,
      )
    }
    for (const msg of history) {
      if (msg.role === 'user') {
        const sender = msg.senderName || '用户'
        const identity = ownerQq && msg.senderId === ownerQq ? '主人' : '普通联系人'
        historyLines.push(
          `<user sender="${escapeXmlAttribute(sender)}" user_id="${escapeXmlAttribute(msg.senderId ?? '未知')}" identity="${identity}">${escapeXmlText(msg.content)}</user>`,
        )
      } else {
        // assistant 消息是 Pero 自己发的，加 sender="self" 标识
        historyLines.push(`<assistant sender="self">${escapeXmlText(msg.content)}</assistant>`)
      }
    }
    if (historyLines.length > 0) {
      sections.push(`<chat_history>\n${historyLines.join('\n')}\n</chat_history>`)
    }

    // ── 3. 人格投影与当前账号能力分别注入，收藏不属于角色预设。──
    const personaBlock = `<persona name="${agentName}">\n${systemPrompt}\n</persona>`
    sections.push(personaBlock)
    if (stickerExpression)
      sections.push(`<account_stickers>\n${stickerExpression}\n</account_stickers>`)

    // ── 4. 心流：Social 独立 Compiler 读取统一状态，但不复用主 ContextCompiler ──
    if (params.flowState) {
      const flowProtocol = this.mdpEngine.render(
        'components/abilities/private_flow_protocol',
        {
          agent_id: hostAgentId,
          agent_name: agentName,
          channel: 'social',
          owner_appellation: ownerAppellation,
          flow_state: params.flowState,
          append_turn_context: true,
        },
        promptSnapshot,
      )
      if (flowProtocol) sections.push(`<abilities>\n${flowProtocol}\n</abilities>`)
    }

    // ── 5. 社交规则（含思考决策指南）──
    sections.push(`<social_rules>\n${rules}\n</social_rules>`)

    // ── 6. 会话上下文（当前身份/频道类型/Bot 自身信息）──
    //     不再注入"交互模式: SUMMONED"提示：被召唤≠必须回复，LLM 可经双重思考后 PASS
    const sessionParts: string[] = [`当前频道类型: ${channelType === 'private' ? '私聊' : '群聊'}`]
    if (triggerSenderId) sessionParts.push(`当前主要对话对象 QQ: ${triggerSenderId}`)
    if (params.triggerSenderName)
      sessionParts.push(`当前主要对话对象昵称: ${JSON.stringify(params.triggerSenderName)}`)
    // Bot 自身 QQ 号和昵称（常驻上下文，让 Agent 知道自己是谁）
    if (botSelfId) {
      sessionParts.push(`你的 QQ 号: ${botSelfId}`)
    }
    if (botNickname) {
      sessionParts.push(`你的昵称: ${botNickname}`)
    }
    if (ownerQq) {
      // 名称与称呼分开展示，避免 Agent 把"主人名字"和"你对主人的称呼"混为一谈
      sessionParts.push(`主人名称: ${ownerName}`)
      sessionParts.push(`你对主人的称呼: ${ownerAppellation}`)
      sessionParts.push(`主人 QQ: ${ownerQq}`)
    }
    if (ownerHint) {
      sessionParts.push(`当前对话身份: ${ownerHint}`)
    }
    sections.push(`<session_context>\n${sessionParts.join('\n')}\n</session_context>`)

    // 独立应用没有受管理框架时，同样只把稳定规则放在 system 前缀。
    const finalSystemPrompt = sections
      .filter((section) => !/^<(?:long_term_memory|chat_history|session_context)>/.test(section))
      .join('\n\n')

    // 6. 拼装 LLM Messages（只有 system + user 两条）
    //    所有历史记录已合并到 system prompt 的 <chat_history> 标签内
    //    user 角色只带本次触发的消息（combinedMessage），满足 LLM API 消息体设计
    //    如果有图片附件，user content 使用多模态 ContentPart[] 格式（text + image_url）
    const userContent: string | ContentPart[] =
      images.length > 0
        ? [
            { type: 'text' as const, text: userMessage },
            ...images.flatMap((url, index) => [
              {
                type: 'text' as const,
                text: `图片 ${index + 1} 来源：${params.imageSources?.[index] ?? '本次消息'}`,
              },
              { type: 'image_url' as const, image_url: { url } },
            ]),
          ]
        : userMessage

    const promptVars = {
      agent_name: agentName,
      is_group: channelType === 'group',
      persona_definition: systemPrompt,
      owner_name: ownerName,
      owner_appellation: ownerAppellation,
      owner_qq: ownerQq || '未配置',
      memory_context: memoryContext,
      conversation_history: historyLines.join('\n'),
      native_history: history.map((message) => ({
        role: message.role,
        content:
          message.role === 'user'
            ? `[${JSON.stringify(message.senderName ?? '用户')} QQ:${message.senderId ?? '未知'} 身份:${ownerQq && message.senderId === ownerQq ? '主人' : '普通联系人'}]: ${message.content}`
            : message.content,
      })),
      current_message: { role: 'user', content: userContent },
      generation_type: 'normal',
      flow_state: params.flowState,
      stickers_available: Boolean(params.stickersAvailable),
      social_session: sessionParts.join('\n'),
      social_context: historyLines
        .filter((line) => !line.startsWith('<user ') && !line.startsWith('<assistant '))
        .join('\n'),
      model: params.modelName ?? '',
      max_context_tokens: params.modelContextTokens ?? 0,
      max_response_tokens: params.modelOutputTokens ?? 0,
      max_prompt: Math.max(0, (params.modelContextTokens ?? 0) - (params.modelOutputTokens ?? 0)),
    }
    const managed = await this.mdpEngine.prepareManagedFramework?.(
      'social',
      hostAgentId,
      promptVars,
      promptSnapshot,
      params.variableSessionId,
    )
    const managedMessages =
      managed?.messages ??
      this.mdpEngine.managedFramework?.('social', hostAgentId, promptVars, promptSnapshot)
    const messages: CompiledSocialContext['messages'] = [
      ...(managedMessages?.map((message, index) => ({
        role: message.role,
        content: message.nativeContent ?? message.content,
        ...(message.historyMessage
          ? {
              cacheControl: {
                kind: 'history' as const,
                key: history[
                  managedMessages.slice(0, index).filter((entry) => entry.historyMessage).length
                ]?.key,
              },
            }
          : {}),
      })) ?? [
        { role: 'system' as const, content: finalSystemPrompt },
        ...promptVars.native_history.map((message, index) => ({
          ...message,
          cacheControl: { kind: 'history' as const, key: history[index]?.key },
        })),
        {
          role: 'user' as const,
          content: this.mdpEngine.render(
            'components/state/turn_context',
            promptVars,
            promptSnapshot,
          ),
        },
      ]),
      ...(managedMessages?.some((message) => message.currentMessage)
        ? []
        : [{ role: 'user' as const, content: userContent }]),
    ]

    // 7. 使用后端统一 o200k_base Tokenizer 计算消息正文。
    const tokenEstimate = tokenCounter.countMessages(messages)
    logger.debug(
      `上下文编译完成: instance=${instanceId}, memories=${memoryCount}, history=${history.length}, tokens=${tokenEstimate}`,
    )

    return {
      messages,
      variableCommit: managed?.variableCommit,
      currentMessageIndex: managedMessages?.some((message) => message.currentMessage)
        ? managedMessages.findIndex((message) => message.currentMessage)
        : messages.length - 1,
      historyMessageIndices:
        managedMessages?.flatMap((message, index) => (message.historyMessage ? [index] : [])) ?? [],
      manifest: {
        promptRevision:
          promptSnapshot && typeof promptSnapshot === 'object' && 'id' in promptSnapshot
            ? String(promptSnapshot.id)
            : undefined,
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
   * 检索方式：零向量占位 + BM25/关键词召回 + 图谱扩散，不生成语义向量。
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

      // 仅作检索接口占位，不调用 Embedding；重建或切换配置后以当前库的实际维度为准。
      const zeroVector = new Array(store.dim()).fill(0)

      // 即使侧重文本召回，searchHybrid 仍会校验占位数组长度，不能传入其他库的维度。
      const hits = store.searchHybrid(zeroVector, query, 5, 2, 0.01, 0)

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
  async commitVariables(change: import('@infos/shared').PromptVariableCommit): Promise<void> {
    if (!this.mdpEngine.commitPromptVariables) throw new Error('酒馆变量提交服务不可用')
    await this.mdpEngine.commitPromptVariables(change)
  }

  async generateReply(
    messages: CompiledSocialContext['messages'],
    model: ModelConfig,
    opts: SocialGenerationOptions = {},
  ): Promise<string> {
    return runSocialGeneration(this.llmService, messages, model, opts, {
      parseTextToolCalls,
      stripThinkingBlocks,
      stripToolCallTags,
      compactImageToolResult,
      extractImagesFromToolResult,
      parseTerminalAcceptance,
    })
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
