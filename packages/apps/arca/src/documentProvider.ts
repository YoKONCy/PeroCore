/**
 * documentProvider — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { randomUUID } from 'node:crypto'
import type { KernelEnvelope, KernelNodeId, KernelObjectId } from '@infos/shared'
import { projectDocumentSurface } from './documentSurfaceProjection'
import type { ArcaFederationState } from './federationState'
import type { ArcaDocumentContextProvider } from './documentContextProvider'
import { SurfaceSessionManager } from './surfaceSession'
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
}): NodeProvider {
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
            'document.create',
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
          'document.create',
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
      try {
        switch (operation) {
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
          case 'document.revision.list':
            return input.engine.listJournal(requireDocumentId(value)).map((entry) => ({
              revision: entry.revision,
            }))
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
            const base64 = requireString(value.base64, 'base64')
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
