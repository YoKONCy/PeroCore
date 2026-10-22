// 正常等待只显示定稿图片与独立进度动效；错误由主进程提供本地化短文案。
const bridge = window.startupSplash
let revision = -1
const failure = document.querySelector('#failure')
const progress = document.querySelector('#progress')
function render(state) {
  if (!state || state.revision < revision) return
  const previouslyFailed = document.body.dataset.phase === 'failed'
  revision = state.revision
  document.documentElement.lang = state.language
  document.body.dataset.phase = state.phase
  progress.setAttribute('aria-label', state.labels.loading)
  document.querySelector('#close').setAttribute('aria-label', state.labels.close)
  document.querySelector('#failure-title').textContent = state.labels.title
  document.querySelector('#failure-message').textContent = state.labels.message
  for (const action of ['retry', 'logs', 'quit'])
    document.querySelector(`#${action}`).textContent = state.labels[action]
  failure.hidden = state.phase !== 'failed'
  document.querySelector('#status').textContent =
    state.phase === 'failed' ? state.labels.message : state.labels.loading
  if (state.phase === 'failed' && !previouslyFailed) document.querySelector('#retry').focus()
}
bridge.onState(render)
bridge
  .getState()
  .then(render)
  .catch(() => bridge.failed())
for (const action of ['retry', 'logs', 'quit'])
  document.querySelector(`#${action}`).addEventListener('click', () => bridge.action(action))
document.querySelector('#close').addEventListener('click', () => bridge.action('quit'))
// 必须等 PNG 解码及实际排版帧完成，不能在空白底上就通知主进程显示。
document
  .querySelector('#artwork')
  .decode()
  .then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => bridge.painted()))
  })
  .catch(() => bridge.failed())
