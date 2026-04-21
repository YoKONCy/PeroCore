/**
 * Background Service Worker — 浏览器桥接后台服务
 *
 * 通过 WebSocket 与 PeroCore 后端通信，实现 Agent 对浏览器的远程控制。
 *
 * 职责:
 * 1. 维护与后端的 WS 长连接 (含指数退避重连 + 心跳)
 * 2. 接收后端命令并分发给 Content Script 或直接执行
 * 3. 将页面信息 / 命令结果回传后端
 * 4. 响应 Popup 状态查询
 *
 * @module packages/browser-extension/background
 */

// ─── 连接状态 ─────────────────────────────────────────
let socket = null
let isConnected = false
let reconnectAttempts = 0

/** 后端 WebSocket 地址 */
const WS_URL = 'ws://localhost:9120/ws/browser'
const RECONNECT_ALARM = 'reconnect-alarm'
const CHECK_ALARM = 'check-connection-alarm'

// ─── WebSocket 连接管理 ────────────────────────────────

/** 建立 WebSocket 连接 */
function connect() {
  if (socket) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      console.log('[Pero] Socket 已打开或正在连接，跳过')
      return
    }
    socket.close()
  }

  console.log(`[Pero] 正在连接 ${WS_URL} (第 ${reconnectAttempts + 1} 次)...`)
  socket = new WebSocket(WS_URL)

  socket.onopen = () => {
    console.log('[Pero] ✓ 已连接到后端')
    isConnected = true
    reconnectAttempts = 0
    chrome.alarms.clear(RECONNECT_ALARM)
    // 连接成功后启动定期检查
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 1 })
    startHeartbeat()
    // 连接后立即获取活动标签页信息
    requestPageInfo()
  }

  socket.onmessage = (event) => {
    try {
      // 心跳响应
      if (event.data === 'pong') return

      const message = JSON.parse(event.data)
      console.log('[Pero] 收到消息:', message)

      if (message.type === 'command') {
        handleCommand(message.data)
      }
    } catch (e) {
      console.error('[Pero] 解析消息失败:', e)
    }
  }

  socket.onclose = (event) => {
    console.log(`[Pero] 连接断开 (code: ${event.code})`)
    isConnected = false
    socket = null
    stopHeartbeat()

    // 指数退避重连
    const delayMs = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000)
    console.log(`[Pero] 将在 ${delayMs}ms 后重连`)

    chrome.alarms.create(RECONNECT_ALARM, {
      delayInMinutes: Math.max(1 / 60, delayMs / 60000),
    })
    reconnectAttempts++
  }

  socket.onerror = (error) => {
    console.error('[Pero] WebSocket 错误:', error)
  }
}

// ─── 心跳机制 ──────────────────────────────────────────

let heartbeatInterval = null

function startHeartbeat() {
  stopHeartbeat()
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send('ping')
    }
  }, 30000) // 每 30 秒一次
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

// ─── 页面信息收集 ──────────────────────────────────────

/** 受保护的 URL 前缀 (无法注入脚本) */
const PROTECTED_PREFIXES = ['chrome://', 'edge://', 'about:', 'chrome-extension://']

/** 检查是否为受保护页面 */
function isProtectedUrl(url) {
  return url && PROTECTED_PREFIXES.some((p) => url.startsWith(p))
}

/** 向活动标签页请求页面信息 */
function requestPageInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return
    const tabId = tabs[0].id
    const url = tabs[0].url

    if (isProtectedUrl(url)) {
      console.log('[Pero] 跳过受保护页面:', url)
      return
    }

    chrome.tabs.sendMessage(tabId, { type: 'getPageInfo' }, () => {
      if (chrome.runtime.lastError) {
        console.log('[Pero] Content Script 未就绪，尝试注入...')
        injectContentScript(tabId, () => {
          chrome.tabs.sendMessage(tabId, { type: 'getPageInfo' })
        })
      }
    })
  })
}

/** 注入 Content Script (带安全检查) */
function injectContentScript(tabId, callback, errorCallback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      errorCallback?.(chrome.runtime.lastError)
      return
    }

    if (isProtectedUrl(tab.url)) {
      const msg = `无法在受保护页面注入脚本: ${tab.url}`
      console.warn('[Pero]', msg)
      errorCallback?.({ message: msg })
      return
    }

    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content_script.js'] },
      () => {
        if (chrome.runtime.lastError) {
          console.error('[Pero] 注入失败:', chrome.runtime.lastError.message)
          errorCallback?.(chrome.runtime.lastError)
        } else {
          console.log('[Pero] Content Script 注入成功')
          callback?.()
        }
      },
    )
  })
}

// ─── 命令处理 ──────────────────────────────────────────

/** 将命令结果回传后端 */
function sendCommandResult(requestId, result) {
  if (socket && isConnected && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'command_result',
      data: { requestId, ...result },
    }))
  }
}

/** 分发并执行命令 */
function handleCommand(commandData) {
  const { command, requestId } = commandData

  // 导航类命令: 直接在 Background 执行
  if (command === 'open_url') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: commandData.url }, () => {
          sendCommandResult(requestId, { status: 'success', result: '导航已开始' })
        })
      } else {
        chrome.tabs.create({ url: commandData.url }, () => {
          sendCommandResult(requestId, { status: 'success', result: '在新标签页中开始导航' })
        })
      }
    })
    return
  }

  if (command === 'back') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.goBack(tabs[0].id, () => {
          sendCommandResult(requestId, { status: 'success', result: '已后退' })
        })
      } else {
        sendCommandResult(requestId, { error: '未找到活动标签页' })
      }
    })
    return
  }

  if (command === 'refresh') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.reload(tabs[0].id, {}, () => {
          sendCommandResult(requestId, { status: 'success', result: '页面已刷新' })
        })
      } else {
        sendCommandResult(requestId, { error: '未找到活动标签页' })
      }
    })
    return
  }

  // 其他命令: 转发给 Content Script 执行
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      sendCommandResult(requestId, { error: '未找到活动标签页' })
      return
    }

    const tabId = tabs[0].id
    chrome.tabs.sendMessage(tabId, { type: 'execute_command', data: commandData }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Pero] Content Script 通信失败:', chrome.runtime.lastError)
        // 尝试注入后重试
        injectContentScript(
          tabId,
          () => {
            chrome.tabs.sendMessage(tabId, { type: 'execute_command', data: commandData }, (retryRes) => {
              if (chrome.runtime.lastError) {
                sendCommandResult(requestId, { error: chrome.runtime.lastError.message })
              } else {
                sendCommandResult(requestId, retryRes)
              }
            })
          },
          (err) => {
            sendCommandResult(requestId, { error: '注入 Content Script 失败: ' + err.message })
          },
        )
      } else {
        sendCommandResult(requestId, response)
      }
    })
  })
}

// ─── 事件监听 ──────────────────────────────────────────

// Alarm: 重连 / 连接状态检查
chrome.alarms.onAlarm.addListener((alarm) => {
  if ((alarm.name === RECONNECT_ALARM || alarm.name === CHECK_ALARM) && !isConnected) {
    console.log('[Pero] Alarm 触发，尝试重连...')
    connect()
  }
})

// 标签页切换 / 加载完成 → 检查连接
chrome.tabs.onActivated.addListener(() => {
  if (!isConnected) connect()
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && !isConnected) connect()
})

// 来自 Content Script / Popup 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'pageInfoUpdate') {
    // 转发页面信息给后端
    if (socket && isConnected && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'page_info', data: message.data }))
    }
  } else if (message.type === 'getStatus') {
    sendResponse({
      connected: isConnected,
      attempts: reconnectAttempts,
      url: WS_URL,
    })
  } else if (message.type === 'reconnect') {
    reconnectAttempts = 0
    connect()
    sendResponse({ status: '尝试重连中' })
  }
})

// ─── 启动 ─────────────────────────────────────────────
connect()
