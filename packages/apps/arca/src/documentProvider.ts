/** 文稿协议兼容层：校验会话和任务授权，再调用文稿权威与办公服务。 */
import { randomUUID } from 'node:crypto'
import { ArcaOfficeService } from './officeService'
import type { ArcaOfficeTasks, OfficeTaskInput } from './officeTasks'
import type { OfficeEditRequest, RevisionId } from '@infos/document-engine'
import type { KernelEnvelope, KernelNodeId, KernelObjectId } from '@infos/shared'
import { projectDocumentSurface } from './documentSurfaceProjection'
import type { ArcaFederationState } from './federationState'
import type { ArcaDocumentContextProvider } from './documentContextProvider'
import { SurfaceSessionManager } from './surfaceSession'
import type {
  ArcaCollaborationAuthority,
  ArcaCollaborationGrantInput,
} from './collaborationAuthority'
import { arcaHostAuthorized } from './hostCredentials'
import type { NodeProvider, NodeProviderContext } from '@infos/node-sdk'
import {
  ArcaPortableProjectPackage,
  ContentAddressedBlobStore,
  DocumentEngineError,
  SqliteDocumentEngine,
  projectMarkdown,
  type ChangeSetId,
  type CollaborationBatch,
  type CommentId,
  type CreateCommentInput,
  type DocumentId,
  type DocumentNodeId,
  type DocumentNodeType,
  type HumanTextEditInput,
  type OperationId,
  type ProposeChangeSetInput,
  type ReviewChangeSetInput,
} from '@infos/document-engine'

interface DocumentProviderInput {
  documentId?: DocumentId
  [key: string]: unknown
}

const READ_OPERATIONS = new Set([
  'document.changeset.preview',
  'office.task.list',
  'document.snapshot_at',
  'document.preview',
  'document.inspect',
  'document.list',
  'document.agent_scene',
  'document.context_regions',
  'document.project_presentation',
  'document.comment.list',
  'project.package.export',
  'document.changeset.get',
  'document.changeset.list',
  'document.changeset.diff',
  'document.project_markdown',
  'document.revision.list',
  'surface.bootstrap',
  'surface.session.challenge',
  'surface.session.complete',
  'federation.resume',
  'document.outbox.list',
  'blob.get',
])

export function createDocumentCapabilityProvider(input: {
  nodeId: KernelNodeId
  engine: SqliteDocumentEngine
  blobs: ContentAddressedBlobStore
  sessions: SurfaceSessionManager
  contextProvider: ArcaDocumentContextProvider
  packages: ArcaPortableProjectPackage
  federation: ArcaFederationState
  officeTasks?: ArcaOfficeTasks
  requestStop?: () => void
  office?: ArcaOfficeService
  collaboration?: ArcaCollaborationAuthority
  hostKey?: string
}): NodeProvider {
  const office = input.office ?? new ArcaOfficeService(input.engine, input.blobs)
  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.arca.document-authority',
      name: 'Arca Document Authority',
      version: '1.0.0',
      definition: {
        capabilityType: 'document.semantic',
        contractVersion: '1.0',
        operations: Object.fromEntries(
          [
            'application.stop',
            'collaboration.grant',
            'collaboration.get',
            'collaboration.revoke',
            'document.create',
            'document.duplicate',
            'document.set_status',
            'office.task.submit',
            'office.task.list',
            'office.task.cancel',
            'office.task.retry',
            'document.apply_edit',
            'document.snapshot_at',
            'document.restore_revision',
            'document.preview',
            'document.changeset.preview',
            'document.inspect',
            'document.list',
            'document.edit_text',
            'document.rename',
            'document.node.insert',
            'document.node.delete',
            'document.node.move',
            'document.revision.list',
            'document.agent_scene',
            'document.context_regions',
            'document.project_presentation',
            'document.comment.create',
            'document.comment.list',
            'document.comment.resolve',
            'document.collaboration.merge',
            'document.collaboration.merge_batch',
            'project.package.export',
            'project.package.import',
            'document.import_markdown',
            'document.project_markdown',
            'document.changeset.propose',
            'document.changeset.get',
            'document.changeset.list',
            'document.changeset.diff',
            'document.changeset.validate',
            'document.changeset.review',
            'document.changeset.commit',
            'document.outbox.list',
            'document.outbox.mark_published',
            'surface.bootstrap',
            'surface.session.challenge',
            'surface.session.complete',
            'surface.session.close',
            'federation.resume',
            'blob.put',
            'blob.get',
          ].map((operation) => [
            operation,
            {
              risk: READ_OPERATIONS.has(operation) ? 'read' : 'interact',
              idempotency: READ_OPERATIONS.has(operation) ? 'safe' : 'keyed',
            },
          ]),
        ),
      },
      offer: {
        offerId: `arca-document-authority:${input.nodeId}`,
        capabilityType: 'document.semantic',
        contractVersion: '1.0',
        operations: [
          'application.stop',
          'collaboration.grant',
          'collaboration.get',
          'collaboration.revoke',
          'document.create',
          'document.duplicate',
          'document.set_status',
          'office.task.submit',
          'office.task.list',
          'office.task.cancel',
          'office.task.retry',
          'document.apply_edit',
          'document.snapshot_at',
          'document.restore_revision',
          'document.preview',
          'document.changeset.preview',
          'document.inspect',
          'document.list',
          'document.edit_text',
          'document.rename',
          'document.node.insert',
          'document.node.delete',
          'document.node.move',
          'document.revision.list',
          'document.agent_scene',
          'document.context_regions',
          'document.project_presentation',
          'document.comment.create',
          'document.comment.list',
          'document.comment.resolve',
          'document.collaboration.merge',
          'document.collaboration.merge_batch',
          'project.package.export',
          'project.package.import',
          'document.import_markdown',
          'document.project_markdown',
          'document.changeset.propose',
          'document.changeset.get',
          'document.changeset.list',
          'document.changeset.diff',
          'document.changeset.validate',
          'document.changeset.review',
          'document.changeset.commit',
          'document.outbox.list',
          'document.outbox.mark_published',
          'surface.bootstrap',
          'surface.session.challenge',
          'surface.session.complete',
          'surface.session.close',
          'federation.resume',
          'blob.put',
          'blob.get',
        ],
        resourceKinds: ['document.semantic', 'document.blob'],
      },
    },
    health: () => 'available',
    async invoke(
      envelope: KernelEnvelope<{ operation: string; input: unknown }>,
      context: NodeProviderContext,
    ) {
      if (context.signal.aborted) throw new Error('DOCUMENT_INVOCATION_CANCELLED')
      const operation = envelope.payload.operation
      const value = objectInput(envelope.payload.input)
      if (!READ_OPERATIONS.has(operation)) requireIdempotency(context)
      const hostAuthorized =
        input.hostKey && arcaHostAuthorized(value.__arcaHostAuth, input.hostKey)
      if (operation.startsWith('collaboration.')) {
        if (!hostAuthorized || !input.collaboration) throw new Error('协作控制只允许已认证宿主访问')
        if (operation === 'collaboration.grant')
          return input.collaboration.create(value as unknown as ArcaCollaborationGrantInput)
        if (operation === 'collaboration.get')
          return input.collaboration.get(requireString(value.collaborationId, 'collaborationId'))
        if (operation === 'collaboration.revoke') {
          input.collaboration.revoke(requireString(value.collaborationId, 'collaborationId'))
          return { revoked: true }
        }
      }
      if (value.__arcaCollaborationId !== undefined) {
        if (!hostAuthorized || !input.collaboration) throw new Error('协作调用未授权')
        const grant = input.collaboration.require(value.__arcaCollaborationId, envelope.principalId)
        if (value.documentId !== undefined && value.documentId !== grant.documentId)
          throw new Error('不能访问其他文稿')
        if (operation === 'document.inspect')
          return input.collaboration.inspect(value.__arcaCollaborationId, envelope.principalId)
        if (operation === 'document.context_regions')
          return input.contextProvider.provideScoped(
            input.collaboration.inspect(value.__arcaCollaborationId, envelope.principalId),
            grant.collaborationId,
          )
        if (operation === 'document.changeset.propose')
          return input.collaboration.propose(
            value.__arcaCollaborationId,
            envelope.principalId,
            value as unknown as ProposeChangeSetInput,
          )
        if (operation === 'document.changeset.validate')
          return input.collaboration.validate(
            value.__arcaCollaborationId,
            envelope.principalId,
            value.changeSetId,
          )
        throw new Error('当前操作不属于协作授权范围')
      }
      try {
        switch (operation) {
          case 'application.stop': {
            input.sessions.require(value.surfaceSessionToken, 'edit', envelope.sourceNodeId)
            if (!input.requestStop) throw new Error('当前实例不支持从界面停止')
            input.requestStop()
            return { stopping: true }
          }
          case 'document.duplicate': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            return input.engine.duplicateDocument({
              documentId: requireDocumentId(value),
              baseRevisionId: requireString(value.baseRevisionId, 'baseRevisionId') as RevisionId,
              title: requireString(value.title, 'title'),
              principalId: session.principalId,
              transactionId: requireIdempotency(context),
              ...(value.content ? { content: value.content as OfficeEditRequest['content'] } : {}),
            })
          }
          case 'document.set_status': {
            const session = input.sessions.require(
                value.surfaceSessionToken,
                'edit',
                envelope.sourceNodeId,
              ),
              documentId = requireDocumentId(value),
              key = requireIdempotency(context),
              baseRevisionId = requireString(value.baseRevisionId, 'baseRevisionId') as RevisionId
            input.federation.requireWritable(documentId)
            return input.engine.transact({
              transactionId: key,
              documentId,
              baseRevisionId,
              actorPrincipalId: session.principalId,
              intent: '调整文稿归档或回收站状态',
              idempotencyKey: key,
              operations: [
                {
                  operationId: `${key}:status` as OperationId,
                  documentId,
                  baseRevisionId,
                  actorPrincipalId: session.principalId,
                  timestamp: requireString(value.timestamp, 'timestamp'),
                  type: 'document.set_status',
                  value: value.status as 'active' | 'archived' | 'deleted',
                },
              ],
            })
          }
          case 'document.changeset.preview':
            return office.previewChangeSet(
              requireString(value.changeSetId, 'changeSetId') as ChangeSetId,
            )
          case 'office.task.submit':
          case 'office.task.list':
          case 'office.task.cancel':
          case 'office.task.retry': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              operation === 'office.task.list' ? 'read' : 'edit',
              envelope.sourceNodeId,
            )
            if (!input.officeTasks) throw new Error('Arca 协作任务服务不可用')
            if (operation === 'office.task.list')
              return input.officeTasks.list(requireDocumentId(value), session.principalId)
            if (operation === 'office.task.cancel')
              return input.officeTasks.cancel(
                requireString(value.taskId, 'taskId'),
                session.principalId,
              )
            if (operation === 'office.task.retry')
              return input.officeTasks.retry(
                requireString(value.taskId, 'taskId'),
                session.principalId,
              )
            input.federation.requireWritable(requireDocumentId(value))
            return input.officeTasks.submit(
              {
                documentId: requireDocumentId(value),
                baseRevisionId: requireString(value.baseRevisionId, 'baseRevisionId') as RevisionId,
                instruction: requireString(value.instruction, 'instruction'),
                scope: value.scope as OfficeTaskInput['scope'],
                ...(typeof value.nodeId === 'string' ? { nodeId: value.nodeId } : {}),
                ...(value.selection
                  ? { selection: value.selection as OfficeTaskInput['selection'] }
                  : {}),
                ...(typeof value.requirements === 'string'
                  ? { requirements: value.requirements }
                  : {}),
                ...(typeof value.modelId === 'string' ? { modelId: value.modelId } : {}),
              },
              session.principalId,
              requireIdempotency(context),
            )
          }
          case 'document.apply_edit': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            const documentId = requireDocumentId(value)
            input.federation.requireWritable(documentId)
            return office.apply(
              {
                documentId,
                baseRevisionId: requireString(value.baseRevisionId, 'baseRevisionId') as RevisionId,
                transactionId: requireIdempotency(context),
                timestamp: requireString(value.timestamp, 'timestamp'),
                intent: requireString(value.intent, 'intent'),
                content: value.content as OfficeEditRequest['content'],
              },
              session.principalId,
            )
          }
          case 'document.snapshot_at':
            return input.engine.snapshotAt(
              requireDocumentId(value),
              requireString(value.revisionId, 'revisionId') as RevisionId,
            )
          case 'document.preview':
            return office.preview(
              requireDocumentId(value),
              typeof value.revisionId === 'string' ? (value.revisionId as RevisionId) : undefined,
            )
          case 'document.restore_revision': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            const documentId = requireDocumentId(value)
            input.federation.requireWritable(documentId)
            return office.restore(
              {
                documentId,
                baseRevisionId: requireString(value.baseRevisionId, 'baseRevisionId') as RevisionId,
                revisionId: requireString(value.revisionId, 'revisionId') as RevisionId,
                transactionId: requireIdempotency(context),
                timestamp: requireString(value.timestamp, 'timestamp'),
              },
              session.principalId,
            )
          }
          case 'document.create': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            return input.engine.createDocument({
              title: requireString(value.title, 'title'),
              language: typeof value.language === 'string' ? value.language : 'zh-CN',
              ownerPrincipalId: session.principalId,
              authorityNodeId: input.nodeId,
            })
          }
          case 'document.inspect':
            return input.engine.inspect(requireDocumentId(value))
          case 'document.list':
            return input.engine.listDocuments()
          case 'surface.session.challenge':
            return input.sessions.createChallenge({
              clientNodeId: requireString(value.clientNodeId, 'clientNodeId'),
              principalId: requireString(value.principalId, 'principalId'),
            })
          case 'surface.session.complete':
            return input.sessions.completeChallenge({
              challengeId: requireString(value.challengeId, 'challengeId'),
              nonce: requireString(value.nonce, 'nonce'),
              clientNodeId: requireString(value.clientNodeId, 'clientNodeId'),
              principalId: requireString(value.principalId, 'principalId'),
            })
          case 'surface.session.close':
            return { closed: input.sessions.close(value.surfaceSessionToken) }
          case 'federation.resume':
            return input.federation.resume(
              Array.isArray(value.kernelHeads) ? (value.kernelHeads as never) : [],
            )
          case 'surface.bootstrap': {
            const documents = input.engine.listDocuments()
            const requestedId =
              typeof value.documentId === 'string' ? (value.documentId as DocumentId) : undefined
            const active = requestedId ?? documents[0]?.documentId
            if (!active) return { documents, activeDocument: null, authorityState: 'unavailable' }
            const snapshot = input.engine.inspect(active)
            const markdown = projectMarkdown(input.engine, active)
            return {
              documents,
              authorityState: input.federation.state(active),
              activeDocument: {
                snapshot,
                outline: input.engine.projectOutline(active),
                markdown,
                surface: projectDocumentSurface(markdown, snapshot.document.ownerPrincipalId),
              },
            }
          }
          case 'document.import_markdown':
            return input.engine.importMarkdown({
              ...value,
              authorityNodeId: input.nodeId,
            } as never)
          case 'document.project_markdown':
            return projectMarkdown(input.engine, requireDocumentId(value))
          case 'document.edit_text': {
            const documentId = requireDocumentId(value)
            input.federation.requireWritable(documentId)
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            return input.engine.editText({
              ...(value as unknown as HumanTextEditInput),
              actorPrincipalId: session.principalId,
              idempotencyKey: requireIdempotency(context),
            })
          }
          case 'document.revision.list': {
            const authority = input.engine
              .exportCheckpoint()
              .authorities.find((item) => item.document.documentId === requireDocumentId(value))
            if (!authority) throw new Error('文稿不存在')
            const initial =
              authority.historyBase?.document.headRevisionId ??
              authority.revisions.find((revision) => revision.sequence === 0)?.revisionId
            const available = new Set(initial ? [initial] : [])
            for (const entry of authority.journal)
              if (available.has(entry.receipt.previousRevisionId))
                available.add(entry.revision.revisionId)
            available.add(authority.document.headRevisionId)
            return authority.revisions
              .sort((a, b) => a.sequence - b.sequence)
              .map((revision) => ({ revision, restorable: available.has(revision.revisionId) }))
          }
          case 'document.rename':
          case 'document.node.insert':
          case 'document.node.delete':
          case 'document.node.move': {
            const documentId = requireDocumentId(value)
            input.federation.requireWritable(documentId)
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            const snapshot = input.engine.inspect(documentId)
            const base = {
              operationId: randomUUID() as OperationId,
              documentId,
              actorPrincipalId: session.principalId,
              baseRevisionId: snapshot.revisionId,
              timestamp: new Date().toISOString(),
            }
            const documentOperation =
              operation === 'document.rename'
                ? {
                    ...base,
                    type: 'document.rename' as const,
                    value: requireString(value.title, 'title'),
                  }
                : operation === 'document.node.insert'
                  ? {
                      ...base,
                      type: 'node.insert' as const,
                      parentGeneration: requireInteger(value.parentGeneration, 'parentGeneration'),
                      node: {
                        nodeId: requireString(value.nodeId, 'nodeId') as DocumentNodeId,
                        type: requireNodeType(value.type),
                        parentId: requireString(value.parentId, 'parentId') as DocumentNodeId,
                        orderKey: requireString(value.orderKey, 'orderKey'),
                        ...(typeof value.text === 'string' ? { text: value.text } : {}),
                        attributes:
                          value.attributes && typeof value.attributes === 'object'
                            ? (value.attributes as never)
                            : {},
                      },
                    }
                  : operation === 'document.node.delete'
                    ? {
                        ...base,
                        type: 'node.delete' as const,
                        nodeId: requireString(value.nodeId, 'nodeId') as DocumentNodeId,
                        expectedGeneration: requireInteger(
                          value.expectedGeneration,
                          'expectedGeneration',
                        ),
                        recursive: value.recursive === true,
                      }
                    : {
                        ...base,
                        type: 'node.move' as const,
                        nodeId: requireString(value.nodeId, 'nodeId') as DocumentNodeId,
                        expectedGeneration: requireInteger(
                          value.expectedGeneration,
                          'expectedGeneration',
                        ),
                        newParentId: requireString(
                          value.newParentId,
                          'newParentId',
                        ) as DocumentNodeId,
                        newOrderKey: requireString(value.newOrderKey, 'newOrderKey'),
                        newParentGeneration: requireInteger(
                          value.newParentGeneration,
                          'newParentGeneration',
                        ),
                      }
            return input.engine.transact({
              transactionId: requireIdempotency(context),
              documentId,
              actorPrincipalId: session.principalId,
              baseRevisionId: snapshot.revisionId,
              operations: [documentOperation],
              intent: typeof value.intent === 'string' ? value.intent : operation,
              idempotencyKey: requireIdempotency(context),
            })
          }
          case 'document.agent_scene':
            return input.engine.projectAgentScene(
              requireDocumentId(value),
              typeof value.currentNodeId === 'string' ? (value.currentNodeId as never) : undefined,
            )
          case 'document.context_regions':
            return input.contextProvider.provide({
              documentId: requireDocumentId(value),
              ...(typeof value.currentNodeId === 'string'
                ? { currentNodeId: value.currentNodeId as never }
                : {}),
            })
          case 'document.project_presentation':
            return input.engine.projectPresentation(requireDocumentId(value))
          case 'document.comment.create': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            return input.engine.createComment({
              ...(value as unknown as CreateCommentInput),
              authorPrincipalId: session.principalId,
            })
          }
          case 'document.comment.list':
            return input.engine.listComments(
              requireDocumentId(value),
              typeof value.nodeId === 'string' ? (value.nodeId as never) : undefined,
            )
          case 'document.comment.resolve': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'review',
              envelope.sourceNodeId,
            )
            return input.engine.resolveComment(
              requireString(value.commentId, 'commentId') as CommentId,
              session.principalId,
            )
          }
          case 'document.collaboration.merge': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            const batch = value.batch as unknown as CollaborationBatch
            input.federation.requireWritable(batch.documentId)
            return input.engine.mergeCollaborationBatch({
              ...batch,
              actorId: session.principalId,
              operations: batch.operations.map((candidate) => ({
                ...candidate,
                actorPrincipalId: session.principalId,
              })),
            })
          }
          case 'document.collaboration.merge_batch': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'edit',
              envelope.sourceNodeId,
            )
            if (!Array.isArray(value.batches)) throw new Error('DOCUMENT_INPUT_INVALID: batches')
            const batches = value.batches as CollaborationBatch[]
            for (const batch of batches) input.federation.requireWritable(batch.documentId)
            return input.engine.mergeCollaborationBatches(
              batches.map((batch) => ({
                ...batch,
                actorId: session.principalId,
                operations: batch.operations.map((candidate) => ({
                  ...candidate,
                  actorPrincipalId: session.principalId,
                })),
              })),
            )
          }
          case 'project.package.export': {
            const packageBuffer = input.packages.export({
              projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
              title: requireString(value.title, 'title'),
              description: typeof value.description === 'string' ? value.description : undefined,
              documentIds: requireStringArray(value.documentIds, 'documentIds') as DocumentId[],
              historyMode: value.historyMode === 'full' ? 'full' : 'snapshot',
            })
            return { base64: packageBuffer.toString('base64'), byteLength: packageBuffer.length }
          }
          case 'project.package.import': {
            input.sessions.require(value.surfaceSessionToken, 'edit', envelope.sourceNodeId)
            const packageBuffer = Buffer.from(requireString(value.base64, 'base64'), 'base64')
            return input.packages.importAsCopy(packageBuffer, input.nodeId)
          }
          case 'document.changeset.propose': {
            if (input.collaboration) throw new Error('角色提案必须绑定有效的协作任务')
            const proposed = value as unknown as ProposeChangeSetInput
            return input.engine.propose({
              ...proposed,
              actorPrincipalId: envelope.principalId,
              actorKind: 'agent',
              operations: proposed.operations.map((operation) => ({
                ...operation,
                actorPrincipalId: envelope.principalId,
              })),
            })
          }
          case 'document.changeset.get':
            return input.engine.getChangeSet(
              requireString(value.changeSetId, 'changeSetId') as ChangeSetId,
            )
          case 'document.changeset.list':
            return input.engine.listChangeSets(requireDocumentId(value))
          case 'document.changeset.diff':
            return input.engine.diffChangeSet(
              requireString(value.changeSetId, 'changeSetId') as ChangeSetId,
            )
          case 'document.changeset.validate':
            return input.engine.validate(
              requireString(value.changeSetId, 'changeSetId') as ChangeSetId,
            )
          case 'document.changeset.review': {
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'review',
              envelope.sourceNodeId,
            )
            return input.engine.review({
              ...(value as unknown as ReviewChangeSetInput),
              reviewerPrincipalId: session.principalId,
            })
          }
          case 'document.changeset.commit': {
            const changeSetId = requireString(value.changeSetId, 'changeSetId') as ChangeSetId
            const changeSet = input.engine.getChangeSet(changeSetId)
            input.federation.requireWritable(changeSet.documentId)
            const session = input.sessions.require(
              value.surfaceSessionToken,
              'review',
              envelope.sourceNodeId,
            )
            return input.engine.commitChangeSet(changeSetId, {
              reviewerPrincipalId: session.principalId,
              idempotencyKey: requireIdempotency(context),
            })
          }
          case 'document.outbox.list':
            return input.engine.listPendingOutbox(Number(value.limit ?? 100))
          case 'document.outbox.mark_published':
            return {
              published: input.engine.markOutboxPublished(
                requireString(value.eventId, 'eventId'),
                typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
              ),
            }
          case 'blob.put': {
            input.sessions.require(value.surfaceSessionToken, 'edit', envelope.sourceNodeId)
            const base64 = requireString(value.base64, 'base64')
            if (
              base64.length > 28 * 1024 * 1024 ||
              base64.length % 4 !== 0 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
            )
              throw new Error('图片资源编码无效或超过 20 MB')
            if (Buffer.byteLength(base64, 'base64') > 20 * 1024 * 1024)
              throw new Error('资源不能超过 20 MB')
            return input.blobs.put(Buffer.from(base64, 'base64'))
          }
          case 'blob.get': {
            const blobId = requireString(value.blobId, 'blobId')
            return { blobId, base64: input.blobs.get(blobId).toString('base64') }
          }
          default:
            throw new Error(`DOCUMENT_OPERATION_UNKNOWN: ${operation}`)
        }
      } catch (error) {
        if (error instanceof DocumentEngineError) {
          throw new Error(`${error.kernelError.code}: ${error.kernelError.message}`)
        }
        throw error
      }
    },
  }
}

function objectInput(value: unknown): DocumentProviderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DOCUMENT_INPUT_INVALID: input 必须是对象')
  }
  return value as DocumentProviderInput
}

function requireDocumentId(input: DocumentProviderInput): DocumentId {
  return requireString(input.documentId, 'documentId') as DocumentId
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`DOCUMENT_INPUT_INVALID: ${name}`)
  return value
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`DOCUMENT_INPUT_INVALID: ${name} 必须是非空字符串数组`)
  }
  return value
}

function requireInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`DOCUMENT_INPUT_INVALID: ${name}必须是非负整数`)
  }
  return Number(value)
}

function requireNodeType(value: unknown): Exclude<DocumentNodeType, 'document-root'> {
  const allowed: Exclude<DocumentNodeType, 'document-root'>[] = [
    'section',
    'heading',
    'paragraph',
    'list',
    'list-item',
    'quote',
    'code-block',
    'asset',
    'table',
    'table-row',
    'table-cell',
    'citation',
  ]
  if (!allowed.includes(value as never)) {
    throw new Error('DOCUMENT_INPUT_INVALID: 不支持的节点类型')
  }
  return value as Exclude<DocumentNodeType, 'document-root'>
}

function requireIdempotency(context: NodeProviderContext): string {
  if (!context.idempotencyKey) throw new Error('DOCUMENT_IDEMPOTENCY_REQUIRED')
  return context.idempotencyKey
}

export function documentProviderObjectId(nodeId: KernelNodeId): KernelObjectId {
  return `${nodeId}/infos.arca.document-authority` as KernelObjectId
}
