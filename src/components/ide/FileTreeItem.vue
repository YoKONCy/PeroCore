
<template>
  <div>
    <div 
      @click="toggle"
      @contextmenu.prevent.stop="$emit('contextmenu', { event: $event, item })"
      :class="[
        'flex items-center py-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 rounded-lg mx-1', 
        isSelected 
          ? 'bg-indigo-500/20 text-indigo-300 font-medium' 
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      ]"
      :style="{ paddingLeft: (level * 12 + 8) + 'px' }"
    >
      <!-- Icon -->
      <!-- Icon -->
      <!-- 图标 -->
      <span v-if="item.type === 'directory'" class="mr-2 flex-shrink-0 opacity-70">
        <FolderOpenIcon v-if="isOpen" class="w-4 h-4 text-amber-400" />
        <FolderIcon v-else class="w-4 h-4 text-amber-400/80" />
      </span>
      <span v-else class="mr-2 flex-shrink-0 opacity-70">
        <FileCodeIcon v-if="item.name.endsWith('.py')" class="w-4 h-4 text-blue-400" />
        <FileJsonIcon v-else-if="item.name.endsWith('.json')" class="w-4 h-4 text-yellow-400" />
        <FileTextIcon v-else-if="item.name.endsWith('.md')" class="w-4 h-4 text-gray-400" />
        <FileIcon v-else class="w-4 h-4 text-slate-500" />
      </span>
      
      <!-- Name -->
      <!-- Name -->
      <!-- 名称 -->
      <span class="truncate text-xs">{{ item.name }}</span>
    </div>

    <!-- Children -->
    <!-- Children -->
    <!-- 子项 -->
    <div v-if="isOpen && item.type === 'directory'" class="mt-0.5 border-l border-white/5 ml-3 pl-1">
      <div v-if="loading" class="pl-4 py-1 text-[10px] text-slate-600 animate-pulse">扫描中...</div>
      <FileTreeItem 
        v-for="child in children" 
        :key="child.path" 
        :item="child" 
        :level="level + 1"
        @select="$emit('select', $event)"
        @contextmenu="$emit('contextmenu', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { 
  Folder as FolderIcon, 
  FolderOpen as FolderOpenIcon, 
  File as FileIcon,
  FileCode as FileCodeIcon,
  FileJson as FileJsonIcon,
  FileText as FileTextIcon
} from 'lucide-vue-next';

const props = defineProps({
  item: Object,
  level: { type: Number, default: 0 }
});
// ... rest of script stays mostly same, but need to check imports

const emit = defineEmits(['select', 'contextmenu']);

const isOpen = ref(false);
const children = ref([]);
const loading = ref(false);
const isSelected = ref(false); // TODO: Sync with parent // TODO: 与父级同步 // TODO: 与父级同步

const toggle = async () => {
  if (props.item.type === 'directory') {
    if (!isOpen.value && children.value.length === 0) {
      loading.value = true;
      try {
        const res = await fetch(`http://localhost:9120/api/ide/files?path=${encodeURIComponent(props.item.path)}`);
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
