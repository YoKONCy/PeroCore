<script setup lang="ts">
import { computed, ref } from 'vue'
import { INTEGRATION_PROVIDERS, type IntegrationFeature } from '@infos/shared'
import { PCard, PButton, PixelIcon } from '../pixel'
import McpTab from '../dashboard/tabs/McpTab.vue'
import ExtensionToolsPane from './ExtensionToolsPane.vue'
import FeatureSourcesPage from './FeatureSourcesPage.vue'
import IntegrationBrand from './IntegrationBrand.vue'
import { useIntegrations } from '../../composables/tools/useIntegrations'

const { state, error } = useIntegrations()
const tab = ref<'extensions' | 'features' | 'mcp' | 'skills'>('extensions')
const page = ref<IntegrationFeature | null>(null)
const tabs = [
  { id: 'extensions', label: '扩展工具' },
  { id: 'features', label: '拓展功能' },
  { id: 'mcp', label: 'MCP 服务' },
  { id: 'skills', label: '技能' },
] as const
const searchLogo = computed(() => {
  const feature = state.value?.features.search
  const source = feature?.sources.find((item) => item.id === feature.selectedSourceId)
  return INTEGRATION_PROVIDERS.find((item) => item.id === source?.provider)?.logo
})
const pdfLogo = computed(() => {
  const feature = state.value?.features.pdf
  const source = feature?.sources.find((item) => item.id === feature.selectedSourceId)
  return INTEGRATION_PROVIDERS.find((item) => item.id === source?.provider)?.logo
})
</script>
<template>
  <div class="integrations-page">
    <header class="integration-heading">
      <PixelIcon name="terminal" size="lg" />
      <div>
        <h1>工具与扩展</h1>
        <p>TOOLS & EXTENSIONS</p>
      </div>
    </header>
    <nav class="integration-tabs" aria-label="工具与扩展分类">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        :class="{ active: tab === item.id }"
        :aria-current="tab === item.id ? 'page' : undefined"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </nav>
    <p v-if="error" class="integration-error" role="status">{{ error }}</p>
    <div class="integration-content">
      <ExtensionToolsPane v-if="tab === 'extensions'" />
      <template v-else-if="tab === 'features'">
        <FeatureSourcesPage v-if="page" :key="page" :kind="page" @back="page = null" />
        <section v-else>
          <div class="integration-section-heading"><h2>拓展功能</h2></div>
          <div class="integration-grid">
            <PCard pixel padding="lg" class="integration-market-card">
              <div class="integration-card-heading">
                <IntegrationBrand :brand="searchLogo" fallback="search" />
                <div>
                  <h3>联网搜索</h3>
                  <span class="integration-publisher">搜索来源</span>
                </div>
              </div>
              <p class="integration-description">选择搜索服务，让助手查找网页与相关信息。</p>
              <div class="integration-card-foot">
                <span
                  class="integration-state"
                  :class="{ 'integration-state--ready': state?.features.search.ready }"
                >
                  {{ state?.features.search.ready ? '已启用' : '未启用' }}
                </span>
                <PButton type="button" variant="secondary" size="sm" @click="page = 'search'">
                  管理来源
                  <PixelIcon name="chevron-right" size="xs" />
                </PButton>
              </div>
            </PCard>
            <PCard pixel padding="lg" class="integration-market-card">
              <div class="integration-card-heading">
                <IntegrationBrand :brand="pdfLogo" fallback="file" />
                <div>
                  <h3>PDF 解析</h3>
                  <span class="integration-publisher">附件输入</span>
                </div>
              </div>
              <p class="integration-description">配置解析来源，上传 PDF 后自动提取文字。</p>
              <div class="integration-card-foot">
                <span
                  class="integration-state"
                  :class="{ 'integration-state--ready': state?.features.pdf.ready }"
                >
                  {{ state?.features.pdf.ready ? '上传已开启' : '未启用' }}
                </span>
                <PButton type="button" variant="secondary" size="sm" @click="page = 'pdf'">
                  管理来源
                  <PixelIcon name="chevron-right" size="xs" />
                </PButton>
              </div>
            </PCard>
          </div>
        </section>
      </template>
      <McpTab v-else embedded :section="tab === 'skills' ? 'skill' : 'mcp'" />
    </div>
  </div>
</template>
<style src="./integrations.css" />
