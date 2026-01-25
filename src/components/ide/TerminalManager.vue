<template>
  <div 
    class="flex flex-col border-t border-white/10 bg-[#1e293b]/95 backdrop-blur-xl shadow-2xl transition-all duration-200 z-40"
    :style="{ height: isCollapsed ? '40px' : height + 'px' }"
  >
    <!-- 标题栏 / 调整大小句柄 -->
    <div 
      class="h-10 flex items-center justify-between px-4 bg-slate-900/50 border-b border-white/5 select-none hover:bg-white/5 transition-colors group"
      :class="{ 'cursor-ns-resize': !isCollapsed, 'cursor-pointer': isCollapsed }"
      @mousedown="handleMouseDown"
    >
      <div class="flex items-center gap-3 text-slate-400 cursor-pointer" @click.stop="toggleCollapse">
        <div class="p-1 rounded bg-slate-800 text-indigo-400">
           <Terminal class="w-4 h-4" />
        </div>
        <span class="text-xs font-bold uppercase tracking-wider group-hover:text-slate-200 transition-colors">内置终端管理器</span>
        <div class="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-mono border border-indigo-500/30" v-if="terminals.length > 0">
            {{ activeCount }} 运行中
        </div>
      </div>
      
      <div class="flex items-center gap-2">
         <!-- Quick Actions -->
         <button 
           v-if="!isCollapsed && activeTerminal && activeTerminal.active"
           @click.stop="stopActiveTerminal"
           class="p-1 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded transition-colors mr-2"
           title="终止当前进程"
         >
           <Square class="w-3.5 h-3.5 fill-current" />
         </button>

         <button @click.stop="toggleCollapse" class="p-1 hover:bg-white/10 rounded text-slate-500 hover:text-white transition-colors">
            <ChevronDown v-if="!isCollapsed" class="w-4 h-4" />
            <ChevronUp v-else class="w-4 h-4" />
         </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div v-show="!isCollapsed" class="flex-1 flex overflow-hidden">
       <!-- 侧边栏 -->
       <div class="w-56 bg-slate-950/30 border-r border-white/5 flex flex-col">
          <!-- 侧边栏标题 -->
          <div class="h-8 flex items-center px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-black/10">
             会话列表
          </div>
          
          <!-- 列表 -->
          <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            <div 
                v-for="term in terminals" 
                :key="term.pid"
                @click="activePid = term.pid"
                class="px-3 py-2.5 cursor-pointer rounded-lg border border-transparent transition-all group relative overflow-hidden"
                :class="activePid === term.pid ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'"
            >
                <div class="flex items-center justify-between mb-1 relative z-10">
                    <span class="text-xs font-mono font-bold truncate">#{{ term.pid }}</span>
                    <div class="flex items-center gap-2">
                         <span v-if="term.active" class="flex h-2 w-2 relative">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                         </span>
                         <span v-else class="w-2 h-2 rounded-full bg-slate-700"></span>
                    </div>
                </div>
                <div class="text-[10px] opacity-70 truncate font-mono relative z-10" :title="term.command">
                    {{ term.command }}
                </div>
                
                <!-- 进度条背景 (可选用于任务进度) -->
                <div v-if="term.active" class="absolute bottom-0 left-0 h-0.5 bg-indigo-500/50 animate-pulse w-full"></div>
            </div>
            
            <div v-if="terminals.length === 0" class="flex flex-col items-center justify-center py-8 text-slate-600 gap-2">
                <Terminal class="w-8 h-8 opacity-20" />
                <span class="text-xs italic">无活跃终端</span>
            </div>
          </div>
       </div>
       
       <!-- Terminal Viewport -->
       <div class="flex-1 bg-[#0f172a] flex flex-col min-w-0">
          <template v-if="activeTerminal">
             <!-- Viewport Header -->
             <div class="h-8 flex items-center justify-between px-4 border-b border-white/5 bg-[#0f172a] sticky top-0 z-10">
                <div class="flex items-center gap-2 overflow-hidden">
                    <span class="text-green-500 font-mono text-xs">$</span>
                    <span class="text-slate-300 font-mono text-xs truncate" :title="activeTerminal.command">{{ activeTerminal.command }}</span>
                </div>
                <span class="text-[10px] text-slate-600 font-mono">PID: {{ activeTerminal.pid }}</span>
             </div>
             
             <!-- Output Area -->
             <div class="flex-1 overflow-y-auto p-4 font-mono text-xs custom-scrollbar" ref="viewport">
                <div class="whitespace-pre-wrap text-slate-300 leading-relaxed font-ligatures-none">{{ activeTerminal.output }}</div>
                
                <div v-if="activeTerminal.active" class="mt-2 flex items-center gap-2 text-slate-600">
                    <div class="w-1.5 h-3 bg-slate-500 animate-pulse"></div>
                </div>
                
                <div v-else class="mt-4 py-2 border-t border-dashed border-slate-800 text-slate-500 italic text-[10px]">
                    进程已结束，退出代码 {{ activeTerminal.exitCode }}
                </div>
             </div>
          </template>
          
          <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-600">
             <div class="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
                 <Terminal class="w-8 h-8 opacity-50" />
             </div>
             <span class="text-sm">准备就绪</span>
             <p class="text-xs text-slate-700 mt-2 max-w-[200px] text-center">Agent 的操作输出将自动显示在这里</p>
          </div>
       </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { Terminal, ChevronDown, ChevronUp, Square } from 'lucide-vue-next';

const isCollapsed = ref(true); // Default collapsed
const height = ref(300);
const terminals = ref([]);
const activePid = ref(null);
const viewport = ref(null);

const activeTerminal = computed(() => terminals.value.find(t => t.pid === activePid.value));
const activeCount = computed(() => terminals.value.filter(t => t.active).length);

const toggleCollapse = () => {
    isCollapsed.value = !isCollapsed.value;
};

// Resizing Logic
let startY = 0;
let startHeight = 0;

const handleMouseDown = (e) => {
    // Only resize if clicking on the header itself, not buttons
    if (isCollapsed.value) return;
    startResize(e);
};

const startResize = (e) => {
    startY = e.clientY;
    startHeight = height.value;
    window.addEventListener('mousemove', onResize);
    window.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
};

const onResize = (e) => {
    const delta = startY - e.clientY; // Dragging up increases height
    height.value = Math.max(150, Math.min(window.innerHeight - 100, startHeight + delta));
};

const stopResize = () => {
    window.removeEventListener('mousemove', onResize);
    window.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
};

// 终端逻辑
let unlisten = null;

const scrollToBottom = async () => {
    await nextTick();
    if (viewport.value) {
        viewport.value.scrollTop = viewport.value.scrollHeight;
    }
};

const stopActiveTerminal = async () => {
    // TODO: 如果需要，通过 API 实现终止逻辑
    // 目前仅为前端显示
};

onMounted(async () => {
    unlisten = await listen('ws-message', (event) => {
        const msg = event.payload;
        
        if (msg.type === 'terminal_init') {
            const exists = terminals.value.find(t => t.pid === msg.pid);
            if (!exists) {
                terminals.value.push({
                    pid: msg.pid,
                    command: msg.command,
                    output: '',
                    active: true,
                    exitCode: null
                });
                activePid.value = msg.pid; // 自动切换到新终端
                isCollapsed.value = false; // 自动展开
                scrollToBottom();
            }
        }
        else if (msg.type === 'terminal_output') {
            const term = terminals.value.find(t => t.pid === msg.pid);
            if (term) {
                term.output += msg.content;
                if (activePid.value === msg.pid) {
                    scrollToBottom();
                }
            }
        }
        else if (msg.type === 'terminal_exit') {
            const term = terminals.value.find(t => t.pid === msg.pid);
            if (term) {
                term.active = false;
                term.exitCode = msg.exit_code;
                if (activePid.value === msg.pid) {
                    scrollToBottom();
                }
            }
        }
    });
});

onUnmounted(() => {
    if (unlisten) unlisten();
});

watch(activePid, () => {
    scrollToBottom();
});

</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.font-ligatures-none {
    font-variant-ligatures: none;
}
</style>