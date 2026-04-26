/**
 * Content Script — 页面内容提取与交互执行
 *
 * 注入到每个网页中，负责:
 * 1. 提取页面结构化内容 (转为 Markdown)
 * 2. 执行 Agent 的页面操作命令 (点击/输入/滚动)
 * 3. 将页面变更信息实时回传给 Background
 *
 * @module packages/browser-extension/content_script
 */

// ─── 页面内容提取 ─────────────────────────────────────

/**
 * 提取页面可见内容并转换为精简 Markdown
 * @returns {string} Markdown 格式的页面摘要
 */
function getSimplifiedContent() {
  let content = ''
  content += '# ' + document.title + '\n\n'
  content += 'URL: ' + window.location.href + '\n\n'

  const elements = document.body.querySelectorAll('h1, h2, h3, p, a, button, input, textarea')

  elements.forEach((el) => {
    if (el.offsetParent === null) return // 跳过隐藏元素

    // 检查元素或祖先是否被隐藏
    let current = el
    while (current) {
      if (
        current.getAttribute &&
        (current.getAttribute('aria-hidden') === 'true' ||
          current.style.display === 'none' ||
          current.style.visibility === 'hidden')
      ) {
        return
      }
      current = current.parentElement
    }

    let text = el.innerText ? el.innerText.trim() : ''
    if (!text && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      text = `[输入框: ${el.placeholder || el.name || el.id || '文本字段'}]`
    }

    if (text) {
      if (el.tagName.startsWith('H')) {
        content += `\n### ${text}\n`
      } else if (el.tagName === 'A') {
        content += `[链接: ${text}](${el.href})\n`
      } else if (el.tagName === 'BUTTON') {
        content += `[按钮: ${text}]\n`
      } else {
        content += `${text}\n`
      }
    }
  })

  return content
}

/** 向 Background 发送当前页面信息 */
function sendPageInfo() {
  chrome.runtime.sendMessage({
    type: 'pageInfoUpdate',
    data: {
      title: document.title,
      url: window.location.href,
      markdown: getSimplifiedContent(),
    },
  })
}

// ─── 命令执行 ─────────────────────────────────────────

/**
 * 查找页面元素 (支持多种定位策略)
 *
 * 优先级: XPath → CSS 选择器 → 精确文本 → 模糊文本 → 表单属性
 *
 * @param {string} target - 定位目标
 * @returns {Element|null}
 */
function findElement(target) {
  if (!target) return null
  const targetLower = target.toLowerCase()

  // 1. XPath
  if (target.startsWith('/') || target.startsWith('(')) {
    try {
      const result = document.evaluate(
        target,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      )
      if (result.singleNodeValue) return result.singleNodeValue
    } catch {
      /* 非法 XPath，继续尝试其他策略 */
    }
  }

  // 2. CSS 选择器
  try {
    const el = document.querySelector(target)
    if (el) return el
  } catch {
    /* 非法选择器，继续 */
  }

  // 3. 精确文本匹配 (忽略大小写)
  const interactiveElements = document.querySelectorAll(
    'button, a, p, span, h1, h2, h3, h4, h5, h6, label',
  )
  for (const el of interactiveElements) {
    const text = (el.innerText || '').trim().toLowerCase()
    if (text === targetLower && el.offsetParent !== null) return el
  }

  // 4. 模糊文本匹配 (返回最深层匹配)
  for (const el of interactiveElements) {
    const text = (el.innerText || '').trim().toLowerCase()
    if (text.includes(targetLower) && el.offsetParent !== null) {
      if (el.children.length === 0) return el
      // 检查子元素是否有更精确的匹配
      let hasMatchingChild = false
      for (const child of el.children) {
        if ((child.innerText || '').toLowerCase().includes(targetLower)) {
          hasMatchingChild = true
          break
        }
      }
      if (!hasMatchingChild) return el
    }
  }

  // 5. 表单元素属性匹配 (placeholder / name / id / aria-label)
  const formElements = document.querySelectorAll('input, textarea, [role="button"], [aria-label]')
  for (const el of formElements) {
    if (
      (el.placeholder && el.placeholder.toLowerCase().includes(targetLower)) ||
      (el.name && el.name.toLowerCase().includes(targetLower)) ||
      (el.id && el.id.toLowerCase().includes(targetLower)) ||
      el.getAttribute('aria-label')?.toLowerCase().includes(targetLower)
    ) {
      return el
    }
  }

  return null
}

/**
 * 执行页面操作命令
 * @param {string} command - 命令类型: click / type / scroll
 * @param {string} target - 目标元素定位
 * @param {string} text - 输入文本 (type/scroll 使用)
 * @returns {Promise<string>} 执行结果描述
 */
async function handleCommand(command, target, text) {
  if (command === 'click') {
    const el = findElement(target)
    if (!el) throw new Error(`未找到元素: ${target}`)
    el.click()
    return `点击了元素: ${target}`
  }

  if (command === 'type') {
    const el = findElement(target)
    if (!el) throw new Error(`未找到元素: ${target}`)
    el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return `在 ${target} 中输入了 "${text}"`
  }

  if (command === 'scroll') {
    const delta = text === 'up' ? -window.innerHeight / 2 : window.innerHeight / 2
    window.scrollBy(0, delta)
    return '已滚动'
  }

  throw new Error(`未知命令: ${command}`)
}

// ─── 消息监听 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'execute_command') {
    const { command, target, text } = message.data
    handleCommand(command, target, text)
      .then((result) => {
        sendResponse({
          status: 'success',
          result,
          page_content: getSimplifiedContent(),
        })
        sendPageInfo()
      })
      .catch((err) => {
        sendResponse({ status: 'error', error: err.toString() })
      })
    return true // 异步 sendResponse
  }

  if (message.type === 'getPageInfo') {
    sendPageInfo()
    sendResponse({ status: 'sent' })
  }
})

// ─── 初始化 ───────────────────────────────────────────
// 延迟发送确保页面 DOM 已就绪
setTimeout(sendPageInfo, 1000)
window.addEventListener('load', sendPageInfo)
