import type {
  ConversationMessageProjection,
  ConversationSurfaceDescriptor,
  ErrorSurfaceProps,
  MarkdownSurfaceProps,
  SurfaceId,
  SurfaceNode,
  SurfaceNodeId,
  ToolCallSurfaceProps,
  ToolResultSurfaceProps,
} from '@infos/shared'

/** 将 Conversation 领域读模型确定性映射为 committed Surface。 */
export class ConversationSurfaceProjector {
  projectMessage(
    message: ConversationMessageProjection,
    principalId: string,
  ): ConversationSurfaceDescriptor {
    const surfaceId = `conversation-message:${message.messageId}` as SurfaceId
    const nodes: SurfaceNode[] = []
    const contentBlocks = message.contentBlocks ?? []
    if (contentBlocks.length > 0) {
      for (const block of contentBlocks) {
        if (block.kind === 'thinking') {
          nodes.push(
            this.node(surfaceId, 'thinking', 'stable', message.revision, block.blockId, {
              source: block.content,
              phase: 'committed',
              durationMs: block.durationMs,
            }),
          )
          continue
        }
        if (block.kind === 'native_reasoning') {
          nodes.push(
            this.node(surfaceId, 'native-reasoning', 'stable', message.revision, block.blockId, {
              source: block.content,
              phase: 'committed',
              mode: block.mode,
              durationMs: block.durationMs,
            }),
          )
          continue
        }
        if (block.kind === 'narration') {
          if (!block.content) continue
          nodes.push(
            this.node<MarkdownSurfaceProps>(
              surfaceId,
              'markdown',
              'stable',
              message.revision,
              block.blockId,
              {
                source: block.content,
                phase: 'committed',
              },
            ),
          )
          continue
        }
        nodes.push(...this.projectToolBlock(surfaceId, message.revision, block))
      }
    } else {
      if (message.content) {
        nodes.push(
          this.node<MarkdownSurfaceProps>(
            surfaceId,
            'markdown',
            'stable',
            message.revision,
            'markdown',
            {
              source: message.content,
              phase: 'committed',
            },
          ),
        )
      }
      for (const [index, call] of message.toolCalls.entries()) {
        const callId = call.callId ?? `tool-${index}`
        nodes.push(
          ...this.projectToolBlock(surfaceId, message.revision, {
            blockId: `tool:${callId}`,
            sequence: index,
            kind: 'tool',
            turn: 0,
            callId,
            ...call,
          }),
        )
      }
    }
    for (const attachment of message.attachments) {
      nodes.push(
        this.node(
          surfaceId,
          'attachment',
          'interactive',
          message.revision,
          `attachment:${attachment.id}`,
          attachment,
        ),
      )
    }
    if (message.status === 'failed' || message.status === 'interrupted') {
      const props: ErrorSurfaceProps = {
        code: message.status === 'interrupted' ? 'INTERRUPTED' : 'EXECUTION_FAILED',
        message: message.failureMessage ?? message.content,
      }
      nodes.push(
        this.node<ErrorSurfaceProps>(
          surfaceId,
          'error',
          'stable',
          message.revision,
          'error',
          props,
        ),
      )
    }
    return {
      surfaceId,
      generation: `message:${message.messageId}:revision:${message.revision}`,
      messageId: message.messageId,
      threadId: message.threadId,
      principalId,
      revision: message.revision,
      sequence: 0,
      state:
        message.status === 'failed' || message.status === 'interrupted' ? 'failed' : 'committed',
      nodes,
    }
  }

  private projectToolBlock(
    surfaceId: SurfaceId,
    revision: number,
    block: Extract<import('@infos/shared').ConversationContentBlock, { kind: 'tool' }>,
  ): SurfaceNode[] {
    const nodes: SurfaceNode[] = [
      this.node<ToolCallSurfaceProps>(
        surfaceId,
        'tool-call',
        'interactive',
        revision,
        block.blockId,
        {
          callId: block.callId,
          name: block.name,
          args: block.args,
          state: block.result === undefined ? 'calling' : block.isError ? 'failed' : 'completed',
        },
      ),
    ]
    if (block.result !== undefined) {
      nodes.push(
        this.node<ToolResultSurfaceProps>(
          surfaceId,
          'tool-result',
          'stable',
          revision,
          `tool-result:${block.callId}`,
          {
            callId: block.callId,
            result: block.result,
            isError: block.isError ?? false,
            durationMs: block.durationMs,
          },
        ),
      )
    }
    return nodes
  }

  private node<T extends object>(
    surfaceId: SurfaceId,
    kind: SurfaceNode['kind'],
    lifecycle: SurfaceNode['lifecycle'],
    revision: number,
    suffix: string,
    props: T,
  ): SurfaceNode<T> {
    return {
      nodeId: `${surfaceId}:${suffix}` as SurfaceNodeId,
      kind,
      lifecycle,
      revision,
      props,
    }
  }
}
