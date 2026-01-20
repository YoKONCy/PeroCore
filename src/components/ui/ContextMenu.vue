<template>
  <div 
    v-if="visible"
    class="fixed z-[9999] bg-[#252526] border border-[#454545] rounded shadow-xl py-1 min-w-[160px]"
    :style="{ top: y + 'px', left: x + 'px' }"
    @click.stop
    @contextmenu.prevent
  >
    <div 
      v-for="(item, index) in items" 
      :key="index"
    >
      <div 
        v-if="item.type === 'separator'" 
        class="h-[1px] bg-[#454545] my-1 mx-2"
      ></div>
      <button 
        v-else
        class="w-full text-left px-3 py-1.5 text-xs text-[#cccccc] hover:bg-[#094771] hover:text-white flex items-center justify-between group transition-colors"
        @click="handleClick(item)"
        :class="{ 'opacity-50 cursor-not-allowed': item.disabled }"
        :disabled="item.disabled"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.shortcut" class="text-[10px] text-[#888888] group-hover:text-white/80 ml-4">{{ item.shortcut }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({
  visible: Boolean,
  x: Number,
  y: Number,
  items: Array // [{ label, action, type: 'item'|'separator', disabled, shortcut }]
});

const emit = defineEmits(['close', 'action']);

const handleClick = (item) => {
  if (item.disabled) return;
  item.action();
  emit('close');
};

const close = () => emit('close');

onMounted(() => {
  window.addEventListener('click', close);
  window.addEventListener('contextmenu', close); // Close on right click elsewhere
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
});

onUnmounted(() => {
  window.removeEventListener('click', close);
  window.removeEventListener('contextmenu', close);
  window.removeEventListener('keydown', close);
});
</script>