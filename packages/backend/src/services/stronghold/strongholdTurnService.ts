/**
 * strongholdTurnService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import type { ConfigRepository } from '../../repositories/config.repo'
import type { AgentService } from '../agent/agentService'
import type { ContextCompiler } from '../context/contextCompiler'
import type { GatewayHub } from '../gateway/gatewayHub'
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  loadMemoryRuntimeConfig,
} from '../memory/memoryRuntimeConfig'
import type { ThreadService } from '../thread/threadService'
import type { GroupChatService } from './groupChatService'
import type { StrongholdService } from './strongholdService'
import type { ReActYield } from '../agent/reactLoop'
import type { AgentManager } from '../agent/agentManager'
import { createLogger } from '../../lib/logger'

const logger = createLogger('StrongholdTurnService')

/** 据点Agent回合用例层；统一编排Context、LLM、消息事实、Scorer与Surface事件。 */
export class StrongholdTurnService {
  constructor(
    private readonly stronghold: StrongholdService,
    private readonly groupChat: GroupChatService,
    private readonly threads: ThreadService,
    private readonly context: ContextCompiler,
    private readonly agents: AgentService,
    private readonly config: ConfigRepository,
    private readonly gateway: GatewayHub,
    private readonly agentManager: AgentManager,
  ) {}

  async execute(
    roomId: string,
    agentId: string,
    pairId?: string,
    options: {
      allowSummon?: boolean
      summonedBy?: string
      summonReason?: string
      roundId?: string
    } = {},
  ): Promise<{ summonedAgentIds: string[]; summonReason?: string }> {
    if (pairId && !(await this.groupChat.isPairActive(roomId, pairId))) {
      return { summonedAgentIds: [] }
    }
    const room = await this.stronghold.getRoom(roomId)
    if (!room) throw new Error(`房间 ${roomId} 不存在`)
    const memoryConfig = this.config
      ? await loadMemoryRuntimeConfig(this.config)
      : DEFAULT_MEMORY_RUNTIME_CONFIG
    const history = await this.groupChat.getVisibleHistoryPairs(
      agentId,
      memoryConfig.channels.group.contextPairs,
    )
    const ownerName = this.config ? ((await this.config.get('owner.name')) ?? '用户') : '用户'
    const perspective = this.groupChat.convertPerspective(history, agentId, ownerName)
    const threadId = `stronghold_${roomId}_${agentId}`
    let thread = await this.threads.getThread(threadId)
    if (!thread) {
      thread = await this.threads.createThread({
        id: threadId,
        agentId,
        channel: 'group',
        platform: 'stronghold',
        platformIdentifier: `${roomId}:${agentId}`,
        title: `${room.name} - ${agentId}`,
      })
    }
    const retrievalQuery =
      [...perspective].reverse().find((message) => message.role === 'user')?.content ?? ''
    const compiled = await this.context.compile(thread.id, agentId, {
      retrievalQuery,
      appendThreadMessages: false,
    })
    const roomAgents = await this.stronghold.getRoomAgents(roomId)
    const memberProfiles = this.formatRoomMemberProfiles(agentId, roomAgents)
    const summonedAgentIds: string[] = []
    let summonReason: string | undefined
    const environment = JSON.parse(room.environmentJson ?? '{}') as Record<string, unknown>
    const roundId = options.roundId ?? pairId ?? `${roomId}:${Date.now()}`
    const push = (action: string, payload: Record<string, unknown>) =>
      this.gateway.broadcast({
        protocolVersion: 1,
        type: 'push',
        id: '',
        sourceId: 'backend',
        targetId: 'broadcast',
        payload: { action, roomId, roundId, pairId, agentId, ...payload },
        timestamp: Date.now(),
      })
    await push('stronghold_agent_started', {})
    let reply = ''
    const stream = this.agents.chatStreamWithCompiledMessages({
      agentId,
      channel: 'group',
      threadId,
      messages: [
        ...compiled.messages,
        {
          role: 'system',
          content:
            `当前据点房间：${room.name}\n` +
            `房间说明：${room.description ?? '无'}\n` +
            `房间环境：${JSON.stringify(environment)}\n` +
            `当前在场角色ID列表：${roomAgents.join('、') || '无'}\n` +
            `${memberProfiles}\n` +
            `公开档案只描述其他角色允许共享的稳定信息，不代表对方当前想法，也不要逐项复述。\n` +
            `你只能将这些ID用于据点工具参数。\n` +
            `如果你在本回合移动房间，本次回复仍会发送到当前房间；新房间上下文从下一回合开始生效。` +
            (options.allowSummon === false
              ? options.summonedBy
                ? `\n你是由${options.summonedBy}传唤加入本轮的角色，本次禁止继续传唤其他角色。` +
                  (options.summonReason ? `\n传唤原因：${options.summonReason}` : '')
                : '\n你是本轮后续发言角色，本次禁止继续传唤其他角色。'
              : ''),
        },
        ...perspective,
        {
          role: 'system',
          content:
            `当前据点回合由系统调度你发言。历史中的每条消息均以真实发言者名称作为XML标签：` +
            `<${ownerName}>表示主人，<${agentId}>表示你自己，其他角色名标签表示对应角色。` +
            `不要把最近一条其他角色消息误认为主人的新发言；请根据标签判断回应对象。` +
            `请根据据点群聊上下文发言，保持角色人设；不需要发言时回复空。`,
        },
      ],
      pairId,
      disabledTools: options.allowSummon === false ? ['stronghold_summon_agents'] : undefined,
      onToolCalls: (toolCalls) => {
        for (const call of toolCalls) {
          if (call.name !== 'stronghold_summon_agents' || call.isError) continue
          try {
            const result = JSON.parse(call.result) as {
              success?: boolean
              queued_agent_ids?: unknown[]
            }
            if (!result.success || !Array.isArray(result.queued_agent_ids)) continue
            const requestedReason = call.args.reason
            if (typeof requestedReason === 'string' && requestedReason.trim()) {
              summonReason = requestedReason.trim().slice(0, 500)
            }
            for (const id of result.queued_agent_ids) {
              if (typeof id === 'string') summonedAgentIds.push(id)
            }
          } catch {
            logger.warn('忽略无法解析的据点传唤工具结果', { agentId, roomId })
          }
        }
      },
    })
    for await (const event of stream) {
      if (event.event === 'narration_delta') {
        reply += event.data.delta
        await push('stronghold_agent_delta', { delta: event.data.delta })
      } else if (event.event === 'tool_call_ready') {
        await push('stronghold_agent_tool_started', { toolName: event.data.name })
      } else if (event.event === 'tool_result') {
        await push('stronghold_agent_tool_completed', {
          result: this.describeToolResult(event),
        })
      }
    }
    if (!reply?.trim()) throw new Error('角色本轮没有生成可见回复')
    if (pairId && !(await this.groupChat.isPairActive(roomId, pairId))) {
      return { summonedAgentIds: [] }
    }
    const message = await this.groupChat.sendMessage({
      roomId,
      senderId: agentId,
      content: reply,
      role: 'assistant',
      pairId,
    })
    if (retrievalQuery) {
      await this.threads.saveMessagePair({
        threadId,
        agentId,
        userContent: retrievalQuery,
        assistantContent: reply,
        pairId,
      })
    }
    await push('stronghold_agent_completed', {
      messageId: message.id,
      content: reply,
      role: 'assistant',
      timestamp: message.timestamp,
    })
    logger.info('据点Agent回合已完成', { roomId, agentId })
    return { summonedAgentIds: [...new Set(summonedAgentIds)], summonReason }
  }

  private formatRoomMemberProfiles(observerAgentId: string, roomAgentIds: string[]): string {
    const members = roomAgentIds
      .filter((targetAgentId) => targetAgentId !== observerAgentId)
      .map((targetAgentId) => this.agentManager.getAgent(targetAgentId))
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .map((profile) => {
        const publicProfile = profile.publicProfile ?? {}
        const fields = [
          publicProfile.gender ? `<gender>${this.escapeXml(publicProfile.gender)}</gender>` : '',
          publicProfile.identity
            ? `<identity>${this.escapeXml(publicProfile.identity)}</identity>`
            : '',
          publicProfile.appearance
            ? `<appearance>${this.escapeXml(publicProfile.appearance)}</appearance>`
            : '',
          publicProfile.personality
            ? `<personality>${this.escapeXml(publicProfile.personality)}</personality>`
            : '',
        ].filter(Boolean)
        if (fields.length === 0 && profile.description) {
          fields.push(`<description>${this.escapeXml(profile.description)}</description>`)
        }
        return `<member id="${this.escapeXml(profile.id)}" name="${this.escapeXml(profile.name)}">${fields.join('')}</member>`
      })
    return `<room_member_profiles observer="${this.escapeXml(observerAgentId)}">${members.join('')}</room_member_profiles>`
  }

  private escapeXml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  }

  private describeToolResult(event: ReActYield): string {
    if (event.event !== 'tool_result' || !event.data || typeof event.data !== 'object') return ''
    const data = event.data as Record<string, unknown>
    return String(data.output ?? data.result ?? '').slice(0, 160)
  }
}
