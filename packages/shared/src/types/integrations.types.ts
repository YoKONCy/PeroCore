export type ExtensionToolId = 'deepwiki' | 'sciverse'
export type IntegrationFeature = 'search' | 'pdf'
export type IntegrationProvider =
  | 'tavily'
  | 'brave'
  | 'searxng'
  | 'mineru-light'
  | 'mineru'
  | 'pdf-http'

export interface IntegrationSourceOptions {
  language: string
  ocr: boolean
  model: 'vlm' | 'pipeline'
  searchDepth: 'basic' | 'advanced'
  maxResults: number
}

export interface IntegrationSourceView {
  id: string
  name: string
  provider: IntegrationProvider
  endpoint: string
  options: IntegrationSourceOptions
  hasApiKey: boolean
  configured: boolean
}

export interface IntegrationFeatureView {
  enabled: boolean
  selectedSourceId: string | null
  sources: IntegrationSourceView[]
  ready: boolean
}

export interface ExtensionToolView {
  enabled: boolean
  chatEnabled: boolean
  endpoint: string
  hasApiKey: boolean
  configured: boolean
  ready: boolean
  maxResults: number
}

export interface IntegrationsView {
  extensions: Record<ExtensionToolId, ExtensionToolView>
  features: Record<IntegrationFeature, IntegrationFeatureView>
}

export interface IntegrationSourceInput {
  id?: string
  name: string
  provider: IntegrationProvider
  endpoint: string
  apiKey?: string
  clearApiKey?: boolean
  options?: Partial<IntegrationSourceOptions>
}

export const INTEGRATION_PROVIDERS: Array<{
  id: IntegrationProvider
  kind: IntegrationFeature
  name: string
  endpoint: string
  needsKey: boolean
  logo: string
}> = [
  {
    id: 'tavily',
    kind: 'search',
    name: 'Tavily',
    endpoint: 'https://api.tavily.com',
    needsKey: true,
    logo: 'tavily',
  },
  {
    id: 'brave',
    kind: 'search',
    name: 'Brave Search',
    endpoint: 'https://api.search.brave.com',
    needsKey: true,
    logo: 'brave',
  },
  {
    id: 'searxng',
    kind: 'search',
    name: 'SearXNG',
    endpoint: '',
    needsKey: false,
    logo: 'searxng',
  },
  {
    id: 'mineru-light',
    kind: 'pdf',
    name: 'MinerU 轻量解析',
    endpoint: 'https://mineru.net',
    needsKey: false,
    logo: 'mineru',
  },
  {
    id: 'mineru',
    kind: 'pdf',
    name: 'MinerU 精准解析',
    endpoint: 'https://mineru.net',
    needsKey: true,
    logo: 'mineru',
  },
  { id: 'pdf-http', kind: 'pdf', name: 'HTTP 解析服务', endpoint: '', needsKey: false, logo: '' },
]
