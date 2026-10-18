import { createHash } from 'node:crypto'
import type { ServiceProfile } from './domain'
import type { Store } from './store'
import { persistenceError, ServiceRequestError } from './requestSafety'

export interface SubmissionReceipt {
  id: string
  revision: number
  fingerprint: string
  credentialHash: string
  state: 'prepared' | 'sending' | 'received' | 'rejected'
  sentAt?: string
  receivedAt?: string
  response?: unknown
  retryable?: boolean
  error?: string
}
export class SubmissionJournal {
  constructor(private readonly store: Store) {}
  get(owner: string, key: string) {
    try {
      return this.store.get<SubmissionReceipt>(owner, 'service-request', this.id(key))
    } catch (error) {
      throw persistenceError(error)
    }
  }
  save(owner: string, key: string, value: Omit<SubmissionReceipt, 'id' | 'revision'>) {
    try {
      const old = this.get(owner, key)
      return this.store.put(
        owner,
        'service-request',
        { ...value, id: this.id(key) },
        old?.revision ?? 0,
      )
    } catch (error) {
      throw persistenceError(error, value.state === 'received' ? value.response : undefined)
    }
  }
  canReplay(service: ServiceProfile, receipt?: SubmissionReceipt) {
    return Boolean(
      service.idempotencyHeader &&
      service.idempotencyWindowMs &&
      receipt?.sentAt &&
      Date.now() - Date.parse(receipt.sentAt) < service.idempotencyWindowMs,
    )
  }
  verify(receipt: SubmissionReceipt, fingerprint: string, credentialHash: string) {
    // 未送达或明确拒绝的请求可以更新临时上传地址；已发送的请求必须保持原样。
    if (
      ['sending', 'received'].includes(receipt.state) &&
      (receipt.fingerprint !== fingerprint ||
        (receipt.state === 'sending' && receipt.credentialHash !== credentialHash))
    )
      throw new ServiceRequestError('原请求的内容或凭据已变化，请先核验提交结果', {
        ambiguousSubmission: true,
      })
  }
  private id(key: string) {
    return createHash('sha256').update(key).digest('hex')
  }
}

export async function payloadFingerprint(
  url: string,
  method: string,
  body: FormData | string | undefined,
) {
  const hash = createHash('sha256').update(JSON.stringify([method, url]))
  let size = 0
  const update = (value: string | Uint8Array) => {
    size += typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
    if (size > 100 * 1024 * 1024) throw new Error('请求内容超过 100 MB')
    hash.update(value)
  }
  if (body instanceof FormData)
    for (const [key, value] of body.entries()) {
      update(
        JSON.stringify([
          key,
          typeof value === 'string' ? 'text' : [value.type, value.size, value.name],
        ]),
      )
      if (typeof value === 'string') update(value)
      else {
        const reader = value.stream().getReader()
        try {
          for (;;) {
            const item = await reader.read()
            if (item.done) break
            update(item.value)
          }
        } finally {
          reader.releaseLock()
        }
      }
      update('\n')
    }
  else if (body !== undefined) update(body)
  return hash.digest('hex')
}
