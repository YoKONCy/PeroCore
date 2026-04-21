<template>
  <div class="mdp-graph">
    <!-- Client Section -->
    <div class="node-row">
      <div class="node client">
        <span class="icon">💼</span>
        <span class="label">Client Service<br /><small>业务服务 (如 ChatService)</small></span>
      </div>
    </div>

    <div class="connection vertical">
      <span class="desc">1. Request Render (Context) / 请求渲染 (上下文)</span>
      <span class="arrow">↓</span>
    </div>

    <!-- Manager Section -->
    <div class="node-row">
      <div class="node manager main-node">
        <span class="icon">⚙️</span>
        <span class="label">MDP Manager<br /><small>提示词管理器</small></span>
      </div>
    </div>

    <div class="split-container">
      <div class="connection-branch left">
        <span class="arrow-up">↑</span>
        <span class="desc">2. Load Templates / 加载模板</span>
        <div class="storage-box">
          <div class="storage-item common">
            <span class="icon">📁</span>
            <span class="label">prompts/<br /><small>通用组件仓库</small></span>
          </div>
          <div class="storage-item agent">
            <span class="icon">👤</span>
            <span class="label">agents/{name}/<br /><small>Agent 特有覆盖</small></span>
          </div>
        </div>
      </div>

      <div class="connection-branch right">
        <span class="arrow-up">↑</span>
        <span class="desc">3. Inject Variables / 注入变量</span>
        <div class="context-box">
          <span class="icon">🧬</span>
          <span class="label"
            >Runtime Context<br /><small>运行时上下文 (Time, Memory...)</small></span
          >
        </div>
      </div>
    </div>

    <div class="connection vertical">
      <span class="arrow">↓</span>
      <span class="desc">4. Jinja2 Engine (Recursive) / Jinja2 引擎 (递归渲染)</span>
    </div>

    <!-- Engine Section -->
    <div class="node-row">
      <div class="node engine">
        <span class="icon">🔥</span>
        <span class="label">Jinja2 Engine<br /><small>递归渲染引擎 (Max Depth: 5)</small></span>
        <div class="recursion-loop">🔄</div>
      </div>
    </div>

    <div class="connection vertical">
      <span class="arrow">↓</span>
      <span class="desc">5. Final Prompt / 生成最终提示词</span>
    </div>

    <!-- Result Section -->
    <div class="node-row">
      <div class="node result">
        <span class="icon">📝</span>
        <span class="label">System Prompt<br /><small>最终生成的提示词</small></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mdp-graph {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  user-select: none;
  font-family: var(--vp-font-family-base);
}

.node-row {
  display: flex;
  justify-content: center;
  width: 100%;
}

.node {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.8rem 1.2rem;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  min-width: 160px;
  position: relative;
}

.node:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: var(--vp-c-brand);
}

.node .icon {
  font-size: 1.5rem;
  margin-bottom: 0.4rem;
}

.node .label {
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 1.2;
}

.node small {
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
  font-weight: normal;
}

/* Specific Node Styles */
.node.client {
  border-color: #3b82f6;
}

.node.manager {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
  z-index: 2;
}

.node.engine {
  border-color: #ef4444;
}

.node.result {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

/* Recursion Loop Icon */
.recursion-loop {
  position: absolute;
  right: -10px;
  top: -10px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Connections */
.connection {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--vp-c-text-3);
  font-size: 0.75rem;
  padding: 0.5rem 0;
}

.connection .arrow {
  font-size: 1.2rem;
  color: var(--vp-c-brand);
}

/* Split/Branch Layout */
.split-container {
  display: flex;
  justify-content: space-between;
  width: 100%;
  max-width: 500px;
  margin: -10px 0;
}

.connection-branch {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 45%;
  color: var(--vp-c-text-3);
  font-size: 0.75rem;
}

.arrow-up {
  font-size: 1.2rem;
  color: var(--vp-c-brand);
  margin-bottom: 2px;
}

.storage-box,
.context-box {
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
  padding: 0.8rem;
  background: var(--vp-c-bg-soft);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.storage-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--vp-c-text-1);
}

.storage-item .icon {
  font-size: 1rem;
}
</style>
