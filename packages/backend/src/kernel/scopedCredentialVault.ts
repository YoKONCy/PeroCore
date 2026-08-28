/**
 * scopedCredentialVault — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import type {
  KernelCredentialHandle,
  KernelCredentialHandleId,
  KernelCredentialId,
  KernelCredentialObject,
  KernelExecutionId,
  KernelObjectRef,
} from '@infos/shared'
import { createResourceObjectRef } from '@infos/shared'
import type { LifecycleScope } from './lifecycleScope'

interface CredentialRecord {
  credential: KernelCredentialObject
  secret: string
}

export interface RegisterCredentialInput {
  ownerPrincipalId: string
  kind: string
  secret: string
  operations: readonly string[]
  originScope?: readonly string[]
  audience?: readonly string[]
  expiresAt?: string
}

export interface IssueCredentialHandleInput {
  credentialRef: KernelObjectRef
  subjectId: string
  operations: readonly string[]
  originScope?: readonly string[]
  audience?: readonly string[]
  expiresAt?: string
  maxUses?: number
  executionId?: KernelExecutionId
}

/** 秘密正文与可交付 Handle 分离的进程内 Credential Vault。 */
export class ScopedCredentialVault {
  private readonly credentials = new Map<string, CredentialRecord>()
  private readonly handles = new Map<KernelCredentialHandleId, KernelCredentialHandle>()

  register(input: RegisterCredentialInput): KernelCredentialObject {
    if (!input.secret) throw new Error('CREDENTIAL_SECRET_EMPTY: 凭据正文不能为空')
    const credentialId = randomUUID() as KernelCredentialId
    const credential: KernelCredentialObject = {
      credentialId,
      ref: createResourceObjectRef('credential', credentialId, input.ownerPrincipalId),
      kind: input.kind,
      originScope: input.originScope ? Object.freeze([...input.originScope]) : undefined,
      audience: input.audience ? Object.freeze([...input.audience]) : undefined,
      operations: Object.freeze([...new Set(input.operations)]),
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    }
    this.credentials.set(this.key(credential.ref), { credential, secret: input.secret })
    return structuredClone(credential)
  }

  issueHandle(input: IssueCredentialHandleInput, scope?: LifecycleScope): KernelCredentialHandle {
    const record = this.credentials.get(this.key(input.credentialRef))
    if (!record) throw new Error('CREDENTIAL_NOT_FOUND: 凭据不存在或 generation 已失效')
    if (input.operations.some((operation) => !record.credential.operations.includes(operation))) {
      throw new Error('CREDENTIAL_HANDLE_EXPANDS_OPERATION: Handle 不得扩大凭据操作')
    }
    this.assertScopeNarrows(record.credential.originScope, input.originScope, 'Origin')
    this.assertScopeNarrows(record.credential.audience, input.audience, 'Audience')
    if (
      record.credential.expiresAt &&
      (!input.expiresAt || input.expiresAt > record.credential.expiresAt)
    ) {
      throw new Error('CREDENTIAL_HANDLE_EXPANDS_EXPIRY: Handle 不得延长凭据有效期')
    }
    if (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses <= 0)) {
      throw new Error('CREDENTIAL_HANDLE_INVALID_USES: maxUses 必须是正整数')
    }
    const handleId = randomUUID() as KernelCredentialHandleId
    const handle: KernelCredentialHandle = {
      handleId,
      credentialRef: { ...input.credentialRef },
      subjectId: input.subjectId,
      operations: Object.freeze([...new Set(input.operations)]),
      originScope: input.originScope ? Object.freeze([...input.originScope]) : undefined,
      audience: input.audience ? Object.freeze([...input.audience]) : undefined,
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      maxUses: input.maxUses,
      remainingUses: input.maxUses,
      executionId: input.executionId,
    }
    this.handles.set(handleId, handle)
    scope?.defer(() => {
      this.revokeHandle(handleId)
    })
    return structuredClone(handle)
  }

  consume(input: {
    handleId: KernelCredentialHandleId
    subjectId: string
    operation: string
    origin?: string
    audience?: string
    executionId?: KernelExecutionId
  }): string {
    const handle = this.handles.get(input.handleId)
    if (!handle) throw new Error('CREDENTIAL_HANDLE_NOT_FOUND: 凭据 Handle 不存在')
    if (handle.revokedAt) throw new Error('CREDENTIAL_HANDLE_REVOKED: 凭据 Handle 已撤销')
    if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now()) {
      throw new Error('CREDENTIAL_HANDLE_EXPIRED: 凭据 Handle 已过期')
    }
    if (handle.subjectId !== input.subjectId) {
      throw new Error('CREDENTIAL_HANDLE_SUBJECT_DENIED: 主体不匹配')
    }
    if (handle.executionId && handle.executionId !== input.executionId) {
      throw new Error('CREDENTIAL_HANDLE_EXECUTION_DENIED: Execution 不匹配')
    }
    if (!handle.operations.includes(input.operation)) {
      throw new Error('CREDENTIAL_HANDLE_OPERATION_DENIED: 操作不在授权范围')
    }
    if (
      handle.originScope?.length &&
      (!input.origin || !handle.originScope.includes(input.origin))
    ) {
      throw new Error('CREDENTIAL_HANDLE_ORIGIN_DENIED: Origin 不在授权范围')
    }
    if (handle.audience?.length && (!input.audience || !handle.audience.includes(input.audience))) {
      throw new Error('CREDENTIAL_HANDLE_AUDIENCE_DENIED: Audience 不在授权范围')
    }
    if (handle.remainingUses !== undefined && handle.remainingUses <= 0) {
      throw new Error('CREDENTIAL_HANDLE_EXHAUSTED: 凭据 Handle 使用次数已耗尽')
    }
    const record = this.credentials.get(this.key(handle.credentialRef))
    if (!record || record.credential.revokedAt) {
      throw new Error('CREDENTIAL_REVOKED: 凭据已撤销或 generation 已失效')
    }
    if (record.credential.expiresAt && Date.parse(record.credential.expiresAt) <= Date.now()) {
      throw new Error('CREDENTIAL_EXPIRED: 凭据已过期')
    }
    if (handle.remainingUses !== undefined) handle.remainingUses -= 1
    return record.secret
  }

  revokeHandle(handleId: KernelCredentialHandleId): boolean {
    const handle = this.handles.get(handleId)
    if (!handle || handle.revokedAt) return false
    handle.revokedAt = new Date().toISOString()
    return true
  }

  revokeCredential(ref: KernelObjectRef): boolean {
    const record = this.credentials.get(this.key(ref))
    if (!record || record.credential.revokedAt) return false
    record.credential.revokedAt = new Date().toISOString()
    record.credential.ref = {
      ...record.credential.ref,
      generation: record.credential.ref.generation + 1,
    }
    return true
  }

  private assertScopeNarrows(
    parent: readonly string[] | undefined,
    child: readonly string[] | undefined,
    label: string,
  ): void {
    if (!parent?.length) return
    if (!child?.length || child.some((value) => !parent.includes(value))) {
      throw new Error(`CREDENTIAL_HANDLE_EXPANDS_SCOPE: ${label} Scope 不得扩大`)
    }
  }

  private key(ref: KernelObjectRef): string {
    return `${ref.objectType}:${ref.objectId}:${ref.generation}`
  }
}
