<template>
  <div class="arch-graph">
    <!-- User Input Section -->
    <div class="input-section">
      <div class="node input">
        <span class="icon">👤</span>
        <span class="label">User Input<br /><small>用户输入</small></span>
      </div>
      <div class="connection-line vertical">
        <span class="arrow">↓</span>
        <span class="desc">Embedding<br />向量化</span>
      </div>
    </div>

    <!-- Main System Container -->
    <div class="system-container">
      <!-- Python Layer -->
      <div class="layer python">
        <div class="layer-header">
          <span class="lang-icon python-icon">🐍</span>
          Python Layer (Storage & Logic) / 存储与逻辑层
        </div>
        <div class="layer-content">
          <div class="node db">
            <span class="icon">🗄️</span>
            <span class="label">SQLite<br /><small>(SQLModel)</small></span>
          </div>
          <div class="connection-line horizontal double">
            <span class="arrow">↔</span>
            <span class="desc">CRUD<br />读写</span>
          </div>
          <div class="node service main-node">
            <span class="icon">🧠</span>
            <span class="label">Memory Service<br /><small>记忆服务</small></span>
          </div>
        </div>
      </div>

      <!-- Cross-Language Bridge -->
      <div class="bridge">
        <div class="flow down">
          <span class="desc">Query (Vector)<br />向量查询</span>
          <span class="arrow">↓</span>
        </div>
        <div class="flow up">
          <span class="arrow">↑</span>
          <span class="desc">Activated IDs<br />激活节点</span>
        </div>
      </div>

      <!-- Rust Layer -->
      <div class="layer rust">
        <div class="layer-header">
          <span class="lang-icon rust-icon">🦀</span>
          Rust Core (Compute Engine) / 计算引擎层
        </div>
        <div class="layer-content">
          <div class="node engine">
            <span class="icon">⚡</span>
            <span class="label">Intent Engine<br /><small>意图引擎 (SIMD)</small></span>
          </div>
          <div class="connection-line horizontal">
            <span class="desc">Initial Energy<br />初始能量</span>
            <span class="arrow">→</span>
          </div>
          <div class="node engine">
            <span class="icon">🕸️</span>
            <span class="label">Cognitive Graph<br /><small>认知图谱 (扩散激活)</small></span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.arch-graph {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  user-select: none;
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
  min-width: 120px;
}

.node:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: var(--vp-c-brand);
}

.node .icon {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
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
.node.input {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
}

.node.db {
  border-color: #eab308; /* Yellow-ish */
}

.node.service {
  border-color: #3b82f6; /* Blue */
  background: var(--vp-c-bg-soft);
  font-weight: bold;
}

.node.engine {
  border-color: #f97316; /* Orange for Rust */
}

/* Layers */
.layer {
  border: 2px dashed var(--vp-c-divider);
  border-radius: 12px;
  padding: 1.5rem;
  width: 100%;
  position: relative;
  background: var(--vp-c-bg-soft);
}

.layer.python {
  border-color: #3776ab40; /* Python Blue faint */
}

.layer.rust {
  border-color: #dea58440; /* Rust color faint */
}

.layer-header {
  position: absolute;
  top: -0.8rem;
  left: 1rem;
  background: var(--vp-c-bg-alt);
  padding: 0 0.5rem;
  font-size: 0.8rem;
  font-weight: bold;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.layer-content {
  display: flex;
  justify-content: space-around;
  align-items: center;
  gap: 1rem;
}

/* Connections */
.connection-line {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--vp-c-text-3);
  font-size: 0.8rem;
}

.connection-line.horizontal {
  flex-direction: row;
  gap: 0.5rem;
}

.bridge {
  display: flex;
  justify-content: space-around;
  width: 100%;
  padding: 1rem 0;
  padding-left: 120px; /* Offset to align with Memory Service */
}

.flow {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
}

.flow .arrow {
  font-size: 1.2rem;
  color: var(--vp-c-brand);
}

.system-container {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  max-width: 600px;
}
</style>
