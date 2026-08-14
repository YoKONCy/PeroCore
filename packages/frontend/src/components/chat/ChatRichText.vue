<script setup lang="ts">
/**
 * ChatRichText — 聊天专用安全富文本
 *
 * 统一承载 Markdown、引号、XML、LaTeX 和代码高亮，并代理代码复制操作。
 */
import { computed } from 'vue'
import { renderChatRichText } from '../../lib/chatRichRenderer'
import { useNotificationStore } from '../../stores/useNotificationStore'

const props = defineProps<{ content: string; renderedHtml?: string; compact?: boolean }>()
const notify = useNotificationStore()
/** 流式消息可直接复用上游 30fps 渲染结果，历史消息则在本组件完整渲染。 */
const html = computed(() => props.renderedHtml ?? renderChatRichText(props.content))

async function handleClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]')
  if (!button) return
  try {
    const code = button.closest('.chat-code-block')?.querySelector('code')?.textContent ?? ''
    await navigator.clipboard.writeText(code)
    notify.toast('代码已复制', { type: 'success' })
  } catch {
    notify.toast('复制失败', { type: 'error' })
  }
}
</script>

<template>
  <!-- HTML 已在 chatRichRenderer 中经过 DOMPurify 净化。 -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div
    :class="['chat-rich-text', { 'chat-rich-text--compact': compact }]"
    @click="handleClick"
    v-html="html"
  />
</template>

<style src="katex/dist/katex.min.css"></style>
<style src="highlight.js/styles/github-dark-dimmed.min.css"></style>
<style>
:root,
[data-theme='light'] {
  --chat-quote-cn-double: #4f46e5;
  --chat-quote-cn-double-bg: rgba(99, 102, 241, 0.11);
  --chat-quote-en-double: #0284c7;
  --chat-quote-cn-single: #db2777;
  --chat-quote-cn-single-bg: rgba(236, 72, 153, 0.11);
  --chat-quote-en-single: #b45309;
  --chat-corner: #7c3aed;
  --chat-link: #0284c7;
  --chat-code-bg: #161b2a;
  --chat-code-head: #242b3d;
  --chat-code-border: rgba(99, 102, 241, 0.28);
  --chat-xml-tag: #db2777;
  --chat-xml-attr: #0284c7;
  --chat-xml-value: #b45309;
  --chat-math: #6d28d9;
  --chat-math-bg: rgba(224, 231, 255, 0.55);
  --chat-table-stripe: rgba(14, 165, 233, 0.045);
}

[data-theme='dark'] {
  --chat-quote-cn-double: #a5b4fc;
  --chat-quote-cn-double-bg: rgba(99, 102, 241, 0.19);
  --chat-quote-en-double: #67e8f9;
  --chat-quote-cn-single: #f9a8d4;
  --chat-quote-cn-single-bg: rgba(236, 72, 153, 0.16);
  --chat-quote-en-single: #fcd34d;
  --chat-corner: #c4b5fd;
  --chat-link: #67e8f9;
  --chat-code-bg: #0b1020;
  --chat-code-head: #161d31;
  --chat-code-border: rgba(167, 139, 250, 0.28);
  --chat-xml-tag: #f9a8d4;
  --chat-xml-attr: #67e8f9;
  --chat-xml-value: #fcd34d;
  --chat-math: #c4b5fd;
  --chat-math-bg: rgba(76, 29, 149, 0.17);
  --chat-table-stripe: rgba(56, 189, 248, 0.055);
}

.chat-rich-text {
  color: inherit;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.chat-rich-text > :first-child {
  margin-top: 0;
}
.chat-rich-text > :last-child {
  margin-bottom: 0;
}
.chat-rich-text p {
  margin: 0.45em 0;
}
.chat-rich-text h1,
.chat-rich-text h2,
.chat-rich-text h3,
.chat-rich-text h4,
.chat-rich-text h5,
.chat-rich-text h6 {
  position: relative;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.chat-rich-text h1 {
  font-size: 1.42em;
  color: transparent;
  background: linear-gradient(
    90deg,
    var(--ui-accent-primary),
    var(--ui-accent-purple),
    var(--ui-accent-sky)
  );
  background-clip: text;
}
.chat-rich-text h1::after {
  content: '';
  display: block;
  width: 64px;
  height: 2px;
  margin-top: 6px;
  background: linear-gradient(90deg, var(--ui-accent-primary), transparent);
}
.chat-rich-text h2 {
  padding-left: 10px;
  font-size: 1.22em;
}
.chat-rich-text h2::before {
  content: '';
  position: absolute;
  inset: 1px auto 1px 0;
  width: 3px;
  background: linear-gradient(var(--ui-accent-purple), var(--ui-accent-sky));
}
.chat-rich-text h3 {
  color: var(--ui-accent-purple);
  font-size: 1.08em;
}
.chat-rich-text h4 {
  color: var(--ui-accent-sky);
  font-size: 1em;
}
.chat-rich-text h5 {
  color: var(--ui-text-primary);
  font-size: 0.94em;
}
.chat-rich-text h6 {
  color: var(--ui-text-secondary);
  font-size: 0.88em;
}
.chat-rich-text strong {
  color: var(--ui-accent-primary);
  font-weight: 850;
}
.chat-rich-text em {
  color: var(--ui-accent-purple);
}
.chat-rich-text del {
  color: var(--ui-danger);
  text-decoration-color: color-mix(in srgb, var(--ui-danger) 65%, transparent);
}
.chat-rich-text a {
  color: var(--chat-link);
  font-weight: 700;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  transition:
    filter 0.15s,
    text-shadow 0.15s;
}
.chat-rich-text a:hover {
  filter: brightness(1.08);
  text-decoration-style: solid;
  text-shadow: 0 0 10px color-mix(in srgb, var(--chat-link) 32%, transparent);
}
.chat-link-mark {
  margin-left: 3px;
  font-size: 0.72em;
}
.chat-quote {
  padding: 0 0.18em;
  border-radius: 3px;
  font-weight: 700;
}
.chat-quote-cn-double {
  color: var(--chat-quote-cn-double);
  background: var(--chat-quote-cn-double-bg);
}
.chat-quote-en-double {
  color: var(--chat-quote-en-double);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.chat-quote-cn-single {
  color: var(--chat-quote-cn-single);
  background: var(--chat-quote-cn-single-bg);
}
.chat-quote-en-single {
  color: var(--chat-quote-en-single);
}
.chat-quote-corner,
.chat-quote-corner-double {
  color: var(--chat-corner);
  border: 1px solid color-mix(in srgb, var(--chat-corner) 35%, transparent);
  background: color-mix(in srgb, var(--chat-corner) 8%, transparent);
}
.chat-quote-corner-double {
  box-shadow:
    inset 2px 0 var(--ui-accent-primary),
    inset -2px 0 var(--ui-accent-sky);
}
.chat-rich-text :not(pre) > code,
.chat-xml-inline {
  padding: 2px 6px;
  color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 22%, transparent);
  border-radius: 3px;
  font-family: var(--ui-font-mono);
  font-size: 0.9em;
}
.chat-xml-tag {
  color: var(--chat-xml-tag);
  font-weight: 800;
}
.chat-xml-attr {
  color: var(--chat-xml-attr);
}
.chat-xml-value {
  color: var(--chat-xml-value);
}
.chat-code-block {
  margin: 10px 0;
  overflow: hidden;
  background: var(--chat-code-bg);
  border: 1px solid var(--chat-code-border);
  border-radius: 6px;
  box-shadow: 0 7px 20px rgba(15, 23, 42, 0.12);
}
.chat-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 31px;
  padding: 0 10px;
  color: #a5b4fc;
  background: var(--chat-code-head);
  border-bottom: 1px solid var(--chat-code-border);
  font: 700 9px var(--ui-font-pixel);
  letter-spacing: 0.1em;
}
.chat-code-head button {
  padding: 3px 7px;
  color: #67e8f9;
  background: transparent;
  border: 1px solid rgba(103, 232, 249, 0.2);
  cursor: pointer;
  font: 700 9px var(--ui-font-pixel);
}
.chat-code-head button:hover {
  background: rgba(103, 232, 249, 0.1);
}
.chat-code-block pre {
  margin: 0 !important;
  padding: 13px 15px !important;
  overflow: auto;
  background: transparent !important;
  border: 0 !important;
}
.chat-code-block code {
  padding: 0 !important;
  background: transparent !important;
  font-family: var(--ui-font-mono);
  font-size: 12px;
  line-height: 1.65;
}
.chat-math-inline {
  display: inline-flex;
  align-items: center;
  padding: 0 0.24em;
  color: var(--chat-math);
  background: var(--chat-math-bg);
  border-radius: 3px;
}
.chat-math-block {
  position: relative;
  margin: 10px 0;
  padding: 24px 14px 15px;
  overflow-x: auto;
  color: var(--chat-math);
  text-align: center;
  background-color: var(--chat-math-bg);
  background-image:
    linear-gradient(rgba(99, 102, 241, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99, 102, 241, 0.055) 1px, transparent 1px);
  background-size: 16px 16px;
  border: 1px solid color-mix(in srgb, var(--chat-math) 24%, transparent);
  border-radius: 5px;
}
.chat-math-label {
  position: absolute;
  top: 6px;
  left: 8px;
  font: 700 8px var(--ui-font-pixel);
  letter-spacing: 0.12em;
  opacity: 0.7;
}
.chat-rich-text blockquote {
  margin: 9px 0;
  padding: 8px 12px;
  color: var(--ui-text-secondary);
  background: linear-gradient(90deg, var(--ui-accent-purple-soft), transparent);
  border-left: 3px solid var(--ui-accent-purple);
}
.chat-rich-text ul,
.chat-rich-text ol {
  margin: 7px 0;
  padding-left: 22px;
}
.chat-rich-text li {
  margin: 3px 0;
}
.chat-rich-text li::marker {
  color: var(--ui-accent-primary);
  font-weight: 800;
}
.chat-rich-text hr {
  height: 2px;
  margin: 14px 0;
  background: linear-gradient(
    90deg,
    transparent,
    var(--ui-accent-purple),
    var(--ui-accent-sky),
    transparent
  );
  border: 0;
}
.chat-rich-text table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
.chat-rich-text th,
.chat-rich-text td {
  padding: 7px 10px;
  border: 1px solid var(--ui-border-default);
}
.chat-rich-text th {
  color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
}
.chat-rich-text tr:nth-child(even) {
  background: var(--chat-table-stripe);
}
.chat-rich-text img {
  max-width: 100%;
  border: 2px solid var(--ui-border-default);
  border-radius: 4px;
}
.chat-rich-text--compact {
  font-size: 12px;
  line-height: 1.62;
}

.msg-bubble-user .chat-rich-text {
  line-height: 1.45;
}
.msg-bubble-user .chat-rich-text p {
  margin: 0.18em 0;
}
.msg-bubble-user .chat-rich-text > :first-child {
  margin-top: 0;
}
.msg-bubble-user .chat-rich-text > :last-child {
  margin-bottom: 0;
}
.msg-bubble-user .chat-rich-text a {
  color: var(--user-bubble-link);
}
.msg-bubble-user .chat-rich-text strong {
  color: inherit;
}
.msg-bubble-user .chat-rich-text .chat-quote {
  color: inherit;
  background: var(--user-bubble-inline-bg);
  border-color: var(--user-bubble-inline-border);
}
.msg-bubble-user .chat-rich-text :not(pre) > code {
  color: var(--user-bubble-code);
  background: var(--user-bubble-inline-bg);
  border-color: var(--user-bubble-inline-border);
}

:root,
[data-theme='light'] {
  --user-bubble-link: #5f4b8b;
  --user-bubble-code: #65428a;
  --user-bubble-inline-bg: rgba(111, 82, 143, 0.08);
  --user-bubble-inline-border: rgba(111, 82, 143, 0.18);
}

[data-theme='dark'] {
  --user-bubble-link: #c8b6dc;
  --user-bubble-code: #d4bfeb;
  --user-bubble-inline-bg: rgba(190, 161, 216, 0.1);
  --user-bubble-inline-border: rgba(190, 161, 216, 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .chat-rich-text *,
  .chat-code-block * {
    transition: none !important;
  }
}
</style>
