import type { TarotInterpretation, TarotReading, TarotToday } from '@infos/shared'
import { apiClient } from '../client'

export const tarotApi = {
  today: (agentId: string, timeZone: string) =>
    apiClient.get<TarotToday>(`/tarot/today?${new URLSearchParams({ agentId, timeZone })}`),
  draw: (agentId: string, timeZone: string, question: string, threadId?: string) =>
    apiClient.post<TarotReading>('/tarot/draw', { agentId, timeZone, question, threadId }),
  interpret: (id: string) =>
    apiClient.post<TarotInterpretation>(`/tarot/${encodeURIComponent(id)}/interpret`),
  history: (agentId: string) =>
    apiClient.get<TarotReading[]>(`/tarot/history?${new URLSearchParams({ agentId })}`),
}
