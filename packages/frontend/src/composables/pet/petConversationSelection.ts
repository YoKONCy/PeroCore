import { getApiBaseUrl } from '../../api/transport'

/** 按服务端与角色记住桌宠会话，重连不能擅自跳到其他 Thread。 */
function key(agentId: string): string {
  return `infos.pet.thread:${getApiBaseUrl()}:${agentId}`
}
export function readPetThread(agentId: string): string | null {
  try {
    return localStorage.getItem(key(agentId)) || null
  } catch {
    return null
  }
}
export function rememberPetThread(agentId: string, threadId: string | null): void {
  try {
    if (threadId) localStorage.setItem(key(agentId), threadId)
    else localStorage.removeItem(key(agentId))
  } catch {
    /* 存储不可用时保留当前窗口内的选择。 */
  }
}
