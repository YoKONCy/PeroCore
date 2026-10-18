/** 只清理即将交给 Electron 可执行文件的环境，不修改父进程或普通 Node 任务。 */
export function electronProcessEnvironment(
  environment: Record<string, string | undefined>,
  mode: 'app' | 'node' = 'app',
): Record<string, string | undefined> {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete clean[key]
  }
  if (mode === 'node') clean.ELECTRON_RUN_AS_NODE = '1'
  return clean
}
