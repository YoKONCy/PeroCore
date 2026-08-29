/**
 * Arca Application Manifest
 *
 * Manifest 属于具体 Application，由 Arca Package 自身维护；Shared 只定义其协议结构。
 */
import type { ApplicationAdapterManifest } from '@infos/shared'

export const arcaManifest = {
  manifestVersion: 1,
  id: 'infos.arca',
  name: 'Arca',
  description: '自治式语义文档与创作工作站',
  adapterVersion: '1.0.0',
  protocolVersion: 1,
  application: {
    versions: '>=0.9.3-hotfix2 <1.0.0',
    transports: ['websocket'],
  },
  backend: { entry: '@infos/arca' },
  frontend: {
    entry: '@infos/arca/client',
    surfaces: [
      { surfaceId: 'workbench', title: 'Arca', slot: 'main.tab' },
      { surfaceId: 'settings', title: 'Arca设置', slot: 'settings' },
    ],
  },
  endpoints: [
    {
      endpointId: 'document',
      kind: 'resource',
      version: '1.0',
      operations: [
        'document.inspect',
        'document.context_regions',
        'document.changeset.list',
        'document.changeset.propose',
        'document.changeset.validate',
      ],
    },
    {
      endpointId: 'collaboration',
      kind: 'task',
      version: '1.0',
      operations: ['task.submit', 'task.get', 'task.cancel'],
    },
    {
      endpointId: 'surface',
      kind: 'surface',
      version: '1.0',
      operations: ['surface.bootstrap'],
    },
  ],
  offeredCapabilities: [
    {
      capabilityType: 'document.semantic',
      contractVersion: '1.0',
      endpointId: 'document',
      operations: [
        'document.inspect',
        'document.context_regions',
        'document.changeset.list',
        'document.changeset.propose',
        'document.changeset.validate',
      ],
      description: '提供语义文档读取、上下文区域与待审ChangeSet能力',
    },
    {
      capabilityType: 'application.task',
      contractVersion: '1.0',
      endpointId: 'collaboration',
      operations: ['task.submit', 'task.get', 'task.cancel'],
      description: '提供Arca文档协作任务生命周期',
    },
  ],
  toolProjections: [
    {
      name: 'arca_document_inspect',
      endpointId: 'document',
      operation: 'document.inspect',
      audience: 'host_agent',
      availability: 'while_ready',
      invocation: 'invoke',
      description: '读取Arca权威文档当前Snapshot与语义节点。',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId'],
      },
      display: {
        label: '查看Arca文档',
        description: '读取在线Arca中的文档结构。',
        icon: 'file',
        color: 'purple',
      },
    },
    {
      name: 'arca_context_regions',
      endpointId: 'document',
      operation: 'document.context_regions',
      audience: 'host_agent',
      availability: 'while_ready',
      invocation: 'invoke',
      description: '读取Arca为Agent生成的权威上下文区域，可按当前语义节点聚焦。',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' }, currentNodeId: { type: 'string' } },
        required: ['documentId'],
      },
      display: {
        label: '读取Arca上下文',
        description: '读取在线Arca提供的语义上下文。',
        icon: 'book',
        color: 'purple',
      },
    },
    {
      name: 'arca_changeset_propose',
      endpointId: 'document',
      operation: 'document.changeset.propose',
      audience: 'host_agent',
      availability: 'while_ready',
      invocation: 'invoke',
      description: '向Arca提交待人类审阅的语义ChangeSet。不得直接覆盖文档。',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          baseRevisionId: { type: 'string' },
          intent: { type: 'string' },
          explanation: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high', 'executable'] },
          expectedEffects: { type: 'array', items: { type: 'string' } },
          operations: { type: 'array', items: { type: 'object' }, minItems: 1 },
        },
        required: ['documentId', 'baseRevisionId', 'intent', 'explanation', 'risk', 'operations'],
      },
      display: {
        label: '提交Arca变更',
        description: '向在线Arca提交待审文档变更。',
        icon: 'edit',
        color: 'pink',
      },
      requiresApproval: true,
    },
    {
      name: 'arca_changeset_validate',
      endpointId: 'document',
      operation: 'document.changeset.validate',
      audience: 'host_agent',
      availability: 'while_ready',
      invocation: 'invoke',
      description: '验证已提交ChangeSet的Revision、Generation与Policy，不会提交文档。',
      parameters: {
        type: 'object',
        properties: { changeSetId: { type: 'string' } },
        required: ['changeSetId'],
      },
      display: {
        label: '验证Arca变更',
        description: '验证在线Arca中的待审变更。',
        icon: 'check',
        color: 'purple',
      },
    },
  ],
  requestedCapabilities: [
    {
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: ['read'],
      required: false,
      reason: '将已授权角色的人格投影用于文档协作',
    },
    {
      capabilityType: 'infos.knowledge',
      contractVersion: '1.0',
      operations: ['query'],
      required: false,
      reason: '按用户授权检索与文档任务相关的知识',
    },
    {
      capabilityType: 'infos.workspace',
      contractVersion: '1.0',
      operations: ['read', 'list'],
      required: false,
      reason: '读取用户明确授权的工作区资料',
    },
    {
      capabilityType: 'infos.model',
      contractVersion: '1.0',
      operations: ['generate'],
      required: false,
      reason: '使用infOS模型能力完成文档辅助生成',
    },
  ],
} as const satisfies ApplicationAdapterManifest
