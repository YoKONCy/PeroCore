/** 启动脚本不依赖 TypeScript 加载器，与共享运行时保持相同的 Electron 环境边界。 */
function electronProcessEnvironment(environment, mode = 'app') {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete clean[key]
  }
  if (mode === 'node') clean.ELECTRON_RUN_AS_NODE = '1'
  return clean
}

module.exports = { electronProcessEnvironment }
