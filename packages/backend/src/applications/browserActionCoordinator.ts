import type { BoundCapabilityPort } from '../kernel/capabilityDirectory'

export interface BrowserRecoverableAction {
  action: 'hover' | 'click'
  target?: string
  handle?: string
  allowOccluded?: boolean
}

/** Browser Application 层的单次、受限恢复协调器。 */
export class BrowserActionCoordinator {
  constructor(private readonly port: BoundCapabilityPort) {}

  async execute(
    action: BrowserRecoverableAction,
    context: { principalId: string; correlationId: string; deadline?: string },
  ): Promise<unknown> {
    const operation = action.action === 'hover' ? 'hover' : 'nativeClick'
    try {
      return await this.port.invoke(operation, action, context)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/WEB_ELEMENT_(NOT_FOUND|OCCLUDED)/.test(message)) throw error
      if (!action.target || action.allowOccluded) throw error
      await this.port.invoke('inspect', {}, context)
      await this.port.invoke(
        'evaluate',
        {
          world: 'isolated',
          expression: `document.querySelector(${JSON.stringify(action.target)})?.scrollIntoView({ block: 'center', inline: 'center' })`,
        },
        context,
      )
      return this.port.invoke(operation, action, context)
    }
  }
}
