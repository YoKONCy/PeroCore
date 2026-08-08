/**
 * IDE API 模块
 *
 * ⚠️ 架构过渡说明（AIOS 重构）：
 * 旧的"工作模式"（WorkView）是耦合在主 Agent 里的 IDE，语义在 AIOS 下已不成立：
 * - 重活（大规模 coding）→ 未来的独立 coding sub 应用
 * - 主 Agent 轻量编辑 → 计划合并到 ChatView 的综合面板
 *
 * 当前后端无 /api/ide 路由，这些 API 调用会 404。
 * 前端 WorkView + 组件保留供未来合并复用，但路由入口和此 API 模块待清理。
 * TODO: ChatView 综合面板重构时，迁移文件操作能力到新的语义下。
 */

import { apiClient } from '../client'

export interface IdeFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: IdeFileNode[]
}

export interface FileContent {
  path: string
  content: string
}

export const ideApi = {
  /** 获取文件树 */
  listFiles: (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : ''
    return apiClient.get<IdeFileNode[]>(`/ide/files${query}`)
  },

  /** 读取文件内容 */
  readFile: (path: string) => apiClient.post<FileContent>('/ide/file/read', { path }),

  /** 写入文件 */
  writeFile: (path: string, content: string) =>
    apiClient.post<void>('/ide/file/write', { path, content }),

  /** 创建文件/文件夹 */
  createFile: (path: string, isDirectory: boolean) =>
    apiClient.post<void>('/ide/file/create', { path, is_directory: isDirectory }),

  /** 重命名 */
  renameFile: (path: string, newName: string) =>
    apiClient.post<void>('/ide/file/rename', { path, new_name: newName }),

  /** 删除 */
  deleteFile: (path: string) => apiClient.post<void>('/ide/file/delete', { path }),
}
