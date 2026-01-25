<template>
  <div class="h-full w-full bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 text-slate-200 font-sans flex overflow-hidden relative p-4 gap-4">
    
    <!-- 错误遮罩 -->
    <div v-if="error" class="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8">
      <div class="bg-slate-900/90 border border-red-500/30 p-6 rounded-2xl shadow-2xl max-w-2xl w-full">
        <div class="flex items-center gap-3 text-red-400 mb-4">
          <XCircleIcon class="w-6 h-6" />
          <span class="text-xl font-bold">组件错误</span>
        </div>
        <pre class="bg-black/50 p-4 rounded-xl text-left overflow-auto text-xs font-mono text-slate-300 mb-6 border border-white/5">{{ error }}</pre>
        <div class="flex justify-end">
          <button @click="emit('exit', false)" class="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition text-white font-medium flex items-center gap-2">
            <LogOutIcon class="w-4 h-4" />
            退出工作模式
          </button>
        </div>
      </div>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="!isReady && !error" class="absolute inset-0 z-50 flex items-center justify-center bg-slate-950">
       <div class="flex flex-col items-center gap-6">
         <div class="relative">
           <div class="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
           <div class="absolute inset-0 flex items-center justify-center">
             <div class="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
           </div>
         </div>
         <span class="text-slate-400 text-sm font-medium tracking-wide animate-pulse">正在初始化工作环境...</span>
       </div>
    </div>

    <!-- 左侧面板: 资源管理器 (悬浮卡片) -->
    <div v-show="isReady && !error" class="w-72 bg-[#1e293b]/60 backdrop-blur-xl border border-white/5 rounded-2xl flex flex-col shadow-2xl overflow-hidden transition-all duration-300 hover:border-white/10 group/sidebar">
      <!-- 面板标题栏 -->
      <div class="h-14 px-5 flex items-center justify-between border-b border-white/5 bg-white/5">
        <div class="flex items-center gap-2 text-indigo-400">
          <FolderOpenIcon class="w-5 h-5" />
          <span class="font-bold tracking-wide text-sm">项目工程</span>
        </div>
        <!-- 可选: 侧边栏切换按钮可放在此处 -->
      </div>
      
      <!-- 文件树 -->
      <div class="flex-1 overflow-hidden">
        <FileExplorer @file-selected="onFileSelected" />
      </div>
    </div>

    <!-- 主内容区域 (悬浮卡片) -->
    <div v-show="isReady && !error" class="flex-1 flex flex-col relative gap-4 overflow-hidden">
      
      <!-- 顶部导航栏 -->
      <header class="h-14 px-6 bg-[#1e293b]/60 backdrop-blur-xl border border-white/5 rounded-2xl flex items-center justify-between shadow-lg shrink-0">
        <!-- 面包屑 / 状态 -->
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
            <div class="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
            <span class="text-indigo-400 text-xs font-bold tracking-wide uppercase">专注模式</span>
          </div>
          <div class="h-4 w-px bg-white/10"></div>
          <span class="text-slate-400 text-sm flex items-center gap-2">
            <LayoutGridIcon class="w-4 h-4" />
            <span>工作区</span>
          </span>
        </div>

        <!-- 工作模式操作 -->
        <div class="flex items-center gap-3">
           <button 
             @click="emit('exit', false)"
             class="flex items-center gap-2 px-4 py-2 hover:bg-white/5 text-slate-400 hover:text-red-400 rounded-xl transition-all duration-200 group"
             title="取消工作 (不保存日志)"
           >
             <XCircleIcon class="w-4 h-4 group-hover:scale-110 transition-transform" />
             <span class="text-sm font-medium">取消工作</span>
           </button>
           
           <button 
             @click="emit('exit', true)"
             class="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/25 group hover:scale-105 active:scale-95"
             title="完成工作 (生成日志)"
           >
             <CheckCircleIcon class="w-4 h-4 group-hover:rotate-12 transition-transform" />
             <span class="text-sm font-bold">完成工作</span>
           </button>
        </div>
      </header>

      <!-- 编辑器 & 聊天 & 终端容器 -->
      <div class="flex-1 flex flex-col gap-4 overflow-hidden">
        
        <!-- 编辑器 & 聊天分屏视图 -->
        <div class="flex-1 flex gap-4 overflow-hidden min-h-0">
          
          <!-- 代码编辑器容器 -->
          <div class="flex-1 flex flex-col bg-[#1e293b]/80 backdrop-blur-md border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative group/editor">
             <!-- 编辑器标签页 -->
             <div class="h-10 bg-black/20 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
                <div 
                  v-for="file in openFiles" 
                  :key="file.path"
                  @click="currentFile = file"
                  class="group/tab flex items-center gap-2 px-4 py-1.5 text-xs rounded-lg cursor-pointer transition-all border border-transparent min-w-[120px] max-w-[200px] relative"
                  :class="currentFile?.path === file.path ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-sm' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'"
                >
                  <FileCodeIcon class="w-3.5 h-3.5 opacity-70" />
                  <span class="truncate">{{ file.name }}</span>
                  <!-- 关闭按钮 -->
                  <button 
                    @click.stop="closeFile(file)" 
                    class="absolute right-1 p-0.5 rounded-md opacity-0 group-hover/tab:opacity-100 hover:bg-white/10 text-slate-400 transition-all"
                  >
                    <XIcon class="w-3 h-3" />
                  </button>
                  <!-- 未保存指示器 -->
                  <div v-if="dirtyFiles.has(file.path)" class="absolute right-2 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"></div>
                </div>
             </div>

             <!-- 编辑器内容 -->
              <div class="flex-1 relative bg-[#0f172a]/50">
                <CodeEditor 
                  v-if="currentFile"
                  :initial-content="currentFile.content"
                  :language="getLanguage(currentFile.name)"
                  :file-path="currentFile.path"
                  @save="saveFile"
                  @change="onContentChange"
                  class="h-full w-full"
                />
                <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-slate-600/50">
                   <div class="p-6 rounded-full bg-white/5 mb-6 animate-pulse">
                     <Code2Icon class="w-16 h-16 opacity-50" />
                   </div>
                   <p class="text-sm font-medium tracking-wide uppercase text-slate-500">选择一个文件以开始编辑</p>
                   <p class="text-xs text-slate-600 mt-2">使用左侧资源管理器浏览文件</p>
                </div>
                
                <!-- 悬浮保存按钮 -->
                <Transition name="fade">
                    <button 
                        v-if="currentFile && dirtyFiles.has(currentFile.path)"
                        @click="saveFile(currentFile.content)"
                        class="absolute bottom-6 right-6 p-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full shadow-lg shadow-indigo-500/40 transition-all hover:scale-110 active:scale-95 z-20 group flex items-center gap-2"
                        title="保存文件 (Ctrl+S)"
                    >
                        <SaveIcon class="w-6 h-6" />
                        <span class="max-w-0 overflow-hidden group-hover:max-w-[100px] transition-all duration-300 whitespace-nowrap font-bold text-sm">保存更改</span>
                    </button>
                </Transition>
              </div>
          </div>

          <!-- 聊天区域 (悬浮侧边栏) -->
          <div class="w-[400px] flex flex-col bg-[#1e293b]/80 backdrop-blur-md border border-white/5 rounded-2xl shadow-2xl overflow-hidden transition-all duration-500">
             <ChatInterface :work-mode="true" :disabled="!isReady" class="flex-1" />
          </div>

        </div>

        <!-- 终端管理器 -->
        <TerminalManager />
      
      </div>
    </div>

    <CustomDialog
      v-model:visible="dialog.visible"
      :type="dialog.type"
      :title="dialog.title"
      :message="dialog.message"
      @confirm="handleDialogConfirm"
      @cancel="handleDialogCancel"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onErrorCaptured, computed, reactive } from 'vue';
import { 
  Files as FilesIcon, 
  CheckCircle as CheckCircleIcon,
  XCircle as XCircleIcon,
  X as XIcon,
  Circle as CircleIcon,
  LogOut as LogOutIcon,
  FolderOpen as FolderOpenIcon,
  LayoutGrid as LayoutGridIcon,
  FileCode as FileCodeIcon,
  Code2 as Code2Icon
} from 'lucide-vue-next';
import FileExplorer from '../components/ide/FileExplorer.vue';
import CodeEditor from '../components/ide/CodeEditor.vue';
import ChatInterface from '../components/chat/ChatInterface.vue';
import CustomDialog from '../components/ui/CustomDialog.vue';
import TerminalManager from '../components/ide/TerminalManager.vue';

const props = defineProps({
  isReady: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['exit']);

// 对话框状态
const dialog = reactive({
  visible: false,
  type: 'alert',
  title: '',
  message: '',
  resolve: null
});

const showDialog = ({ type, title, message }) => {
  return new Promise((resolve) => {
    dialog.type = type;
    dialog.title = title;
    dialog.message = message;
    dialog.resolve = resolve;
    dialog.visible = true;
  });
};

const handleDialogConfirm = () => {
  if (dialog.resolve) dialog.resolve(true);
  dialog.visible = false;
};

const handleDialogCancel = () => {
  if (dialog.resolve) dialog.resolve(false);
  dialog.visible = false;
};

// 错误处理
const error = ref(null);
onErrorCaptured((err) => {
  console.error("WorkModeView Error:", err);
  error.value = err.message;
  return true; 
});

// 状态
const isReady = ref(false);
const agentName = ref('Pero');

const fetchActiveAgent = async () => {
  try {
    const res = await fetch('http://localhost:9120/api/agents');
    if (res.ok) {
      const agents = await res.json();
      const active = agents.find(a => a.is_active);
      if (active) agentName.value = active.name;
    }
  } catch (e) { console.error(e); }
};

const activeTab = ref('explorer');
const openFiles = ref([]);
const currentFile = ref(null);
const dirtyFiles = ref(new Set());

onMounted(() => {
  console.log("WorkModeView Mounted");
  // Instant ready for smoother transition since parent handles overlap
  isReady.value = true;
});

// 文件处理
const onFileSelected = async (fileNode) => {
  const existing = openFiles.value.find(f => f.path === fileNode.path);
  if (existing) {
    currentFile.value = existing;
    return;
  }

  try {
    const res = await fetch('http://localhost:9120/api/ide/file/read', {
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

const closeFile = async (file) => {
  if (dirtyFiles.value.has(file.path)) {
    const confirmed = await showDialog({
      type: 'confirm',
      title: '未保存更改',
      message: `'${file.name}' 有未保存的更改。确定要放弃更改并关闭吗？`
    });

    if (!confirmed) {
         return;
    }
    dirtyFiles.value.delete(file.path);
  }

  const idx = openFiles.value.indexOf(file);
  if (idx > -1) {
    openFiles.value.splice(idx, 1);
    if (currentFile.value === file) {
      currentFile.value = openFiles.value[openFiles.value.length - 1] || null;
    }
  }
};

const getLanguage = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  
  const map = {
    'py': 'python',
    'js': 'javascript',
    'ts': 'typescript',
    'vue': 'html', // Monaco 没有内置 Vue 支持，使用 HTML 效果尚可
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'md': 'markdown',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'go': 'go',
    'sh': 'shell',
    'bash': 'shell',
    'sql': 'sql',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'ini': 'ini',
    'toml': 'ini',
    'bat': 'bat',
    'ps1': 'powershell'
  };

  return map[ext] || 'plaintext';
};

const onContentChange = (newContent) => {
  if (currentFile.value) {
    currentFile.value.content = newContent; // 更新内存中的内容
    dirtyFiles.value.add(currentFile.value.path);
  }
};

const saveFile = async (content) => {
  if (!currentFile.value) return;
  
  try {
    const res = await fetch('http://localhost:9120/api/ide/file/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        path: currentFile.value.path, 
        content: content 
      })
    });
    
    if (res.ok) {
      dirtyFiles.value.delete(currentFile.value.path);
      // Optional: Toast notification
    } else {
      showDialog({ type: 'alert', title: '错误', message: "保存文件失败" });
    }
  } catch (e) {
    console.error(e);
    showDialog({ type: 'alert', title: '错误', message: "保存文件时出错" });
  }
};
</script>

<style scoped>
/* 深色主题自定义滚动条 */
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