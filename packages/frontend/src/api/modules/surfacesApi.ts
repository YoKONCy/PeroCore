/**
 * surfacesApi — API 契约适配层
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type {
  BackgroundTaskProjectionSnapshot,
  ConversationProjectionSnapshot,
  SurfaceInput,
} from '@infos/shared'
import { apiClient } from '../client'

export type SurfaceInputProjection =
  | ConversationProjectionSnapshot
  | BackgroundTaskProjectionSnapshot

export const surfacesApi = {
  submitInput: (input: SurfaceInput) =>
    apiClient.post<{ projection: SurfaceInputProjection }>('/surfaces/input', input),
}
