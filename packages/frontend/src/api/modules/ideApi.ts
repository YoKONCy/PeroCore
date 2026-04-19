/**
 * IDE API 模块
 *
 * 工作模式下的文件系统操作。
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
  readFile: (path: string) =>
    apiClient.post<FileContent>('/ide/file/read', { path }),

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
  deleteFile: (path: string) =>
    apiClient.post<void>('/ide/file/delete', { path }),
}
