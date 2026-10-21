import { t as __t } from '../../lib/i18n'
import type {
  CompletionAlert,
  KernelCapabilityOffer,
  KernelCapabilityRequirement,
  KernelNodeId,
} from '@infos/shared'
import type { BoundCapabilityPort, CapabilityDirectory } from '../../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../../kernel/lifecycleScope'
import { createLogger } from '../../lib/logger'

const logger = createLogger('CompletionAlert')
const REQUIREMENT: KernelCapabilityRequirement = {
  requirementId: 'kernel.completion-alert',
  capabilityType: 'client.completion-alert',
  contractVersion: '1.0',
  operations: ['notify'],
  required: false,
  binding: 'lazy',
  cardinality: 'many',
  placement: {
    executionLocations: ['client-local'],
    providerFacets: ['client', 'capability'],
    requiresClientPresence: true,
    requiresInputSeat: false,
    dataResidency: 'device-only',
  },
}

/** 只消费实际完成事件，不轮询历史、不等待用户，也不影响任务结算。 */
export class CompletionAlertService {
  private bindings = new Map<string, { scope: LifecycleScope; port: BoundCapabilityPort }>()
  private unsubscribe: () => void
  constructor(
    private directory: CapabilityDirectory,
    private handles: CapabilityHandleRegistry,
    private localNodeId: KernelNodeId,
  ) {
    this.unsubscribe = directory.subscribe(() => {
      const online = new Set(
        directory
          .listOffers(REQUIREMENT)
          .filter((offer) => offer.health === 'available')
          .map((offer) => offer.offerId),
      )
      for (const [id, binding] of this.bindings)
        if (!online.has(id)) {
          this.bindings.delete(id)
          void binding.scope.dispose().catch((error) =>
            logger.warn(__t('logs.conversation', '释放离线完成提醒连接失败'), {
              error: String(error),
            }),
          )
        }
    })
  }

  async stop(): Promise<void> {
    this.unsubscribe()
    const bindings = [...this.bindings.values()]
    this.bindings.clear()
    await Promise.all(bindings.map((binding) => binding.scope.dispose()))
  }

  private bind(offer: KernelCapabilityOffer): BoundCapabilityPort {
    const existing = this.bindings.get(offer.offerId)
    if (existing) return existing.port
    const scope = new LifecycleScope(`completion-alert:${offer.offerId}`)
    const handle = this.handles.issue({
      subjectId: 'kernel.completion-alert',
      issuerNodeId: this.localNodeId,
      subjectNodeId: this.localNodeId,
      providerNodeId: offer.placement?.providerNodeId,
      revocationEpoch: 1,
      resource: offer.provider,
      operations: ['notify'],
      scope: { capabilityType: 'client.completion-alert' },
      revocable: true,
    })
    scope.defer(() => {
      this.handles.revoke(handle.handleId)
    })
    try {
      const port = this.directory.bind({
        requirement: {
          ...REQUIREMENT,
          cardinality: 'one',
          placement: { ...REQUIREMENT.placement, preferredNodeId: offer.placement?.providerNodeId },
        },
        handleId: handle.handleId,
        scope,
        principalId: 'system',
      })
      this.bindings.set(offer.offerId, { scope, port })
      return port
    } catch (error) {
      void scope
        .dispose()
        .catch((cause) =>
          logger.warn(__t('logs.conversation', '释放完成提醒连接失败'), { error: String(cause) }),
        )
      throw error
    }
  }

  async notify(alert: CompletionAlert): Promise<void> {
    const offers = this.directory
      .listOffers(REQUIREMENT)
      .filter((offer) => offer.health === 'available')
    await Promise.all(
      offers.map(async (offer) => {
        try {
          const port = this.bind(offer)
          await port.invoke(
            'notify',
            alert,
            {
              principalId: 'system',
              correlationId: alert.id,
              idempotencyKey: alert.id,
              deadline: new Date(Date.now() + 8000).toISOString(),
            },
            AbortSignal.timeout(8000),
          )
        } catch (error) {
          logger.warn(__t('logs.conversation', '完成提醒投递失败，任务结果不受影响'), {
            id: alert.id,
            error: String(error),
          })
        }
      }),
    )
  }
}
