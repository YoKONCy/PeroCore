<template>
  <div class="h-full flex flex-col text-slate-400 select-none bg-transparent" @click="closeContextMenu">
    
    <!-- Toolbar & Search -->
    <div class="flex flex-col border-b border-white/5 bg-black/10">
        <!-- Actions -->
        <div class="px-3 py-2 flex justify-end items-center gap-1">
            <button class="p-1.5 hover:bg-white/10 rounded-lg hover:text-indigo-400 transition-colors" title="新建文件" @click.stop="createFile(null)">
              <PlusIcon class="w-4 h-4" />
            </button>
            <button class="p-1.5 hover:bg-white/10 rounded-lg hover:text-indigo-400 transition-colors" title="新建文件夹" @click.stop="createFolder(null)">
              <FolderPlusIcon class="w-4 h-4" />
            </button>
            <button class="p-1.5 hover:bg-white/10 rounded-lg hover:text-indigo-400 transition-colors" title="刷新" @click.stop="refresh">
              <RefreshCwIcon class="w-4 h-4" />
            </button>
        </div>
        
        <!-- Search Input -->
        <div class="px-3 pb-2">
            <div class="relative group">
                <SearchIcon class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                <input 
                    v-model="searchQuery" 
                    type="text" 
                    placeholder="搜索文件..." 
                    class="w-full bg-black/20 border border-white/5 rounded-lg py-1.5 pl-8 pr-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-black/30 transition-all"
                />
            </div>
        </div>
    </div>

    <!-- Tree -->
    <div class="flex-1 overflow-y-auto custom-scrollbar px-2 py-2" @contextmenu.prevent="handleRootContextMenu">
      <div v-if="loading" class="flex flex-col items-center justify-center h-20 gap-2 text-slate-600">
        <RefreshCwIcon class="w-4 h-4 animate-spin" />
        <span class="text-xs">加载中...</span>
      </div>
      <div v-else-if="filteredFiles.length === 0" class="flex flex-col items-center justify-center h-20 text-slate-600">
        <span class="text-xs italic" v-if="searchQuery">无搜索结果</span>
        <span class="text-xs italic" v-else>工作区为空</span>
      </div>
      <div v-else class="pb-4 min-h-full space-y-0.5" @contextmenu.prevent.stop="handleRootContextMenu">
        <FileTreeItem 
          v-for="item in filteredFiles" 
          :key="item.path" 
          :item="item" 
          @select="onSelect" 
          @contextmenu="handleItemContextMenu"
        />
      </div>
    </div>

    <!-- Context Menu -->
    <ContextMenu 
      :visible="contextMenu.visible" 
      :x="contextMenu.x" 
      :y="contextMenu.y" 
      :items="contextMenu.items" 
      @close="closeContextMenu"
    />

    <CustomDialog
      v-model:visible="dialog.visible"
      :type="dialog.type"
      :title="dialog.title"
      :message="dialog.message"
      :default-value="dialog.defaultValue"
      :placeholder="dialog.placeholder"
      @confirm="handleDialogConfirm"
      @cancel="handleDialogCancel"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue';
import { Plus as PlusIcon, FolderPlus as FolderPlusIcon, RefreshCw as RefreshCwIcon, Search as SearchIcon } from 'lucide-vue-next';
import FileTreeItem from './FileTreeItem.vue';
import ContextMenu from '../ui/ContextMenu.vue';
import CustomDialog from '../ui/CustomDialog.vue';

const emit = defineEmits(['file-selected']);
const files = ref([]);
const loading = ref(true);
const searchQuery = ref('');

// Recursive search function
const filterTree = (nodes, query) => {
  if (!query) return nodes;
  
  const lowerQuery = query.toLowerCase();
  
  return nodes.reduce((acc, node) => {
    // Check if current node matches
    const matches = node.name.toLowerCase().includes(lowerQuery);
    
    // If it's a directory, check children
    if (node.type === 'directory' && node.children) {
      const filteredChildren = filterTree(node.children, query);
      
      // If matches or has matching children, include it
      if (matches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          // If node matches, keep all children (optional, but usually better to filter them too unless "expanded")
          // Here we choose to filter children strictly to help finding specific files
          children: filteredChildren 
        });
      }
    } else if (matches) {
      // If it's a file and matches, include it
      acc.push(node);
    }
    
    return acc;
  }, []);
};

const filteredFiles = computed(() => {
    return filterTree(files.value, searchQuery.value);
});

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  items: [],
  targetItem: null
});

// Dialog State
const dialog = reactive({
  visible: false,
  type: 'alert',
  title: '',
  message: '',
  defaultValue: '',
  placeholder: '',
  resolve: null
});

const showDialog = ({ type, title, message, defaultValue = '', placeholder = '' }) => {
  return new Promise((resolve) => {
    dialog.type = type;
    dialog.title = title;
    dialog.message = message;
    dialog.defaultValue = defaultValue;
    dialog.placeholder = placeholder;
    dialog.resolve = resolve;
    dialog.visible = true;
  });
};

const handleDialogConfirm = (value) => {
  if (dialog.resolve) {
    if (dialog.type === 'prompt') dialog.resolve(value);
    else dialog.resolve(true);
  }
  dialog.visible = false;
};

const handleDialogCancel = () => {
  if (dialog.resolve) dialog.resolve(false); // false for confirm, null/false for prompt cancel
  dialog.visible = false;
};

const API_BASE = 'http://localhost:9120/api/ide';

const fetchFiles = async (path = null) => {
  try {
    const url = path 
        ? `${API_BASE}/files?path=${encodeURIComponent(path)}`
        : `${API_BASE}/files`;
        
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
};

const refresh = async () => {
  loading.value = true;
  try {
    files.value = await fetchFiles();
  } finally {
    loading.value = false;
  }
};

onMounted(refresh);

const onSelect = (fileNode) => {
  emit('file-selected', fileNode);
};

// --- Context Menu Logic ---

const closeContextMenu = () => {
  contextMenu.visible = false;
};

const handleRootContextMenu = (e) => {
  contextMenu.x = e.clientX;
  contextMenu.y = e.clientY;
  contextMenu.targetItem = null; // Root
  contextMenu.items = [
    { label: '新建文件', action: () => createFile(null) },
    { label: '新建文件夹', action: () => createFolder(null) },
    { type: 'separator' },
    { label: '刷新', action: refresh }
  ];
  contextMenu.visible = true;
};

const handleItemContextMenu = (payload) => {
  // Handle payload format from FileTreeItem emit
  const event = payload.event || payload; 
  const item = payload.item;

  if (!event || !event.clientX) {
      console.error("Invalid context menu event", payload);
      return;
  }

  // Safe check for item type
  const isDir = item && item.type === 'directory';

  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.targetItem = item;
  
  contextMenu.items = [
    { label: '打开', action: () => onSelect(item), disabled: isDir },
    { type: 'separator' },
    { label: '新建文件', action: () => createFile(item), disabled: !isDir },
    { label: '新建文件夹', action: () => createFolder(item), disabled: !isDir },
    { type: 'separator' },
    { label: '重命名', action: () => renameItem(item) },
    { label: '删除', action: () => deleteItem(item) }
  ];
  contextMenu.visible = true;
};

// --- Operations ---

const createFile = async (parentItem) => {
  const name = await showDialog({
    type: 'prompt',
    title: '新建文件',
    placeholder: '请输入文件名',
    message: '请输入文件名:'
  });
  
  if (!name) return;
  
  const parentPath = parentItem ? parentItem.path : "";
  const path = parentPath ? `${parentPath}/${name}` : name;
  
  try {
    await fetch(`${API_BASE}/file/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, is_directory: false })
    });
    refresh();
  } catch (e) {
    showDialog({ type: 'alert', title: '错误', message: "创建文件失败: " + e.message });
  }
};

const createFolder = async (parentItem) => {
  const name = await showDialog({
    type: 'prompt',
    title: '新建文件夹',
    placeholder: '请输入文件夹名',
    message: '请输入文件夹名:'
  });
  
  if (!name) return;
  
  const parentPath = parentItem ? parentItem.path : "";
  const path = parentPath ? `${parentPath}/${name}` : name;
  
  try {
    await fetch(`${API_BASE}/file/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, is_directory: true })
    });
    refresh();
  } catch (e) {
    showDialog({ type: 'alert', title: '错误', message: "创建文件夹失败: " + e.message });
  }
};

const renameItem = async (item) => {
  const newName = await showDialog({
    type: 'prompt',
    title: '重命名',
    defaultValue: item.name,
    message: '请输入新名称:'
  });
  
  if (!newName || newName === item.name) return;
  
  try {
    await fetch(`${API_BASE}/file/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path, new_name: newName })
    });
    refresh();
  } catch (e) {
    showDialog({ type: 'alert', title: '错误', message: "重命名失败: " + e.message });
  }
};

const deleteItem = async (item) => {
  const confirmed = await showDialog({
    type: 'confirm',
    title: '删除确认',
    message: `您确定要删除 '${item.name}' 吗？`
  });
  
  if (!confirmed) return;
  
  try {
    await fetch(`${API_BASE}/file/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path })
    });
    refresh();
  } catch (e) {
    showDialog({ type: 'alert', title: '错误', message: "删除失败: " + e.message });
  }
};
</script>