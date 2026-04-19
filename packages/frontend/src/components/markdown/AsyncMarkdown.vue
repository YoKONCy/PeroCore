<script setup lang="ts">
/**
 * AsyncMarkdown — 异步 Markdown 渲染器
 *
 * 将 Markdown 文本渲染为安全 HTML，支持：
 * - 代码高亮 (highlight.js)
 * - DOMPurify 净化 (防止 XSS)
 * - 骨架加载占位
 * - XML 触发器展开 (<MEMORY>)
 *
 * @props content - Markdown 源文本
 * @see 12_FRONTEND_PERFORMANCE.md §3.2
 */
import { ref, watch, onMounted } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface Props {
  content: string
}

const props = defineProps<Props>()

const isRendered = ref(false)
const renderedContent = ref('')

/** 渲染 Markdown → 安全 HTML */
function render() {
  try {
    const raw = props.content || ''
    if (!raw.trim()) {
      renderedContent.value = ''
      isRendered.value = true
      return
    }

    // 1. 提取 <MEMORY> 触发器块，替换为占位符
    const replacements: { placeholder: string; html: string }[] = []
    let formatted = raw.replace(
      /<\s*MEMORY\s*>([\s\S]*?)<\s*\/\s*MEMORY\s*>/gi,
      (_match, jsonStr: string) => {
        try {
          const clean = jsonStr
            .trim()
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
          const data = JSON.parse(clean) as { content?: string; tags?: string[] }
          const tagHtml = (data.tags ?? [])
            .map((t) => `<span class="md-tag">${t}</span>`)
            .join('')
          const placeholder = `__PERO_MEM_${replacements.length}__`
          replacements.push({
            placeholder,
            html: `<div class="md-memory"><details><summary class="md-memory-header">核心记忆</summary><div class="md-memory-body">${data.content ?? ''}<div class="md-memory-tags">${tagHtml}</div></div></details></div>`,
          })
          return placeholder
        } catch {
          return _match
        }
      },
    )

    // 2. Markdown → HTML
    let html = marked.parse(formatted) as string

    // 3. 回填触发器
    for (const { placeholder, html: h } of replacements) {
      html = html.replace(placeholder, h)
    }

    // 4. DOMPurify 净化
    let sanitized = DOMPurify.sanitize(html)

    // 5. 降级：净化后为空但源不为空
    if (!sanitized && raw.trim()) {
      const escaped = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      sanitized = `<p>${escaped}</p>`
    }

    renderedContent.value = sanitized
    isRendered.value = true
  } catch (err) {
    renderedContent.value = `<div class="md-error">渲染失败: ${(err as Error).message}</div>`
    isRendered.value = true
  }
}

onMounted(() => render())

watch(() => props.content, () => render())
</script>

<template>
  <div class="async-markdown">
    <!-- 骨架加载 -->
    <div v-if="!isRendered" class="md-skeleton">
      <div class="md-skeleton-line" style="width: 100%" />
      <div class="md-skeleton-line" style="width: 80%" />
      <div class="md-skeleton-line" style="width: 60%" />
    </div>
    <!-- 渲染结果 -->
    <div v-else class="md-body" v-html="renderedContent" />
  </div>
</template>

<style scoped>
.async-markdown {
  min-height: 1.5em;
}

.md-skeleton {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.md-skeleton-line {
  height: 12px;
  background: var(--color-blue-50);
  animation: md-pulse 1.5s infinite;
}

@keyframes md-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.md-error {
  padding: 12px;
  font-size: 12px;
  color: var(--color-red-500);
  background: var(--color-red-100);
  border: 1px solid var(--color-red-200);
}
</style>

<!-- 全局 markdown-body 样式 (unscoped) -->
<style>
.md-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text-primary);
  word-break: break-word;
}
.md-body p { margin: 0.5em 0; }
.md-body h1, .md-body h2, .md-body h3 {
  font-weight: 800;
  margin: 1em 0 0.5em;
  color: var(--color-text-primary);
}
.md-body h1 { font-size: 1.4em; }
.md-body h2 { font-size: 1.2em; }
.md-body h3 { font-size: 1.1em; }
.md-body code {
  padding: 2px 6px;
  background: var(--color-blue-50);
  border: 1px solid var(--color-blue-100);
  font-family: monospace;
  font-size: 0.9em;
}
.md-body pre {
  padding: 16px;
  background: #1e293b;
  border: 2px solid var(--color-border);
  overflow-x: auto;
  margin: 0.5em 0;
}
.md-body pre code {
  padding: 0;
  background: none;
  border: none;
  color: #e2e8f0;
}
.md-body ul, .md-body ol {
  padding-left: 1.5em;
  margin: 0.5em 0;
}
.md-body li { margin: 0.25em 0; }
.md-body blockquote {
  border-left: 3px solid var(--color-blue-400);
  padding: 8px 16px;
  margin: 0.5em 0;
  background: var(--color-blue-50);
  color: var(--color-text-secondary);
}
.md-body a {
  color: var(--color-blue-500);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.md-body a:hover { color: var(--color-blue-400); }
.md-body img {
  max-width: 100%;
  border: 2px solid var(--color-border);
}
.md-body table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.md-body th, .md-body td {
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  font-size: 13px;
}
.md-body th {
  background: var(--color-blue-50);
  font-weight: 700;
}

/* 记忆触发器 */
.md-memory {
  border: 2px solid var(--color-blue-200);
  margin: 8px 0;
}
.md-memory-header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-blue-600);
  background: var(--color-blue-50);
  cursor: pointer;
  user-select: none;
}
.md-memory-body {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
}
.md-memory-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.md-tag {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  background: var(--color-blue-100);
  color: var(--color-blue-600);
}
</style>
