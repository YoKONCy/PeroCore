import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { KernelNodeId, KernelNodeTrust } from '@infos/shared'
import type { NodeCertificate } from '@infos/node-sdk'

export interface TrustedNodeRecord {
  nodeId: KernelNodeId
  publicKeyPem: string
  publicKeyFingerprint: string
  trust: Exclude<KernelNodeTrust, 'untrusted'>
  trustEpoch: number
  certificate: NodeCertificate
  pairedAt: string
  revokedAt?: string
  revocationReason?: string
}

interface TrustFile {
  version: 1
  records: TrustedNodeRecord[]
}

/** Node信任与证书的文件持久权威；私钥不属于该仓库。 */
export class PersistentNodeTrustStore {
  private readonly records = new Map<KernelNodeId, TrustedNodeRecord>()

  constructor(private readonly filePath: string) {
    this.load()
  }

  trust(input: Omit<TrustedNodeRecord, 'pairedAt' | 'revokedAt' | 'revocationReason'>): void {
    const existing = this.records.get(input.nodeId)
    if (existing && existing.publicKeyFingerprint !== input.publicKeyFingerprint) {
      throw new Error('NODE_TRUST_FINGERPRINT_CONFLICT')
    }
    if (input.certificate.nodeId !== input.nodeId) throw new Error('NODE_CERTIFICATE_ID_MISMATCH')
    if (input.certificate.publicKeyFingerprint !== input.publicKeyFingerprint) {
      throw new Error('NODE_CERTIFICATE_FINGERPRINT_MISMATCH')
    }
    const record: TrustedNodeRecord = {
      ...input,
      pairedAt: existing?.pairedAt ?? new Date().toISOString(),
    }
    this.records.set(input.nodeId, record)
    this.persist()
  }

  revoke(nodeId: KernelNodeId, reason: string): boolean {
    const record = this.records.get(nodeId)
    if (!record || record.revokedAt) return false
    record.revokedAt = new Date().toISOString()
    record.revocationReason = reason
    record.trustEpoch += 1
    this.persist()
    return true
  }

  get(nodeId: KernelNodeId): TrustedNodeRecord | null {
    const record = this.records.get(nodeId)
    return record ? structuredClone(record) : null
  }

  assertTrusted(input: {
    nodeId: KernelNodeId
    publicKeyFingerprint?: string
    certificate?: NodeCertificate
  }): TrustedNodeRecord {
    const record = this.records.get(input.nodeId)
    if (!record || record.revokedAt) throw new Error('NODE_NOT_TRUSTED')
    if (Date.parse(record.certificate.expiresAt) <= Date.now())
      throw new Error('NODE_CERTIFICATE_EXPIRED')
    if (input.publicKeyFingerprint !== record.publicKeyFingerprint) {
      throw new Error('NODE_TRUST_FINGERPRINT_MISMATCH')
    }
    if (
      !input.certificate ||
      input.certificate.certificateId !== record.certificate.certificateId
    ) {
      throw new Error('NODE_CERTIFICATE_MISMATCH')
    }
    if (input.certificate.trustEpoch !== record.trustEpoch)
      throw new Error('NODE_TRUST_EPOCH_STALE')
    return structuredClone(record)
  }

  list(): TrustedNodeRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record))
  }

  removeExpired(now = Date.now()): number {
    let removed = 0
    for (const [nodeId, record] of this.records) {
      if (Date.parse(record.certificate.expiresAt) <= now) {
        this.records.delete(nodeId)
        removed += 1
      }
    }
    if (removed) this.persist()
    return removed
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as TrustFile
    if (parsed.version !== 1 || !Array.isArray(parsed.records))
      throw new Error('NODE_TRUST_FILE_INVALID')
    for (const record of parsed.records) this.records.set(record.nodeId, record)
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const data: TrustFile = { version: 1, records: [...this.records.values()] }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }
}
