/**
 * collaboration — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import {
  arcaHostAvailable,
  arcaHostRequest,
  arcaKernelOrigin,
  arcaOriginThread,
} from './hostBridge'

export interface ArcaCollaborationAgent {
  id: string
  name: string
  avatarUrl?: string
}

export interface ArcaCollaborationTask {
  taskId: string
  documentId: string
  baseRevisionId: string
  instruction: string
  scope: 'selection' | 'section' | 'document'
  nodeId?: string
  agentId: string
  source?: 'local' | 'kernel'
  resultText?: string
  status:
    | 'queued'
    | 'working'
    | 'completed'
    | 'awaiting_review'
    | 'committed'
    | 'rejected'
    | 'failed'
    | 'cancelled'
  progress: number | null
  stage: string | null
  changeSetId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

class ArcaCollaborationClient {
  private readonly origin = arcaKernelOrigin()

  available(): boolean {
    return arcaHostAvailable()
  }

  async status(): Promise<{ available: boolean; agents: ArcaCollaborationAgent[] }> {
    return arcaHostRequest<{ available: boolean; agents: ArcaCollaborationAgent[] }>(
      'collaboration.status',
    )
  }

  /** 静态头像由角色资源接口提供，相对地址始终相对于 Kernel。 */
  avatarFor(agentId: string, resource?: string): string | undefined {
    if (resource?.startsWith('data:image/') && arcaHostAvailable()) return resource
    if (!this.origin || !agentId || agentId === 'arca-local' || agentId.startsWith('human:')) return
    const path = resource?.startsWith('/agents/') ? '/api' + resource : resource
    try {
      const url = new URL(
        path || '/api/agents/' + encodeURIComponent(agentId) + '/avatar',
        this.origin,
      )
      return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
    } catch {
      return undefined
    }
  }

  async create(input: {
    documentId: string
    instruction: string
    scope: 'selection' | 'section' | 'document'
    nodeId?: string
    agentId: string
    requirements?: string
    selection?: import('@infos/document-engine/office').OfficeSelection
    baseRevisionId?: string
  }): Promise<ArcaCollaborationTask> {
    const payload = { ...input, originThreadId: arcaOriginThread(input.agentId) }
    const storageKey = `arca.kernel-task.pending:${this.origin}:${input.documentId}`,
      serialized = JSON.stringify(payload)
    let pending: { payload: string; key: string } | undefined
    try {
      pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? undefined
    } catch {
      /* 损坏记录在下一次请求时替换。 */
    }
    if (!pending || pending.payload !== serialized)
      pending = { payload: serialized, key: crypto.randomUUID() }
    localStorage.setItem(storageKey, JSON.stringify(pending))
    const task = await arcaHostRequest<ArcaCollaborationTask>('collaboration.create', {
      ...payload,
      requestId: pending.key,
    })
    localStorage.removeItem(storageKey)
    return task
  }

  async list(documentId: string): Promise<ArcaCollaborationTask[]> {
    return arcaHostRequest<ArcaCollaborationTask[]>('collaboration.list', { documentId })
  }

  async cancel(taskId: string): Promise<ArcaCollaborationTask> {
    return arcaHostRequest<ArcaCollaborationTask>('collaboration.cancel', { taskId })
  }
}

export const arcaCollaborationClient = new ArcaCollaborationClient()
