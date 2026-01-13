
<template>
  <div class="text-sm select-none h-full bg-[#252526]">
    <div v-if="loading" class="p-4 text-center text-gray-500 text-xs">
      正在加载工作区...
    </div>
    <div v-else class="py-1">
      <FileTreeItem 
        v-for="item in files" 
        :key="item.path" 
        :item="item" 
        @select="onSelect" 
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import FileTreeItem from './FileTreeItem.vue';

const emit = defineEmits(['file-selected']);
const files = ref([]);
const loading = ref(true);

const fetchFiles = async (path = null) => {
  try {
    const url = path 
        ? `http://localhost:8000/api/ide/files?path=${encodeURIComponent(path)}`
        : `http://localhost:8000/api/ide/files`;
        
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
};

onMounted(async () => {
  try {
    files.value = await fetchFiles();
  } finally {
    loading.value = false;
  }
});

const onSelect = (fileNode) => {
  emit('file-selected', fileNode);
};
</script>
