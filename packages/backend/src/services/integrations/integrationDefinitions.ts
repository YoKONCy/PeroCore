import type { PackageManifest } from '@infos/shared'
import type { ToolDefinition } from '../pipeline/types'

export const EXTENSION_PACKAGES = {
  deepwiki: 'infos.extension.deepwiki',
  sciverse: 'infos.extension.sciverse',
} as const

export const integrationDefinitions: Record<'deepwiki' | 'sciverse' | 'search', ToolDefinition> = {
  deepwiki: {
    name: 'deepwiki_query',
    description: '查询公开 GitHub 仓库的 DeepWiki 文档并回答问题。',
    display: {
      label: '查询代码仓库',
      description: '向 DeepWiki 查询仓库文档。',
      icon: 'book',
      color: 'purple',
      style: 'search',
    },
    parameters: {
      type: 'object',
      properties: {
        repository: { type: 'string', description: 'GitHub owner/repo' },
        question: { type: 'string', maxLength: 2000 },
      },
      required: ['repository', 'question'],
      additionalProperties: false,
    },
  },
  sciverse: {
    name: 'sciverse_search',
    description: '检索学术文献与证据片段，或读取指定文献的原文。',
    display: {
      label: '检索学术资料',
      description: '查找文献和原文证据。',
      icon: 'book',
      color: 'sky',
      style: 'search',
    },
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2000, description: '检索问题或关键词' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        doc_id: {
          type: 'string',
          maxLength: 300,
          description: '读取原文时使用先前结果的文献 ID，替代 query',
        },
        offset: { type: 'integer', minimum: 0, maximum: 10000000, description: '原文读取偏移量' },
      },
      additionalProperties: false,
    },
  },
  search: {
    name: 'web_search',
    description: '搜索互联网，返回网页标题、链接和摘要；全文可用 web_fetch 读取。',
    display: {
      label: '联网搜索',
      description: '搜索网页和相关来源。',
      icon: 'search',
      color: 'sky',
      style: 'search',
    },
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2000 },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
}

export function officialExtensionManifest(id: 'deepwiki' | 'sciverse'): PackageManifest {
  return {
    manifestVersion: 2,
    packageId: EXTENSION_PACKAGES[id],
    name: id === 'deepwiki' ? 'DeepWiki' : 'Sciverse.space',
    version: '1.0.0',
    author: 'infOS',
    trust: 'official',
    permissions: ['network:internet'],
    contributions: [
      { id: `tool.${id}`, kind: 'tool', metadata: { definition: integrationDefinitions[id] } },
    ],
  }
}
