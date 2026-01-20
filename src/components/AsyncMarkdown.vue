<template>
  <div ref="container" class="async-markdown">
    <div v-if="!isRendered" class="skeleton-loader">
      <div class="skeleton-line" style="width: 100%"></div>
      <div class="skeleton-line" style="width: 80%"></div>
      <div class="skeleton-line" style="width: 60%"></div>
    </div>
    <div v-else class="markdown-body" v-html="renderedContent"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { marked } from 'marked'
import dompurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'

const props = defineProps({
  content: {
    type: String,
    required: true
  }
})

const container = ref(null)
const isRendered = ref(false)
const renderedContent = ref('')
let observer = null

// Configure marked with highlight.js
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : ''
  const highlighted = language 
    ? hljs.highlight(text, { language }).value 
    : hljs.highlightAuto(text).value
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
}

marked.use({ renderer })

const render = () => {
  if (isRendered.value) return
  
  // Custom Render Logic (migrated from DashboardView)
  let formatted = props.content || ''
  
  // 仅保留少数仍在使用的功能性 XML 标签 (如核心记忆)
  const triggers = [
    { tag: 'MEMORY', title: '核心记忆', icon: '💾' }
  ]

  const replacements = []
  
  // 1. 先提取触发器，替换为占位符
  triggers.forEach(({ tag, title, icon }) => {
    const regex = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'gi')
    formatted = formatted.replace(regex, (match, jsonStr) => {
      try {
        const cleanJson = jsonStr.trim()
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
        
        const data = JSON.parse(cleanJson)
        let detailsHtml = ''
        
        if (tag.toUpperCase() === 'MEMORY') {
          const tagHtml = (data.tags || []).map(t => `<span class="pero-tag">${t}</span>`).join('')
          detailsHtml = `
            <div class="pero-memory-content">${data.content || ''}</div>
            <div class="pero-tag-cloud">${tagHtml}</div>
          `
        }

        const placeholder = `PERO_TRIG_${replacements.length}_ID`
        replacements.push({
          placeholder,
          html: `<div class="trigger-block ${tag.toLowerCase()}">
            <details>
              <summary class="trigger-header">
                <span class="trigger-icon">${icon}</span>
                <span class="trigger-title">${title}</span>
                <span class="expand-arrow">▶</span>
              </summary>
              <div class="trigger-body">${detailsHtml}</div>
            </details>
          </div>`
        })
        return placeholder
      } catch (e) {
        return match
      }
    })
  })

  // 2. 解析 Markdown
  let html = marked.parse(formatted)

  // 3. 将占位符替换回 HTML
  replacements.forEach(({ placeholder, html: replacementHtml }) => {
    html = html.replace(placeholder, replacementHtml)
  })

  // 4. Sanitize
  let sanitized = dompurify.sanitize(html)

  // Fallback: If result is empty but source wasn't, use raw content (wrapped in p)
  if (!sanitized && formatted.trim().length > 0) {
      // Basic escape for raw content
      const escaped = formatted
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      sanitized = `<p>${escaped}</p>`
  }

  renderedContent.value = sanitized
  isRendered.value = true
}

onMounted(() => {
  // Always render immediately to avoid "empty" issues caused by IntersectionObserver delays or v-show interactions
  // Performance impact for 50 items is acceptable compared to invisible content
  render()
})

onUnmounted(() => {
  if (observer) observer.disconnect()
})

watch(() => props.content, () => {
  isRendered.value = false
  if (container.value && observer) {
      observer.observe(container.value)
  }
})
</script>

<style>
/* Global styles for markdown-body */
.markdown-body {
  font-size: 14px;
  line-height: 1.6;
}
/* Remove forced colors to allow inheritance */
.markdown-body pre {
  background-color: #282c34; /* Atom One Dark background */
  border-radius: 6px;
  padding: 1em;
  overflow-x: auto;
}
</style>

<style scoped>
.skeleton-loader {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 12px;
  background: #f0f2f5;
  border-radius: 4px;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.async-markdown {
    min-height: 40px; /* Prevent layout thrashing */
}
</style>