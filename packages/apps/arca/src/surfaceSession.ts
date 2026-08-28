/**
 * surfaceSession — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export type SurfaceSessionScope = 'read' | 'edit' | 'review'

interface PendingChallenge {
  challengeId: string
  nonce: string
  clientNodeId: string
  principalId: string
  expiresAt: number
}

export interface SurfaceSession {
  sessionId: string
  token: string
  clientNodeId: string
  principalId: string
  scopes: SurfaceSessionScope[]
  connectionGeneration: number
  createdAt: string
  expiresAt: string
}

export class SurfaceSessionManager {
  private readonly challenges = new Map<string, PendingChallenge>()
  private readonly sessions = new Map<string, SurfaceSession>()
  private connectionGeneration = 0

  createChallenge(input: { clientNodeId: string; principalId: string }) {
    this.prune()
    const challenge: PendingChallenge = {
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString('base64url'),
      clientNodeId: input.clientNodeId,
      principalId: input.principalId,
      expiresAt: Date.now() + 30_000,
    }
    this.challenges.set(challenge.challengeId, challenge)
    return {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    }
  }

  completeChallenge(input: {
    challengeId: string
    nonce: string
    clientNodeId: string
    principalId: string
  }): SurfaceSession {
    this.prune()
    const challenge = this.challenges.get(input.challengeId)
    this.challenges.delete(input.challengeId)
    if (!challenge || challenge.expiresAt <= Date.now())
      throw new Error('SURFACE_CHALLENGE_EXPIRED')
    const nonceMatches =
      challenge.nonce.length === input.nonce.length &&
      timingSafeEqual(Buffer.from(challenge.nonce), Buffer.from(input.nonce))
    if (
      !nonceMatches ||
      challenge.clientNodeId !== input.clientNodeId ||
      challenge.principalId !== input.principalId
    ) {
      throw new Error('SURFACE_CHALLENGE_INVALID')
    }
    this.connectionGeneration += 1
    const now = Date.now()
    const session: SurfaceSession = {
      sessionId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      clientNodeId: input.clientNodeId,
      principalId: input.principalId,
      scopes: ['read', 'edit', 'review'],
      connectionGeneration: this.connectionGeneration,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 12 * 60 * 60 * 1_000).toISOString(),
    }
    this.sessions.set(session.token, session)
    return structuredClone(session)
  }

  require(token: unknown, scope: SurfaceSessionScope, clientNodeId?: string): SurfaceSession {
    this.prune()
    if (typeof token !== 'string') throw new Error('SURFACE_SESSION_REQUIRED')
    const session = this.sessions.get(token)
    if (!session) throw new Error('SURFACE_SESSION_INVALID')
    if (clientNodeId && session.clientNodeId !== clientNodeId) {
      throw new Error('SURFACE_SESSION_CLIENT_MISMATCH')
    }
    if (!session.scopes.includes(scope)) throw new Error('SURFACE_SESSION_SCOPE_DENIED')
    return structuredClone(session)
  }

  close(token: unknown): boolean {
    if (typeof token !== 'string') return false
    return this.sessions.delete(token)
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id)
    }
    for (const [token, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now) this.sessions.delete(token)
    }
  }
}
