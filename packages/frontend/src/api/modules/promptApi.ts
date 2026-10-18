import { apiClient } from '../client'
import type {
  PromptBundle,
  PromptIssue,
  PromptPreview,
  PromptRelease,
  PromptWorkspaceView,
  SillyTavernImport,
} from '@infos/shared'

export const promptApi = {
  get: () => apiClient.get<PromptWorkspaceView>('/prompts'),
  variables: (scope = '$global') =>
    apiClient.get<{
      global: Record<string, string>
      values: Record<string, string>
      sessions: Array<{ scope: string; count: number }>
    }>(`/prompts/variables?scope=${encodeURIComponent(scope)}`),
  resetVariables: (scope?: string) => apiClient.post<void>('/prompts/variables/reset', { scope }),
  importSillyTavern: (preset: unknown, name: string, profile?: number) =>
    apiClient.post<SillyTavernImport>('/prompts/import/sillytavern', { preset, name, profile }),
  exportSillyTavern: (bundle: PromptBundle, frameworkId: string) =>
    apiClient.post<Record<string, unknown>>('/prompts/export/sillytavern', { bundle, frameworkId }),
  save: (bundle: PromptBundle, revision: number) =>
    apiClient.put<PromptWorkspaceView>('/prompts/draft', { bundle, revision }),
  validate: (bundle: PromptBundle) =>
    apiClient.post<PromptIssue[]>('/prompts/validate', { bundle }),
  publish: (revision: number, note: string) =>
    apiClient.post<PromptWorkspaceView>('/prompts/publish', { revision, note }),
  version: (id: string) =>
    apiClient.get<PromptRelease>(`/prompts/versions/${encodeURIComponent(id)}`),
  restore: (id: string, revision: number) =>
    apiClient.post<PromptWorkspaceView>('/prompts/restore', { id, revision }),
  preview: (input: {
    bundle: PromptBundle
    channel: string
    agentId: string
    frameworkId?: string
    taskId?: string
    variables: Record<string, unknown>
  }) => apiClient.post<PromptPreview>('/prompts/preview', input),
}
