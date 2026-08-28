import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { KernelNodeDescriptor, KernelNodeId } from '@infos/shared'
import type {
  NodeCertificate,
  NodeIdentityRecord,
  NodePairingChallenge,
  NodePairingRequest,
} from '@infos/node-sdk'
import type { PersistentNodeTrustStore } from './trustStore'

export class FileNodeIdentityStore {
  constructor(private readonly filePath: string) {}

  loadOrCreate(
    descriptor: Omit<KernelNodeDescriptor, 'nodeId' | 'publicKeyFingerprint'>,
  ): NodeIdentityRecord {
    if (existsSync(this.filePath)) {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as NodeIdentityRecord
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const fingerprint = createHash('sha256').update(publicKeyPem).digest('hex')
    const nodeId = `infos-node-${fingerprint.slice(0, 24)}` as KernelNodeId
    const record: NodeIdentityRecord = {
      descriptor: { ...descriptor, nodeId, publicKeyFingerprint: fingerprint },
      publicKeyPem,
      privateKeyPem,
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(record, null, 2), { mode: 0o600 })
    return record
  }

  save(record: NodeIdentityRecord): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(record, null, 2), { mode: 0o600 })
  }
}

/** 一次性配对 Code 与 Node Certificate 的本地权威探针。 */
export class PairingAuthority {
  private readonly challenges = new Map<string, NodePairingChallenge>()

  constructor(
    private readonly issuerNodeId: KernelNodeId,
    private readonly issuerPrivateKeyPem: string,
    private readonly issuerPublicKeyPem: string,
    private readonly trustStore?: PersistentNodeTrustStore,
  ) {}

  createChallenge(pairingCode: string, ttlMs = 5 * 60_000): NodePairingChallenge {
    if (pairingCode.length < 8) throw new Error('PAIRING_CODE_WEAK: 配对码至少 8 位')
    const challenge: NodePairingChallenge = {
      challengeId: randomUUID(),
      codeHash: createHash('sha256').update(pairingCode).digest('hex'),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    }
    this.challenges.set(challenge.challengeId, challenge)
    return structuredClone(challenge)
  }

  createProof(input: { challengeId: string; pairingCode: string; privateKeyPem: string }): string {
    const payload = `${input.challengeId}:${input.pairingCode}`
    return sign(null, Buffer.from(payload), input.privateKeyPem).toString('base64')
  }

  pair(request: NodePairingRequest, certificateTtlMs = 24 * 60 * 60_000): NodeCertificate {
    const challenge = this.challenges.get(request.challengeId)
    if (!challenge || challenge.usedAt)
      throw new Error('PAIRING_CHALLENGE_INVALID: 配对挑战不存在或已使用')
    if (Date.parse(challenge.expiresAt) <= Date.now())
      throw new Error('PAIRING_CHALLENGE_EXPIRED: 配对挑战已过期')
    const codeHash = createHash('sha256').update(request.pairingCode).digest('hex')
    if (codeHash !== challenge.codeHash) throw new Error('PAIRING_CODE_INVALID: 配对码错误')
    const proofPayload = `${request.challengeId}:${request.pairingCode}`
    if (
      !verify(
        null,
        Buffer.from(proofPayload),
        request.publicKeyPem,
        Buffer.from(request.proof, 'base64'),
      )
    ) {
      throw new Error('PAIRING_PROOF_INVALID: Node 无法证明私钥所有权')
    }
    const fingerprint = createHash('sha256').update(request.publicKeyPem).digest('hex')
    if (
      request.descriptor.publicKeyFingerprint &&
      request.descriptor.publicKeyFingerprint !== fingerprint
    ) {
      throw new Error('PAIRING_FINGERPRINT_MISMATCH: Descriptor 密钥指纹不一致')
    }
    const now = Date.now()
    const trustEpoch = (this.trustStore?.get(request.descriptor.nodeId)?.trustEpoch ?? 0) + 1
    const unsigned = {
      certificateId: randomUUID(),
      nodeId: request.descriptor.nodeId,
      publicKeyFingerprint: fingerprint,
      issuerNodeId: this.issuerNodeId,
      trustEpoch,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + certificateTtlMs).toISOString(),
    }
    const signature = sign(
      null,
      Buffer.from(JSON.stringify(unsigned)),
      this.issuerPrivateKeyPem,
    ).toString('base64')
    challenge.usedAt = new Date().toISOString()
    const certificate = { ...unsigned, signature }
    this.trustStore?.trust({
      nodeId: request.descriptor.nodeId,
      publicKeyPem: request.publicKeyPem,
      publicKeyFingerprint: fingerprint,
      trust: 'paired',
      trustEpoch,
      certificate,
    })
    return certificate
  }

  verifyCertificate(certificate: NodeCertificate): boolean {
    if (certificate.issuerNodeId !== this.issuerNodeId) return false
    if (Date.parse(certificate.expiresAt) <= Date.now()) return false
    const { signature, ...unsigned } = certificate
    return verify(
      null,
      Buffer.from(JSON.stringify(unsigned)),
      this.issuerPublicKeyPem,
      Buffer.from(signature, 'base64'),
    )
  }
}
