/**
 * Popup — 浏览器桥接器弹窗逻辑
 *
 * 显示连接状态、重连按钮、重连次数。
 * 通过 chrome.runtime.sendMessage 与 Background 通信。
 *
 * @module packages/browser-extension/popup
 */

/** 刷新连接状态显示 */
function updateStatus() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    const statusSpan = document.getElementById('status')
    const attemptsSpan = document.getElementById('attempts')

    if (!response) return

    if (response.connected) {
      statusSpan.innerHTML = '<span class="indicator"></span>已连接'
      statusSpan.className = 'value status-connected'
    } else {
      statusSpan.innerHTML = '<span class="indicator"></span>未连接'
      statusSpan.className = 'value status-disconnected'
    }

    attemptsSpan.textContent = `${response.attempts || 0} 次`
  })
}

// ─── 事件绑定 ──────────────────────────────────────────

document.getElementById('reconnect').addEventListener('click', () => {
  const statusSpan = document.getElementById('status')
  statusSpan.innerHTML = '<span class="indicator"></span>正在连接...'
  statusSpan.className = 'value status-connecting'

  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    // 延迟刷新，让用户看到「正在连接」动画
    setTimeout(updateStatus, 1500)
  })
})

// ─── 初始化 ───────────────────────────────────────────
updateStatus()
// 弹窗打开期间每 2 秒自动刷新状态
setInterval(updateStatus, 2000)
