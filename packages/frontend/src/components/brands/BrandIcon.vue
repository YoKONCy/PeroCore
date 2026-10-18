<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import { modelBrandDefinition, type ModelBrandId } from '../../lib/modelBrands'

const props = withDefaults(
  defineProps<{
    brand?: ModelBrandId
    size?: 'xs' | 'sm' | 'md' | 'lg'
    framed?: boolean
    fallback?: 'model' | 'provider'
  }>(),
  { brand: undefined, size: 'sm', framed: false, fallback: 'model' },
)
const failed = ref(false)
const definition = computed(() => modelBrandDefinition(props.brand))
const source = computed(() =>
  definition.value ? new URL(`model-brands/${definition.value.asset}`, document.baseURI).href : '',
)
const label = computed(
  () => definition.value?.label ?? (props.fallback === 'provider' ? '自定义服务' : '模型'),
)
const glyphSize = computed(() => ({ xs: 16, sm: 18, md: 20, lg: 28 })[props.size])
const maskStyle = computed(() => ({
  maskImage: `url("${source.value}")`,
  WebkitMaskImage: `url("${source.value}")`,
}))
watch(source, () => {
  failed.value = false
})
</script>

<template>
  <span
    class="brand-icon"
    :class="{ 'brand-icon--framed': framed }"
    :style="{ '--brand-size': `${glyphSize}px` }"
    :title="label"
    role="img"
    :aria-label="label"
  >
    <span
      v-if="source && definition?.mono && !failed"
      class="brand-icon__mono"
      :style="maskStyle"
      aria-hidden="true"
    />
    <img
      v-else-if="source && !failed"
      class="brand-icon__color"
      :src="source"
      alt=""
      draggable="false"
      decoding="async"
      @error="failed = true"
    />
    <PixelIcon
      v-else
      :name="fallback === 'provider' ? 'globe' : 'cpu'"
      size="sm"
      aria-hidden="true"
    />
  </span>
</template>

<style scoped>
.brand-icon {
  display: inline-flex;
  width: var(--brand-size);
  height: var(--brand-size);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  color: var(--ui-text-primary);
}
.brand-icon--framed {
  box-sizing: content-box;
  padding: 8px;
  border: 1px solid var(--ui-border-default);
  border-radius: 0;
  background: color-mix(in srgb, var(--ui-bg-surface) 95%, var(--ui-accent-sky));
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 16%, transparent),
    inset -1px -1px var(--ui-border-subtle),
    2px 2px 0 var(--ui-border-subtle);
}
.brand-icon__mono,
.brand-icon__color {
  display: block;
  width: var(--brand-size);
  height: var(--brand-size);
}
.brand-icon__mono {
  background: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
}
.brand-icon__color {
  object-fit: contain;
}
</style>
