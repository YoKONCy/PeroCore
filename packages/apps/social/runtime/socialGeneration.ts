import type {
  ChatMessage,
  ChatOptions,
  ChatCompletion,
  LlmService,
  ModelConfig,
  ToolCall,
  ToolDefinition,
} from '@infos/backend/applicationHostAbi'
import {
  modelOutputReservation,
  preparePromptReplay,
  canonicalTools,
  trimOldestPromptRound,
  promptMessagesForPersistence,
} from '@infos/backend/applicationHostAbi'
import { currentSocialRecovery, socialDelay, socialFailure } from './socialRecovery'

type Message = ChatMessage & { pinned?: boolean; history?: boolean }
interface GenerationState {
  messages: Message[]
  round: number
  pending?: ToolCall[]
  textTools?: boolean
  index: number
  toolStarted?: boolean
  retries: number
  continuations: number
  prefix: string
  reply?: string
}
export interface SocialGenerationOptions {
  replayScope?: string
  replayCurrentKeys?: string[]
  replayReply?: () => string
  usageContext?: ChatOptions['usageContext']
  tools?: ToolDefinition[]
  toolExecutor?: (name: string, args: Record<string, unknown>, callId?: string) => Promise<string>
  isTerminalTool?: (name: string) => boolean
  currentMessageIndex?: number
  historyMessageIndices?: number[]
  signal?: AbortSignal
}
interface Helpers {
  parseTextToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }>
  stripThinkingBlocks(text: string): string
  stripToolCallTags(text: string): string
  compactImageToolResult(text: string): string
  extractImagesFromToolResult(text: string): string[]
  parseTerminalAcceptance(text: string): boolean
}

/** 社交 ReAct 恢复到已保存的工具位置，不重新执行此前已完成的工具。 */
export async function runSocialGeneration(
  llm: LlmService,
  input: ChatMessage[],
  model: ModelConfig,
  opts: SocialGenerationOptions,
  helpers: Helpers,
): Promise<string> {
  const recovery = currentSocialRecovery()
  const signal = opts.signal ?? recovery?.signal
  const current = input[opts.currentMessageIndex ?? input.length - 1]
  if (current) current.cacheControl = { kind: 'current', currentKeys: opts.replayCurrentKeys ?? [] }
  const replay =
    opts.replayScope && opts.replayCurrentKeys?.length
      ? preparePromptReplay(opts.replayScope, input, { model, tools: canonicalTools(opts.tools) })
      : undefined
  const prepared = replay?.messages ?? input
  let currentIndex = -1
  for (let index = prepared.length - 1; index >= 0; index--) {
    if (prepared[index]?.cacheControl?.kind === 'current') {
      currentIndex = index
      break
    }
  }
  const state: GenerationState = (recovery?.record.checkpoint.generation as
    | GenerationState
    | undefined) ?? {
    messages: prepared.map((message, index) => ({
      ...message,
      pinned: index === currentIndex,
      history:
        message.cacheControl?.kind === 'history' ||
        (!replay?.reused && opts.historyMessageIndices?.includes(index)),
    })),
    round: 0,
    index: 0,
    retries: 0,
    continuations: 0,
    prefix: '',
  }
  const save = async () => {
    signal?.throwIfAborted()
    if (recovery) {
      recovery.record.checkpoint.generation = {
        ...state,
        messages: promptMessagesForPersistence(state.messages),
      }
      await recovery.save()
    }
  }
  const finish = (reply: string) => {
    if (!signal?.aborted) replay?.commit(state.messages, opts.replayReply?.() || reply)
    return reply
  }
  if (state.reply !== undefined) return finish(state.reply)
  if (state.toolStarted && recovery?.record.checkpoint.terminalOutcome) {
    state.toolStarted = false
    state.reply = ''
    await save()
    return finish('')
  }
  if (state.toolStarted) throw new Error('工具执行结果无法确认，已停止自动重试，避免重复操作')
  const budget = (model.contextWindowTokens ?? 131_072) - modelOutputReservation(model) - 1024
  if (budget < 256) throw new Error('模型上下文不足以容纳配置的输出与思考预留，请调整模型额度')
  const policy = recovery?.record.checkpoint.policy as
    | { modelIdleMinutes?: number; modelRequestMinutes?: number; maxRetries?: number }
    | undefined
  const options: ChatOptions = {
    usageContext: opts.usageContext,
    signal,
    maxRetries: 0,
    timeout: (policy?.modelIdleMinutes ?? 10) * 60_000,
    totalTimeout: (policy?.modelRequestMinutes ?? 30) * 60_000,
  }
  const retryLimit = policy?.maxRetries ?? 2

  function fit(tools: ToolDefinition[] | undefined, ratio = 1): void {
    let limit = Math.floor(budget * ratio)
    const hardLimit = limit
    const count = () => llm.estimateInputTokens(model, state.messages, { ...options, tools })
    if (count() <= limit) return
    limit = Math.floor(limit * 0.75)
    while (count() > limit && trimOldestPromptRound(state.messages)) {
      /* 整轮裁剪 */
    }
    if (recovery) recovery.record.error = '正在缩减上下文'
    // 先缩小结构化历史区，保持人设、当前请求及提示词框架完整。
    for (const keep of [16, 8, 0]) {
      for (const message of state.messages)
        if (message.role === 'system' && typeof message.content === 'string') {
          message.content = message.content.replace(
            /<chat_history>[\s\S]*?<\/chat_history>/g,
            (block) => {
              const entries =
                block.match(/<(?:user|assistant)\b[^>]*>[\s\S]*?<\/(?:user|assistant)>/g) ?? []
              return `<chat_history>\n${keep ? entries.slice(-keep).join('\n') : '较早聊天记录已退出本轮上下文，需要时请查询历史。'}\n</chat_history>`
            },
          )
        }
      if (count() <= limit) return
    }
    // 原生历史只移除本轮请求之前的旧轮次，不能拆开工具调用与结果。
    while (count() > limit) {
      const start = state.messages.findIndex((message) => message.history && !message.pinned)
      if (start < 0) break
      let end = start
      let replied = false
      while (
        end < state.messages.length &&
        state.messages[end]!.history &&
        !state.messages[end]!.pinned
      ) {
        if (replied && state.messages[end]!.role === 'user') break
        if (state.messages[end]!.role === 'assistant') replied = true
        end++
      }
      state.messages.splice(start, end - start)
    }
    for (const maxChars of [4000, 1500, 500]) {
      for (const message of state.messages) {
        if (
          message.role === 'tool' &&
          typeof message.content === 'string' &&
          message.content.length > maxChars
        )
          message.content = `${message.content.slice(0, maxChars)}\n[工具结果因输入预算缩减；需要时请缩小范围重新查询。]`
        if (!message.pinned && Array.isArray(message.content))
          message.content = message.content.filter((part) => part.type === 'text')
      }
      if (count() <= limit) return
    }
    // 历史中的大工具轮整组移除，保留最近一次工具观察和对应协议字段。
    const starts = state.messages
      .map((message, index) =>
        message.role === 'assistant' && message.toolCalls?.length ? index : -1,
      )
      .filter((index) => index >= 0)
    for (let index = starts.length - 2; index >= 0 && count() > limit; index--) {
      const start = starts[index]!,
        end = starts[index + 1]!
      if (!state.messages.slice(start, end).some((message) => message.pinned))
        state.messages.splice(start, end - start)
    }
    if (count() > hardLimit)
      throw new Error(
        `社交输入容量不足：约 ${count()} Token，可用 ${hardLimit} Token。当前请求或必要工具定义过大，请缩小内容范围。`,
      )
  }

  while (state.round <= 7) {
    signal?.throwIfAborted()
    if (state.pending) {
      for (; state.index < state.pending.length; state.index++) {
        signal?.throwIfAborted()
        const call = state.pending[state.index]!
        if (
          !opts.toolExecutor ||
          !opts.tools?.some((tool) => tool.function.name === call.function.name)
        )
          throw new Error(`工具 ${call.function.name} 已不可用，恢复任务已停止`)
        let args: Record<string, unknown>
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          throw new Error(`工具 ${call.function.name} 的参数不完整，已阻止执行`)
        }
        state.toolStarted = true
        await save()
        let result: string
        try {
          result = await opts.toolExecutor!(call.function.name, args, call.id)
        } catch (error) {
          // 无法证明工具没有副作用时，不自动重放；取消后也不提交迟到结果。
          throw new Error(
            `工具 ${call.function.name} 未确认完成，已停止重复执行：${error instanceof Error ? error.message : String(error)}`,
          )
        }
        signal?.throwIfAborted()
        state.toolStarted = false
        const images = helpers.extractImagesFromToolResult(result)
        state.messages.push(
          state.textTools
            ? {
                role: 'user',
                content: `[工具结果 ${call.function.name}]：${helpers.compactImageToolResult(result)}`,
              }
            : {
                role: 'tool',
                content: helpers.compactImageToolResult(result),
                toolCallId: call.id,
              },
        )
        if (images.length)
          state.messages.push({
            role: 'user',
            pinned: true,
            content: [
              { type: 'text', text: '以下是工具读取到的图片：' },
              ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
            ],
          })
        state.index++
        if (opts.isTerminalTool?.(call.function.name) && helpers.parseTerminalAcceptance(result))
          state.reply = ''
        await save()
        state.index--
        if (state.reply !== undefined) return finish(state.reply)
      }
      state.pending = undefined
      state.index = 0
      await save()
    }
    const tools = state.round >= 5 ? undefined : opts.tools?.length ? opts.tools : undefined
    fit(tools)
    await save()
    let completion: ChatCompletion
    let inputRecovery = false
    for (;;) {
      try {
        completion = await llm.chat(model, state.messages, {
          ...options,
          tools,
          usageContext: { ...options.usageContext, step: state.round + 1 },
        })
        break
      } catch (error) {
        signal?.throwIfAborted()
        const failure = socialFailure(error)
        if (
          !inputRecovery &&
          /context.{0,50}(?:length|limit|exceed)|maximum context|输入.{0,20}(?:超|容量)|too many tokens/i.test(
            failure.message,
          )
        ) {
          inputRecovery = true
          fit(tools, 0.65)
          await save()
          continue
        }
        if (!failure.retryable || state.retries + (recovery?.record.attempts ?? 1) > retryLimit)
          throw error
        state.retries++
        if (recovery) recovery.record.error = '模型请求失败，正在重试'
        await save()
        await socialDelay(Math.min(30_000, 1000 * 2 ** state.retries), signal)
      }
    }
    signal?.throwIfAborted()
    const choice = completion.choices[0]
    if (!choice) throw new Error('社交模型未返回有效结果')
    const message = choice.message
    if (recovery) recovery.record.error = undefined
    const truncated = /length|max_tokens|max_output_tokens/i.test(choice.finishReason ?? '')
    if (truncated) {
      if (state.continuations >= 2)
        throw new Error('本次模型输出多次达到 Token 上限，已停止；请拆分任务')
      state.continuations++
      state.round++
      // 截断的工具参数绝不执行；向 Agent 说明超限后重新请求完整工具调用。
      if (!message.toolCalls?.length)
        state.prefix += helpers.stripThinkingBlocks(message.content ?? '')
      state.messages.push({
        role: 'assistant',
        content: message.content || null,
        reasoningContent: message.reasoningContent,
        nativeReasoning: message.nativeReasoning,
      })
      state.messages.push({
        role: 'user',
        content: message.toolCalls?.length
          ? '此次输出 Token 超限，工具参数未完整生成，因此尚未执行。请缩小操作并重新输出完整工具调用。'
          : '此次输出 Token 超限，请从截断位置继续，不要重复已经输出的内容。',
      })
      await save()
      continue
    }
    let calls = message.toolCalls
    state.textTools = false
    if (!calls?.length && opts.toolExecutor) {
      const parsed = helpers.parseTextToolCalls(message.content ?? '')
      if (parsed.length) {
        state.textTools = true
        calls = parsed.map((call, index) => ({
          id: `text-${state.round}-${index}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }))
      }
    }
    if (!calls?.length || !opts.toolExecutor) {
      state.messages.push({
        role: 'assistant',
        content: message.content,
        reasoningContent: message.reasoningContent,
        nativeReasoning: message.nativeReasoning,
      })
      state.reply =
        state.prefix + helpers.stripThinkingBlocks(helpers.stripToolCallTags(message.content ?? ''))
      await save()
      return finish(state.reply)
    }
    if (state.round >= 5) throw new Error('社交工具调用已达到轮次上限，模型未生成最终结果')
    state.messages.push({
      role: 'assistant',
      content: state.textTools ? helpers.stripToolCallTags(message.content ?? '') : message.content,
      reasoningContent: message.reasoningContent,
      nativeReasoning: message.nativeReasoning,
      ...(state.textTools ? {} : { toolCalls: calls }),
    })
    state.round++
    state.pending = calls
    state.index = 0
    await save()
  }
  throw new Error('社交任务达到执行轮次上限')
}
