/**
 * 统一任务中心 UI 底座 — 组件与共享类型出口
 *
 * 说明:
 * - TaskToast / TaskToastContainer 独立于现有 notification 体系
 * - 挂载位置由使用方自行决定（默认不侵入 App.vue）
 */

import TaskToast from './TaskToast.vue'
import TaskToastContainer from './TaskToastContainer.vue'

export { TaskToast, TaskToastContainer }

// ── 类型定义 ──

/** 任务 toast 类型 */
export type TaskToastType =
  | 'task_started'
  | 'task_progress'
  | 'task_approval_requested'
  | 'task_completed'
  | 'task_failed'
  | 'info'

/** 单条任务 toast 数据结构 */
export interface TaskToastItem {
  id: string
  type: TaskToastType
  agentId?: string // 可选，用于显示角色小头像
  avatarUrl?: string // 角色头像 url
  actorName?: string // 角色名 (例如 "Pero" / "Nana")
  title: string
  message: string
  progress?: number | null // 0-100，null/undefined 表示无进度
  taskId?: string // 关联的 background task id（未来点击跳转用）
  createdAt: number
}
