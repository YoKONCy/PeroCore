export type ArcaHostAction =
  | 'status'
  | 'start'
  | 'stop'
  | 'reconnect'
  | 'collaboration.status'
  | 'collaboration.create'
  | 'collaboration.list'
  | 'collaboration.cancel'
const parameters = new URLSearchParams(window.location.search)
const desktop = (
  window as unknown as {
    electron?: { embedded?: boolean; invoke(channel: string, ...args: unknown[]): Promise<unknown> }
  }
).electron
const rawOrigin = parameters.get('kernelOrigin')

/** 宿主接入是显式可选项；独立模式不会探测 infOS 或猜测宿主地址。 */
export function arcaKernelOrigin(): string | undefined {
  if (parameters.get('standalone') === '1' || !rawOrigin) return
  try {
    const url = new URL(rawOrigin)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.origin !== window.location.origin &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
      return
    return url.origin
  } catch {
    return
  }
}
export function arcaHostAvailable(): boolean {
  return parameters.get('standalone') !== '1' && (!!desktop?.embedded || !!arcaKernelOrigin())
}
export function arcaOriginThread(agentId: string): string | undefined {
  return parameters.get('originAgentId') === agentId
    ? parameters.get('originThreadId') || undefined
    : undefined
}
export async function arcaHostRequest<T>(
  action: ArcaHostAction,
  input: Record<string, unknown> = {},
): Promise<T> {
  if (!arcaHostAvailable()) throw new Error('当前为独立运行模式')
  if (desktop?.embedded) {
    return (
      action.startsWith('collaboration.')
        ? desktop.invoke('arca-host:request', { action, input })
        : desktop.invoke('arca-host:control', action)
    ) as Promise<T>
  }
  const origin = arcaKernelOrigin()
  if (!origin) throw new Error('宿主连接地址无效')
  const routes: Record<ArcaHostAction, { path: string; method: string; body?: unknown }> = {
    status: { path: '/status', method: 'GET' },
    start: { path: '/start', method: 'POST' },
    stop: { path: '/stop', method: 'POST' },
    reconnect: { path: '/reconnect', method: 'POST' },
    'collaboration.status': { path: '/collaboration/status', method: 'GET' },
    'collaboration.create': { path: '/collaboration', method: 'POST', body: input },
    'collaboration.list': {
      path: `/collaboration?documentId=${encodeURIComponent(String(input.documentId))}`,
      method: 'GET',
    },
    'collaboration.cancel': {
      path: `/collaboration/${encodeURIComponent(String(input.taskId))}/cancel`,
      method: 'POST',
    },
  }
  const route = routes[action]
  const token =
    origin === window.location.origin ? sessionStorage.getItem('infos.currentServerToken') : null
  const response = await fetch(`${origin}/api/applications/arca${route.path}`, {
    method: route.method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  const result = (await response.json()) as { code: string; data: T; message?: string }
  if (!response.ok || !['OK', 'CREATED'].includes(result.code))
    throw new Error(result.message ?? `宿主请求失败：HTTP ${response.status}`)
  return result.data
}
