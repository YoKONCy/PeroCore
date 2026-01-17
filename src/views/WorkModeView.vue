<template>
  <div class="h-full w-full bg-[#1e293b] text-slate-200 font-sans flex overflow-hidden">
    <!-- Sidebar (Files & Navigation) -->
    <div class="w-64 bg-[#0f172a] flex flex-col border-r border-slate-800/50 pt-8"> <!-- Added pt-8 for titlebar space -->
      <!-- Navigation Items (Mocking the "Agents" look) -->
      <div class="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
        <div class="px-3 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">项目文件</div>
        
        <!-- File Explorer Component -->
        <FileExplorer @file-selected="onFileSelected" />
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 flex flex-col bg-[#1e293b] relative pt-8"> <!-- Added pt-8 for titlebar space -->
      <!-- Top Bar (Tool Bar) -->
      <header class="h-12 px-6 flex items-center justify-between border-b border-slate-700/30 bg-[#1e293b]/95 backdrop-blur z-10">
        <div class="flex items-center gap-4">
          <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-xs border border-amber-500/20">Focus Mode</span>
        </div>

        <!-- Work Mode Actions -->
        <div class="flex items-center gap-3">
           <div class="flex items-center bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
             <button 
               @click="emit('exit', true)"
               class="flex items-center gap-2 px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md transition-all shadow-lg shadow-emerald-500/20 mr-2"
             >
               <CheckCircleIcon class="w-4 h-4" />
               <span class="text-sm font-medium">Finish</span>
             </button>
             <button 
               @click="emit('exit', false)"
               class="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-red-400 rounded-md transition-colors"
               title="Abort"
             >
               <XCircleIcon class="w-5 h-5" />
             </button>
           </div>
        </div>
      </header>

      <!-- Content Stage -->
      <div class="flex-1 flex overflow-hidden relative">
        
        <!-- Chat Area (Adjusts width) -->
        <div class="flex flex-col w-[400px] border-r border-slate-700/30 transition-all duration-500">
           <IdeChat :work-mode="true" class="flex-1" />
        </div>

        <!-- Code Editor -->
        <div class="flex-1 flex flex-col bg-[#0f172a] shadow-inner">
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

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { 
  Files as FilesIcon, 
  CheckCircle as CheckCircleIcon,
  XCircle as XCircleIcon,
  X as XIcon
} from 'lucide-vue-next';
import FileExplorer from '../components/ide/FileExplorer.vue';
import CodeEditor from '../components/ide/CodeEditor.vue';
import IdeChat from '../components/ide/IdeChat.vue';

const emit = defineEmits(['exit']);

// State
const openFiles = ref([]);
const currentFile = ref(null);

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
</style>