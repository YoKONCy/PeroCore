<template>
  <div class="h-screen w-screen bg-[#1e293b] text-slate-200 font-sans flex overflow-hidden">
    <!-- Sidebar (Files & Navigation) -->
    <div class="w-64 bg-[#0f172a] flex flex-col border-r border-slate-800/50">
      <!-- App Header -->
      <div class="h-16 flex items-center px-6 border-b border-slate-800/50 bg-[#0f172a]">
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 mr-3">
          <span class="text-sm font-bold">P</span>
        </div>
        <span class="text-lg font-bold text-slate-100 tracking-tight">Pero IDE</span>
      </div>

      <!-- Navigation Items (Mocking the "Agents" look) -->
      <div class="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
        <div class="px-3 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">项目文件</div>
        
        <!-- File Explorer Component -->
        <FileExplorer @file-selected="onFileSelected" />
      </div>

      <!-- User Profile / Bottom Actions -->
      <div class="p-4 border-t border-slate-800/50 bg-[#0f172a]">
        <div class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-800/50 transition-colors cursor-pointer">
          <div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs">用户</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-slate-200 truncate">Administrator</div>
            <div class="text-xs text-slate-500 truncate">在线</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 flex flex-col bg-[#1e293b] relative">
      <!-- Top Bar -->
      <header class="h-16 px-6 flex items-center justify-between border-b border-slate-700/30 bg-[#1e293b]/95 backdrop-blur z-10">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-semibold text-slate-100">
            {{ isWorkMode ? '🎯 Work Session' : '💬 Pero Chat' }}
          </h2>
          <span v-if="isWorkMode" class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-xs border border-amber-500/20">Focus Mode</span>
        </div>

        <!-- Work Mode Toggle -->
        <div class="flex items-center gap-3">
           <div class="flex items-center bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
             <button 
               v-if="!isWorkMode"
               @click="enterWorkMode"
               class="flex items-center gap-2 px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md transition-all shadow-lg shadow-amber-500/20"
             >
               <PlayIcon class="w-4 h-4" />
               <span class="text-sm font-medium">Start Work</span>
             </button>
             
             <template v-else>
               <button 
                 @click="exitWorkMode(true)"
                 class="flex items-center gap-2 px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md transition-all shadow-lg shadow-emerald-500/20 mr-2"
               >
                 <CheckCircleIcon class="w-4 h-4" />
                 <span class="text-sm font-medium">Finish</span>
               </button>
               <button 
                 @click="exitWorkMode(false)"
                 class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-red-400 rounded-md transition-colors"
                 title="Abort"
               >
                 <XCircleIcon class="w-5 h-5" />
               </button>
             </template>
           </div>
        </div>
      </header>

      <!-- Content Stage -->
      <div class="flex-1 flex overflow-hidden relative">
        
        <!-- Chat Area (Always visible, adjusts width) -->
        <div 
          class="flex flex-col transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
          :class="isWorkMode ? 'w-[400px] border-r border-slate-700/30' : 'w-full max-w-5xl mx-auto'"
        >
           <IdeChat :work-mode="isWorkMode" class="flex-1" />
        </div>

        <!-- Code Editor (Only in Work Mode) -->
        <transition name="slide-up">
          <div v-if="isWorkMode" class="flex-1 flex flex-col bg-[#0f172a] shadow-inner">
             <!-- Editor Tabs -->
             <div class="h-10 bg-[#0f172a] border-b border-slate-800 flex items-center px-2 gap-1 overflow-x-auto">
                <div 
                  v-for="file in openFiles" 
                  :key="file.path"
                  @click="currentFile = file"
                  class="group flex items-center gap-2 px-4 py-2 text-xs rounded-t-lg cursor-pointer transition-all border-b-2"
                  :class="currentFile?.path === file.path ? 'bg-[#1e293b] text-amber-400 border-amber-400' : 'text-slate-500 hover:bg-[#1e293b]/50 border-transparent'"
                >
                  <span>{{ file.name }}</span>
                  <button @click.stop="closeFile(file)" class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-400">
                    <XIcon class="w-3 h-3" />
                  </button>
                </div>
             </div>

             <!-- Editor Content -->
             <div class="flex-1 relative">
               <CodeEditor 
                 v-if="currentFile"
                 :file-path="currentFile.path" 
                 :initial-content="currentFile.content"
                 :language="getLanguage(currentFile.name)"
                 @save="saveFile"
               />
               <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                  <FilesIcon class="w-16 h-16 mb-4 opacity-20" />
                  <p class="text-sm">Select a file to start editing</p>
               </div>
             </div>
          </div>
        </transition>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { 
  Files as FilesIcon, 
  Play as PlayIcon, 
  CheckCircle as CheckCircleIcon,
  XCircle as XCircleIcon,
  X as XIcon
} from 'lucide-vue-next';
import FileExplorer from '../components/ide/FileExplorer.vue';
import CodeEditor from '../components/ide/CodeEditor.vue';
import IdeChat from '../components/ide/IdeChat.vue';

// State
const isWorkMode = ref(false);
const openFiles = ref([]);
const currentFile = ref(null);
const monitorSegments = ref([]); // Kept for logic compatibility, though IdeChat handles display now

// Setup Tauri Event Listeners
onMounted(async () => {
  if (window.__TAURI__) {
    const unlisten = await listen('monitor-data-update', (event) => {
      const data = event.payload;
      if (data) monitorSegments.value = data;
    });
    onUnmounted(() => unlisten());
  }
});

// File Handling
const onFileSelected = async (fileNode) => {
  const existing = openFiles.value.find(f => f.path === fileNode.path);
  if (existing) {
    currentFile.value = existing;
    return;
  }

  try {
    const res = await fetch('http://localhost:8000/api/ide/file/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fileNode.path })
    });
    if (!res.ok) throw new Error('Failed to read file');
    const data = await res.json();
    
    const newFile = { ...fileNode, content: data.content };
    openFiles.value.push(newFile);
    currentFile.value = newFile;
  } catch (e) {
    console.error(e);
  }
};

const closeFile = (file) => {
  const idx = openFiles.value.indexOf(file);
  if (idx > -1) {
    openFiles.value.splice(idx, 1);
    if (currentFile.value === file) {
      currentFile.value = openFiles.value[openFiles.value.length - 1] || null;
    }
  }
};

const getLanguage = (filename) => {
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.vue')) return 'html'; 
  if (filename.endsWith('.rs')) return 'rust';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.md')) return 'markdown';
  return 'plaintext';
};

const saveFile = (content) => {
  console.log('Saving...', content.length);
};

// Work Mode
const enterWorkMode = async () => {
  const taskName = prompt("我们今天要完成什么任务？");
  if (!taskName) return;
  
  try {
    const res = await fetch('http://localhost:8000/api/ide/work_mode/enter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_name: taskName })
    });
    if (res.ok) isWorkMode.value = true;
  } catch (e) {
    alert("进入工作模式失败");
  }
};

const exitWorkMode = async (shouldLog) => {
  const endpoint = shouldLog ? 'exit' : 'abort';
  try {
    const res = await fetch(`http://localhost:8000/api/ide/work_mode/${endpoint}`, {
      method: 'POST'
    });
    if (res.ok) {
      isWorkMode.value = false;
      const data = await res.json();
      if (shouldLog) alert("会话已保存！");
    }
  } catch (e) {
    alert("退出工作模式失败");
  }
};
</script>

<style scoped>
/* Custom Scrollbar for dark theme */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>