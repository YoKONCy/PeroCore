
<template>
  <div>
    <div 
      @click="toggle"
      :class="['flex items-center py-1 cursor-pointer hover:bg-[#2a2d2e] whitespace-nowrap transition-colors duration-100', isSelected ? 'bg-[#37373d] text-white' : 'text-gray-400']"
      :style="{ paddingLeft: (level * 12 + 12) + 'px' }"
    >
      <!-- Icon -->
      <span v-if="item.type === 'directory'" class="mr-1.5 flex-shrink-0">
        <ChevronRightIcon v-if="!isOpen" class="w-3.5 h-3.5" />
        <ChevronDownIcon v-else class="w-3.5 h-3.5" />
      </span>
      <span v-else class="mr-1.5 flex-shrink-0">
        <FileIcon class="w-3.5 h-3.5 text-gray-500" />
      </span>
      
      <!-- Name -->
      <span class="truncate">{{ item.name }}</span>
    </div>

    <!-- Children -->
    <div v-if="isOpen && item.type === 'directory'">
      <div v-if="loading" class="pl-8 py-1 text-xs text-gray-600">加载中...</div>
      <FileTreeItem 
        v-for="child in children" 
        :key="child.path" 
        :item="child" 
        :level="level + 1"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ChevronRight as ChevronRightIcon, ChevronDown as ChevronDownIcon, File as FileIcon } from 'lucide-vue-next';

const props = defineProps({
  item: Object,
  level: { type: Number, default: 0 }
});

const emit = defineEmits(['select']);

const isOpen = ref(false);
const children = ref([]);
const loading = ref(false);
const isSelected = ref(false); // TODO: Sync with parent

const toggle = async () => {
  if (props.item.type === 'directory') {
    if (!isOpen.value && children.value.length === 0) {
      loading.value = true;
      try {
        const res = await fetch(`http://localhost:8000/api/ide/files?path=${encodeURIComponent(props.item.path)}`);
        if (res.ok) {
            children.value = await res.json();
        }
      } catch (e) {
        console.error("Failed to load directory", e);
      } finally {
        loading.value = false;
      }
    }
    isOpen.value = !isOpen.value;
  } else {
    emit('select', props.item);
  }
};
</script>
