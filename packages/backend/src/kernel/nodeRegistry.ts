import type { FileNodeRegistryStore } from './fileNodeRegistryStore'
import { randomUUID } from 'node:crypto'
import type {
  KernelInputSeat,
  KernelInputSeatId,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelNodeSession,
  KernelNodeSessionId,
} from '@infos/shared'

/** 稳定 Node Identity、连接 Session 与 Input Seat Lease 的进程内权威。 */
export class NodeRegistry {
  private readonly nodes = new Map<KernelNodeId, KernelNodeDescriptor>()
  private readonly sessions = new Map<KernelNodeSessionId, KernelNodeSession>()
  private readonly seats = new Map<KernelInputSeatId, KernelInputSeat>()
  private readonly seatEpochs = new Map<string, number>()
  private readonly generations = new Map<KernelNodeId, number>()

  constructor(private readonly store?: FileNodeRegistryStore) {
    const snapshot = store?.load()
    for (const node of snapshot?.nodes ?? []) this.nodes.set(node.nodeId, Object.freeze(node))
    for (const [nodeId, generation] of snapshot?.generations ?? []) {
      this.generations.set(nodeId, generation)
    }
  }

  registerNode(descriptor: KernelNodeDescriptor): void {
    const existing = this.nodes.get(descriptor.nodeId)
    if (existing && existing.publicKeyFingerprint !== descriptor.publicKeyFingerprint) {
      throw new Error('NODE_IDENTITY_CONFLICT: 相同 Node ID 的密钥指纹不一致')
    }
    this.nodes.set(descriptor.nodeId, Object.freeze(structuredClone(descriptor)))
    this.persist()
  }

  connect(input: {
    nodeId: KernelNodeId
    connectionId?: string
    carrier: KernelNodeSession['carrier']
    leaseMs: number
  }): KernelNodeSession {
    if (!this.nodes.has(input.nodeId)) throw new Error('NODE_NOT_REGISTERED: Node 尚未注册')
    if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error('NODE_LEASE_INVALID: Lease 必须为正数')
    }
    const generation = (this.generations.get(input.nodeId) ?? 0) + 1
    this.generations.set(input.nodeId, generation)
    const now = Date.now()
    const sessionId = randomUUID() as KernelNodeSessionId
    const session: KernelNodeSession = {
      sessionId,
      nodeId: input.nodeId,
      connectionId: input.connectionId?.trim() || sessionId,
      generation,
      connectionGeneration: generation,
      carrier: input.carrier,
      connectedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      leaseExpiresAt: new Date(now + input.leaseMs).toISOString(),
      health: 'online',
    }
    this.sessions.set(session.sessionId, session)
    this.persist()
    return structuredClone(session)
  }

  heartbeat(sessionId: KernelNodeSessionId, leaseMs: number): KernelNodeSession {
    const session = this.requireSession(sessionId)
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new Error('NODE_LEASE_INVALID: Lease 必须为正数')
    }
    const now = Date.now()
    session.lastSeenAt = new Date(now).toISOString()
    session.leaseExpiresAt = new Date(now + leaseMs).toISOString()
    session.health = 'online'
    return structuredClone(session)
  }

  disconnect(sessionId: KernelNodeSessionId): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.health = 'offline'
    session.leaseExpiresAt = new Date().toISOString()
    for (const seat of this.seats.values()) {
      if (seat.sessionId === sessionId) this.seats.delete(seat.seatId)
    }
    return true
  }

  issueInputSeat(input: {
    sessionId: KernelNodeSessionId
    principalId: string
    capabilities: KernelInputSeat['capabilities']
    leaseMs: number
    windowId?: string
  }): KernelInputSeat {
    const session = this.assertActiveSession(input.sessionId)
    const node = this.nodes.get(session.nodeId)!
    if (!node.facets.includes('client')) {
      throw new Error('INPUT_SEAT_CLIENT_REQUIRED: 只有 Client Facet 可以持有 Input Seat')
    }
    const now = Date.now()
    for (const existing of this.seats.values()) {
      if (existing.principalId === input.principalId) this.seats.delete(existing.seatId)
    }
    const epoch = (this.seatEpochs.get(input.principalId) ?? 0) + 1
    this.seatEpochs.set(input.principalId, epoch)
    const seat: KernelInputSeat = {
      seatId: randomUUID() as KernelInputSeatId,
      nodeId: session.nodeId,
      principalId: input.principalId,
      sessionId: session.sessionId,
      windowId: input.windowId?.trim() || `${session.nodeId}:main`,
      epoch,
      issuedAt: new Date(now).toISOString(),
      leaseExpiresAt: new Date(
        Math.min(now + input.leaseMs, Date.parse(session.leaseExpiresAt)),
      ).toISOString(),
      capabilities: Object.freeze([...new Set(input.capabilities)]),
    }
    this.seats.set(seat.seatId, seat)
    return structuredClone(seat)
  }

  getNode(nodeId: KernelNodeId): KernelNodeDescriptor | null {
    const node = this.nodes.get(nodeId)
    return node ? structuredClone(node) : null
  }

  getActiveSession(nodeId: KernelNodeId): KernelNodeSession | null {
    this.expireLeases()
    const candidates = [...this.sessions.values()]
      .filter((session) => session.nodeId === nodeId && session.health !== 'offline')
      .sort((left, right) => right.connectionGeneration - left.connectionGeneration)
    return candidates[0] ? structuredClone(candidates[0]) : null
  }

  getInputSeat(
    principalId: string,
    requiredCapability?: KernelInputSeat['capabilities'][number],
  ): KernelInputSeat | null {
    this.expireLeases()
    const seats = [...this.seats.values()].filter(
      (seat) =>
        seat.principalId === principalId &&
        (!requiredCapability || seat.capabilities.includes(requiredCapability)),
    )
    return seats[0] ? structuredClone(seats[0]) : null
  }

  validateInputSeat(input: {
    seatId: KernelInputSeatId
    sessionId: KernelNodeSessionId
    principalId: string
    windowId: string
    epoch: number
    capability: KernelInputSeat['capabilities'][number]
  }): KernelInputSeat {
    this.expireLeases()
    const seat = this.seats.get(input.seatId)
    if (!seat) throw new Error('INPUT_SEAT_EXPIRED')
    if (
      seat.sessionId !== input.sessionId ||
      seat.principalId !== input.principalId ||
      seat.windowId !== input.windowId ||
      seat.epoch !== input.epoch
    ) {
      throw new Error('INPUT_SEAT_IDENTITY_MISMATCH')
    }
    if (!seat.capabilities.includes(input.capability))
      throw new Error('INPUT_SEAT_CAPABILITY_DENIED')
    return structuredClone(seat)
  }

  renewInputSeat(seatId: KernelInputSeatId, leaseMs: number): KernelInputSeat {
    const seat = this.seats.get(seatId)
    if (!seat) throw new Error('INPUT_SEAT_EXPIRED')
    const session = this.assertActiveSession(seat.sessionId)
    const now = Date.now()
    seat.leaseExpiresAt = new Date(
      Math.min(now + leaseMs, Date.parse(session.leaseExpiresAt)),
    ).toISOString()
    return structuredClone(seat)
  }

  getSession(sessionId: KernelNodeSessionId): KernelNodeSession | null {
    this.expireLeases()
    const session = this.sessions.get(sessionId)
    return session ? structuredClone(session) : null
  }

  listSessions(): KernelNodeSession[] {
    this.expireLeases()
    return [...this.sessions.values()].map((session) => structuredClone(session))
  }

  revokeInputSeat(seatId: KernelInputSeatId): boolean {
    return this.seats.delete(seatId)
  }

  revokeWindow(sessionId: KernelNodeSessionId, windowId: string): number {
    let revoked = 0
    for (const seat of this.seats.values()) {
      if (seat.sessionId === sessionId && seat.windowId === windowId) {
        this.seats.delete(seat.seatId)
        revoked += 1
      }
    }
    return revoked
  }

  listInputSeats(): KernelInputSeat[] {
    this.expireLeases()
    return [...this.seats.values()].map((seat) => structuredClone(seat))
  }

  listNodes(): KernelNodeDescriptor[] {
    return [...this.nodes.values()].map((node) => structuredClone(node))
  }

  expireLeases(now = Date.now()): void {
    for (const session of this.sessions.values()) {
      if (session.health !== 'offline' && Date.parse(session.leaseExpiresAt) <= now) {
        session.health = 'offline'
      }
    }
    for (const seat of this.seats.values()) {
      const session = this.sessions.get(seat.sessionId)
      if (Date.parse(seat.leaseExpiresAt) <= now || !session || session.health === 'offline') {
        this.seats.delete(seat.seatId)
      }
    }
  }

  private persist(): void {
    this.store?.save(this.listNodes(), new Map(this.generations))
  }

  private assertActiveSession(sessionId: KernelNodeSessionId): KernelNodeSession {
    this.expireLeases()
    const session = this.requireSession(sessionId)
    if (session.health === 'offline') throw new Error('NODE_SESSION_EXPIRED: Node Session 已失效')
    return session
  }

  private requireSession(sessionId: KernelNodeSessionId): KernelNodeSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('NODE_SESSION_NOT_FOUND: Node Session 不存在')
    return session
  }
}
