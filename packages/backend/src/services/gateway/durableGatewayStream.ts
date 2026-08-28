import type { GatewayEnvelope } from './types'

export interface GatewayStreamReadResult {
  events: GatewayEnvelope[]
  latestSequence: number
  retentionFloor: number
  snapshotRequired: boolean
}

/** Gateway Durable 事件窗口；事件至少投递一次，客户端按 messageId/sequence 幂等。 */
export class DurableGatewayStream {
  private readonly events = new Map<string, GatewayEnvelope[]>()
  private readonly sequences = new Map<string, number>()

  constructor(private readonly retentionLimit = 500) {}

  append(streamId: string, envelope: GatewayEnvelope): GatewayEnvelope {
    const sequence = (this.sequences.get(streamId) ?? 0) + 1
    this.sequences.set(streamId, sequence)
    const event = structuredClone({ ...envelope, sequence, streamId })
    const events = this.events.get(streamId) ?? []
    events.push(event)
    if (events.length > this.retentionLimit) events.splice(0, events.length - this.retentionLimit)
    this.events.set(streamId, events)
    return structuredClone(event)
  }

  read(streamId: string, afterSequence: number): GatewayStreamReadResult {
    const events = this.events.get(streamId) ?? []
    const latestSequence = this.sequences.get(streamId) ?? 0
    const retentionFloor = events[0]?.sequence ?? latestSequence
    const snapshotRequired = afterSequence > 0 && afterSequence < retentionFloor - 1
    return {
      events: snapshotRequired
        ? []
        : events
            .filter((event) => (event.sequence ?? 0) > afterSequence)
            .map((event) => structuredClone(event)),
      latestSequence,
      retentionFloor,
      snapshotRequired,
    }
  }
}
