<script setup lang="ts">
/**
 * ModelConfigTab — 模型配置 Tab (F1-1)
 *
 * 双面板设计: LLM 模型网格 + 向量模型配置
 * 功能: 模型 CRUD, 角色分配 (主/秘书/反思/辅助), Embedding/Reranker 配置
 *
 * @see 06_FILE_SIZE_LIMITS.md — 逻辑抽到 useModelConfig composable
 */
import { PixelIcon, PButton, PInput, PSelect, PInputNumber, PSwitch, PTooltip, PDialog, PCheckbox } from '../../pixel'
import { useModelConfig } from '../../../composables/dashboard/useModelConfig'

const {
  models, currentTab, roles,
  providerOptions,
  isEditorOpen, editingModel, editorForm,
  openEditor, saveModel, deleteModel, setRole, getModelRoles,
  isGlobalOpen, globalConfig,
  embeddingProvider, embeddingModelId, embeddingDimension,
  embeddingApiBase, embeddingApiKey,
  rerankerEnabled, rerankerModelId, rerankerApiBase, rerankerApiKey,
  isSavingVector, saveVectorConfig,
} = useModelConfig()

// 角色配置表
const rolesMeta = [
  { key: 'main' as const, label: '主模型', icon: 'terminal', color: 'blue' },
  { key: 'secretary' as const, label: '秘书', icon: 'chat', color: 'amber' },
  { key: 'reflection' as const, label: '反思', icon: 'brain', color: 'pink' },
  { key: 'aux' as const, label: '辅助', icon: 'sparkle', color: 'purple' },
]

function getRoleBadgeClass(color: string) {
  const map: Record<string, string> = {
    blue: 'role-badge-blue',
    amber: 'role-badge-amber',
    pink: 'role-badge-pink',
    purple: 'role-badge-purple',
  }
  return map[color] ?? ''
}

function formatTokens(tokens: number | null): string {
  if (!tokens) return '自动'
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M'
  return (tokens / 1000).toFixed(0) + 'K'
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  custom: 'Custom',
}
</script>

<template>
  <div class="tab-model">
    <!-- 头部 + 子选项卡 -->
    <div class="tab-header">
      <div class="tab-header-left">
        <div class="tab-switcher">
          <button
            :class="['tab-sw-btn', { 'tab-sw-active': currentTab === 'llm' }]"
            @click="currentTab = 'llm'"
          >
            <PixelIcon name="settings" size="sm" />
            <span>模型配置</span>
          </button>
          <span class="tab-sw-sep">/</span>
          <button
            :class="['tab-sw-btn', { 'tab-sw-active': currentTab === 'vector' }]"
            @click="currentTab = 'vector'"
          >
            <PixelIcon name="brain" size="sm" />
            <span>向量模型</span>
          </button>
        </div>
        <p class="tab-subtitle">{{ currentTab === 'llm' ? 'LLM MODEL MANAGEMENT' : 'VECTOR CONFIGURATION' }}</p>
      </div>
      <div class="tab-header-actions">
        <template v-if="currentTab === 'llm'">
          <PButton variant="ghost" @click="isGlobalOpen = true">
            <PixelIcon name="settings" size="xs" />
            <span>全局服务商</span>
          </PButton>
          <PButton variant="primary" @click="openEditor(null)">
            <PixelIcon name="plus" size="xs" />
            <span>添加模型</span>
          </PButton>
        </template>
        <template v-else>
          <PButton variant="primary" :loading="isSavingVector" @click="saveVectorConfig">
            保存配置
          </PButton>
        </template>
      </div>
    </div>

    <!-- LLM 模型网格 -->
    <div v-if="currentTab === 'llm'" class="model-grid">
      <div v-for="model in models" :key="model.id" class="model-card">
        <!-- 卡片头部 -->
        <div class="model-card-header">
          <div class="model-card-info">
            <h3 class="model-card-name">{{ model.name }}</h3>
            <span class="model-card-provider">{{ providerLabels[model.provider] ?? model.provider }}</span>
          </div>
          <div v-if="model.enableVision" class="model-vision-badge">
            <PixelIcon name="eye" size="xs" />
            <span>VISION</span>
          </div>
        </div>

        <!-- 角色徽章 -->
        <div v-if="getModelRoles(model.id).length > 0" class="model-roles">
          <span
            v-for="r in rolesMeta.filter(rm => getModelRoles(model.id).includes(rm.key))"
            :key="r.key"
            :class="['role-badge', getRoleBadgeClass(r.color)]"
          >
            <PixelIcon :name="r.icon" size="xs" />
            {{ r.label }}
          </span>
        </div>

        <!-- 模型详情 -->
        <div class="model-card-details">
          <div class="model-detail-row">
            <span class="model-detail-label">模型 ID</span>
            <span class="model-detail-value">{{ model.modelId }}</span>
          </div>
          <div class="model-detail-row">
            <span class="model-detail-label">上下文窗口</span>
            <span class="model-detail-value">{{ formatTokens(model.maxTokens) }}</span>
          </div>
          <div class="model-detail-row">
            <span class="model-detail-label">温度 / TopP</span>
            <span class="model-detail-value">{{ model.temperature }} / {{ model.topP }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="model-card-footer">
          <!-- 快速角色切换 -->
          <div class="model-quick-roles">
            <PTooltip v-for="r in rolesMeta" :key="r.key" :content="`设为${r.label}`" placement="top">
              <button
                :class="['quick-role-btn', `qr-${r.color}`, { 'quick-role-active': roles[r.key] === model.id }]"
                @click="setRole(r.key, model.id)"
              >
                <PixelIcon :name="r.icon" size="xs" />
              </button>
            </PTooltip>
          </div>
          <div class="model-card-ops">
            <PTooltip content="编辑" placement="top">
              <button class="model-op-btn" @click="openEditor(model)">
                <PixelIcon name="pencil" size="xs" />
              </button>
            </PTooltip>
            <PTooltip content="删除" placement="top">
              <button class="model-op-btn model-op-danger" @click="deleteModel(model.id)">
                <PixelIcon name="trash" size="xs" />
              </button>
            </PTooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- 向量模型配置 -->
    <div v-else class="vector-config">
      <!-- Embedding -->
      <div class="vec-section">
        <div class="vec-section-header">
          <div class="vec-section-icon vec-icon-blue"><PixelIcon name="brain" size="sm" /></div>
          <div>
            <h4 class="vec-section-title">Embedding 嵌入模型</h4>
            <p class="vec-section-desc">将记忆文本转换为数学向量，是 RAG 检索的核心</p>
          </div>
        </div>
        <div class="vec-form-grid">
          <div class="vec-field">
            <label class="vec-label">模型来源 Provider</label>
            <PSelect
              v-model="embeddingProvider"
              :options="[
                { label: '本地内置 (BGE-512)', value: 'local' },
                { label: '在线 API (OpenAI 兼容)', value: 'api' },
              ]"
            />
          </div>
          <div class="vec-field">
            <label class="vec-label">向量维度 Dimension</label>
            <PInputNumber v-model="embeddingDimension" :min="1" :max="4096" :disabled="embeddingProvider === 'local'" />
            <p v-if="embeddingProvider === 'local'" class="vec-hint">* 本地模型固定为 512 维</p>
          </div>
          <template v-if="embeddingProvider === 'api'">
            <div class="vec-field vec-field-full">
              <label class="vec-label">模型 ID</label>
              <PInput v-model="embeddingModelId" placeholder="例如: text-embedding-3-small" />
            </div>
            <div class="vec-field">
              <label class="vec-label">API Base URL (可选)</label>
              <PInput v-model="embeddingApiBase" placeholder="留空则使用全局配置" />
            </div>
            <div class="vec-field">
              <label class="vec-label">API Key (可选)</label>
              <PInput v-model="embeddingApiKey" type="password" placeholder="留空则使用全局配置" />
            </div>
          </template>
        </div>
      </div>

      <!-- Reranker -->
      <div :class="['vec-section', { 'vec-section-disabled': !rerankerEnabled }]">
        <div class="vec-section-header">
          <div :class="['vec-section-icon', rerankerEnabled ? 'vec-icon-amber' : 'vec-icon-muted']">
            <PixelIcon name="sparkle" size="sm" />
          </div>
          <div class="vec-section-header-text">
            <h4 class="vec-section-title">Reranker 重排序模型</h4>
            <p class="vec-section-desc">对初步检索结果精排，提升检索准确度</p>
          </div>
          <PSwitch v-model="rerankerEnabled" class="vec-section-switch" />
        </div>
        <template v-if="rerankerEnabled">
          <div class="vec-form-grid">
            <div class="vec-field vec-field-full">
              <label class="vec-label">模型 ID</label>
              <PInput v-model="rerankerModelId" placeholder="例如: bge-reranker-v2-m3" />
            </div>
            <div class="vec-field">
              <label class="vec-label">API Base URL (可选)</label>
              <PInput v-model="rerankerApiBase" placeholder="留空则使用全局配置" />
            </div>
            <div class="vec-field">
              <label class="vec-label">API Key (可选)</label>
              <PInput v-model="rerankerApiKey" type="password" placeholder="留空则使用全局配置" />
            </div>
          </div>
        </template>
        <div v-else class="vec-disabled-hint">
          <p>Reranker 已关闭。<strong>建议开启</strong>以获得更精准的记忆检索效果。</p>
        </div>
      </div>
    </div>

    <!-- 模型编辑弹窗 -->
    <PDialog v-model="isEditorOpen" :title="editingModel ? '编辑模型' : '添加模型'" width="520px">
      <div class="editor-form">
        <div class="editor-field">
          <label class="vec-label">模型名称</label>
          <PInput v-model="editorForm.name" placeholder="给模型起个名字" />
        </div>
        <div class="editor-field">
          <label class="vec-label">Provider</label>
          <PSelect v-model="editorForm.provider" :options="providerOptions" />
        </div>
        <div class="editor-field">
          <label class="vec-label">模型 ID</label>
          <PInput v-model="editorForm.modelId" placeholder="例如: gpt-4o" />
        </div>
        <div class="editor-row">
          <div class="editor-field">
            <label class="vec-label">温度</label>
            <PInputNumber v-model="editorForm.temperature" :min="0" :max="2" :step="0.1" />
          </div>
          <div class="editor-field">
            <label class="vec-label">Top P</label>
            <PInputNumber v-model="editorForm.topP" :min="0" :max="1" :step="0.1" />
          </div>
        </div>
        <div class="editor-field">
          <label class="vec-label">最大 Token 数</label>
          <PInputNumber v-model="editorForm.maxTokens" :min="1024" :max="2000000" :step="1024" />
        </div>
        <div v-if="editorForm.provider === 'custom'" class="editor-field">
          <label class="vec-label">自定义 API Base</label>
          <PInput v-model="editorForm.apiBase" placeholder="https://api.example.com/v1" />
        </div>
        <div v-if="editorForm.provider === 'custom'" class="editor-field">
          <label class="vec-label">API Key</label>
          <PInput v-model="editorForm.apiKey" type="password" />
        </div>
        <div class="editor-check-row">
          <PCheckbox v-model="editorForm.enableVision" label="启用视觉能力 (Vision)" />
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isEditorOpen = false">取消</PButton>
        <PButton variant="primary" @click="saveModel">{{ editingModel ? '保存' : '添加' }}</PButton>
      </template>
    </PDialog>

    <!-- 全局服务商弹窗 -->
    <PDialog v-model="isGlobalOpen" title="全局服务商配置" width="560px">
      <div class="global-form">
        <div v-for="(cfg, provider) in globalConfig" :key="provider" class="global-provider">
          <h5 class="global-provider-name">{{ providerLabels[provider] ?? provider }}</h5>
          <div class="global-provider-fields">
            <div class="editor-field">
              <label class="vec-label">API Base</label>
              <PInput v-model="cfg.apiBase" />
            </div>
            <div class="editor-field">
              <label class="vec-label">API Key</label>
              <PInput v-model="cfg.apiKey" type="password" placeholder="sk-..." />
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isGlobalOpen = false">关闭</PButton>
        <PButton variant="primary" @click="isGlobalOpen = false">保存</PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
.tab-model { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }

/* ── 头部 ── */
.tab-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-shrink: 0; }
.tab-header-left { display: flex; flex-direction: column; gap: 4px; }
.tab-header-actions { display: flex; gap: 8px; align-items: center; }

.tab-switcher { display: flex; align-items: center; gap: 8px; }
.tab-sw-btn {
  display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 800;
  background: none; border: none; cursor: pointer; padding: 0;
  color: var(--color-text-muted); transition: all 0.2s;
}
.tab-sw-btn:hover { color: var(--color-text-secondary); }
.tab-sw-active { color: var(--color-text-primary); transform: scale(1.02); }
.tab-sw-sep { color: var(--color-border); font-size: 20px; font-weight: 300; }
.tab-subtitle {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.15em; color: var(--color-text-muted); margin-left: 28px;
}

/* ── 模型网格 ── */
.model-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px; flex: 1; overflow-y: auto; padding-right: 4px;
}
.model-grid::-webkit-scrollbar { width: 4px; }
.model-grid::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

/* ── 模型卡片 ── */
.model-card {
  border: 2px solid var(--color-border); background: var(--color-bg-primary);
  padding: 20px; display: flex; flex-direction: column; gap: 12px;
  transition: all 0.25s;
}
.model-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.06); border-color: var(--color-blue-200); }

.model-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.model-card-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.model-card-name { font-size: 16px; font-weight: 800; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model-card-provider { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-text-muted); }

.model-vision-badge {
  display: flex; align-items: center; gap: 4px; padding: 2px 8px;
  font-size: 9px; font-weight: 700; color: var(--color-blue-500);
  background: var(--color-blue-50, rgba(56,189,248,0.1)); border: 1px solid var(--color-blue-200);
}

/* 角色徽章 */
.model-roles { display: flex; gap: 6px; flex-wrap: wrap; }
.role-badge {
  display: flex; align-items: center; gap: 4px; padding: 2px 8px;
  font-size: 10px; font-weight: 700; border: 1px solid;
}
.role-badge-blue { color: var(--color-blue-600); background: var(--color-blue-50, rgba(56,189,248,0.1)); border-color: var(--color-blue-200); }
.role-badge-amber { color: var(--color-yellow-600, #d97706); background: rgba(234,179,8,0.1); border-color: rgba(234,179,8,0.3); }
.role-badge-pink { color: var(--color-pink-600, #db2777); background: rgba(236,72,153,0.1); border-color: rgba(236,72,153,0.3); }
.role-badge-purple { color: #7c3aed; background: rgba(124,58,237,0.1); border-color: rgba(124,58,237,0.3); }

/* 模型详情 */
.model-card-details { display: flex; flex-direction: column; gap: 6px; }
.model-detail-row { display: flex; justify-content: space-between; align-items: center; }
.model-detail-label { font-size: 11px; color: var(--color-text-muted); }
.model-detail-value { font-size: 11px; font-weight: 700; color: var(--color-text-secondary); font-family: monospace; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 底部操作 */
.model-card-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--color-border); margin-top: auto; }
.model-quick-roles { display: flex; gap: 4px; }
.quick-role-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  background: var(--color-bg-secondary); border: 1px solid var(--color-border); cursor: pointer;
  color: var(--color-text-muted); transition: all 0.15s;
}
.quick-role-btn:hover { transform: scale(1.1); }
.qr-blue.quick-role-active { background: var(--color-blue-500); color: white; border-color: var(--color-blue-500); }
.qr-amber.quick-role-active { background: var(--color-yellow-500, #eab308); color: white; border-color: var(--color-yellow-500, #eab308); }
.qr-pink.quick-role-active { background: var(--color-pink-500, #ec4899); color: white; border-color: var(--color-pink-500, #ec4899); }
.qr-purple.quick-role-active { background: #7c3aed; color: white; border-color: #7c3aed; }

.model-card-ops { display: flex; gap: 4px; }
.model-op-btn {
  padding: 6px; background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); transition: all 0.15s;
}
.model-op-btn:hover { color: var(--color-blue-500); }
.model-op-danger:hover { color: var(--color-red-500, #ef4444); }

/* ── 向量配置 ── */
.vector-config { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
.vec-section { border: 2px solid var(--color-border); background: var(--color-bg-primary); padding: 24px; }
.vec-section-disabled { opacity: 0.65; }
.vec-section-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.vec-section-header-text { flex: 1; }
.vec-section-switch { flex-shrink: 0; }
.vec-section-icon { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
.vec-icon-blue { background: var(--color-blue-500); }
.vec-icon-amber { background: var(--color-yellow-500, #eab308); }
.vec-icon-muted { background: var(--color-text-muted); }
.vec-section-title { font-size: 16px; font-weight: 800; color: var(--color-text-primary); }
.vec-section-desc { font-size: 12px; color: var(--color-text-muted); margin-top: 2px; }
.vec-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.vec-field { display: flex; flex-direction: column; gap: 6px; }
.vec-field-full { grid-column: 1 / -1; }
.vec-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-text-muted); }
.vec-hint { font-size: 10px; color: var(--color-text-muted); font-style: italic; }
.vec-disabled-hint { padding: 16px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); text-align: center; font-size: 13px; color: var(--color-text-muted); }
.vec-disabled-hint strong { color: var(--color-yellow-600, #d97706); }

/* ── 编辑器弹窗 ── */
.editor-form { display: flex; flex-direction: column; gap: 16px; }
.editor-field { display: flex; flex-direction: column; gap: 6px; }
.editor-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.editor-check-row { padding-top: 4px; }

/* ── 全局配置弹窗 ── */
.global-form { display: flex; flex-direction: column; gap: 24px; }
.global-provider { display: flex; flex-direction: column; gap: 12px; }
.global-provider-name { font-size: 14px; font-weight: 800; color: var(--color-text-primary); padding-bottom: 4px; border-bottom: 1px solid var(--color-border); }
.global-provider-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
