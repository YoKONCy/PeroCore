<template>
  <div class="flex flex-col h-full bg-[#1e293b] text-slate-200">
    <!-- Messages Area -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar" ref="msgContainer">
      <div v-for="(msg, idx) in messages" :key="idx" class="flex flex-col">
        
        <!-- User Message -->
        <div v-if="msg.role === 'user'" class="flex justify-end mb-2">
          <div class="max-w-[80%]">
            <div class="bg-amber-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm shadow-md text-sm leading-relaxed whitespace-pre-wrap font-sans">
              {{ msg.content }}
            </div>
            <div class="text-[10px] text-slate-500 mt-1 text-right mr-1">{{ new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }}</div>
          </div>
        </div>

        <!-- Pero Message -->
        <div v-else-if="msg.role === 'assistant'" class="flex justify-start mb-2 gap-3">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex-shrink-0 flex items-center justify-center text-white shadow-md">
            <span class="text-xs font-bold">P</span>
          </div>
          <div class="max-w-[80%]">
            <div class="bg-white text-slate-800 px-5 py-3 rounded-2xl rounded-tl-sm shadow-sm text-sm leading-relaxed whitespace-pre-wrap font-sans border border-slate-200/50">
              {{ msg.content }}
            </div>
          </div>
        </div>

        <!-- Thought Chain Card -->
        <div v-else-if="msg.role === 'thought_chain'" class="flex justify-start mb-2 gap-3 w-full">
           <div class="w-8 h-8 flex-shrink-0"></div> <!-- Spacer -->
           <div class="w-full max-w-2xl">
              <div class="bg-[#0f172a] border border-slate-700/50 rounded-xl overflow-hidden shadow-lg transition-all duration-300">
                <!-- Header -->
                <div 
                  class="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors"
                  @click="msg.isCollapsed = !msg.isCollapsed"
                >
                  <div class="flex items-center gap-2">
                    <div class="relative">
                       <div class="w-2 h-2 rounded-full bg-sky-400" :class="{'animate-pulse': msg.isThinking}"></div>
                       <div v-if="msg.isThinking" class="absolute inset-0 w-2 h-2 rounded-full bg-sky-400 animate-ping opacity-75"></div>
                    </div>
                    <span class="text-xs font-bold text-sky-400 tracking-wide">
                      {{ msg.isThinking ? 'PERO 正在思考...' : '思考过程' }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-slate-500 font-mono" v-if="msg.steps.length > 0">{{ msg.steps.length }} 步</span>
                    <span class="text-slate-500 transition-transform duration-200" :class="{'rotate-180': !msg.isCollapsed}">▼</span>
                  </div>
                </div>
                
                <!-- Content -->
                <div v-if="!msg.isCollapsed" class="bg-[#020617]/50 border-t border-slate-800/50 max-h-[400px] overflow-y-auto custom-scrollbar">
                  <div class="p-4 space-y-3">
                    <div v-for="(step, sIdx) in msg.steps" :key="sIdx" class="relative pl-4 border-l-2"
                      :class="{
                        'border-sky-500/50': step.type === 'thinking',
                        'border-emerald-500/50': step.type === 'action',
                        'border-red-500/50': step.type === 'error',
                        'border-amber-500/50': step.type === 'reflection'
                      }"
                    >
                      <div class="absolute -left-[5px] top-0 w-2 h-2 rounded-full" 
                        :class="{
                           'bg-sky-500': step.type === 'thinking',
                           'bg-emerald-500': step.type === 'action',
                           'bg-red-500': step.type === 'error',
                           'bg-amber-500': step.type === 'reflection'
                        }"
                      ></div>
                      <div class="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70"
                        :class="{
                           'text-sky-400': step.type === 'thinking',
                           'text-emerald-400': step.type === 'action',
                           'text-red-400': step.type === 'error',
                           'text-amber-400': step.type === 'reflection'
                        }"
                      >
                        {{ step.type }}
                      </div>
                      <div class="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed opacity-90">{{ step.content }}</div>
                    </div>
                  </div>

                  <!-- Actions -->
                  <div v-if="msg.isThinking" class="px-4 py-2 bg-slate-900/50 border-t border-slate-800/50 flex gap-2">
                     <button @click="injectInstruction('stop')" class="px-3 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs rounded-md border border-red-500/20 transition-all font-medium flex items-center gap-1">
                       <span class="w-1.5 h-1.5 bg-red-500 rounded-sm"></span> 停止
                     </button>
                     <button @click="togglePause" class="px-3 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs rounded-md border border-amber-500/20 transition-all font-medium flex items-center gap-1">
                       <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> {{ msg.isPaused ? '继续' : '暂停' }}
                     </button>
                  </div>
                </div>
              </div>
           </div>
        </div>

      </div>
    </div>

    <!-- Input Area -->
    <div class="p-6 pt-0 bg-transparent flex-shrink-0">
      <div class="relative bg-[#0f172a] rounded-2xl shadow-xl border border-slate-700/50 transition-all focus-within:border-amber-500/50 focus-within:shadow-amber-500/10">
        <textarea 
          v-model="input" 
          @keydown.enter.prevent="handleEnter"
          class="w-full bg-transparent text-slate-200 text-sm p-4 pr-16 rounded-2xl focus:outline-none resize-none h-14 max-h-32 min-h-[56px] custom-scrollbar font-sans placeholder-slate-500"
          placeholder="问 Pero 任何问题..."
          :disabled="isSending"
          style="field-sizing: content;" 
        ></textarea>
        
        <div class="absolute right-2 bottom-2 flex items-center gap-1">
          <button 
             @click="sendMessage" 
             :disabled="isSending || !input.trim()"
             class="p-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center group"
          >
             <svg v-if="!isSending" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 group-hover:translate-x-0.5 transition-transform">
               <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
             </svg>
             <div v-else class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </button>
        </div>
      </div>
      <div class="text-center mt-2 text-[10px] text-slate-600 font-medium tracking-wide">
        PERO AI AGENT · POWERED BY RE-ACT ENGINE
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import AsyncMarkdown from '../AsyncMarkdown.vue';

const props = defineProps({
  workMode: Boolean
});

const messages = ref([]);
const input = ref('');
const msgContainer = ref(null);
const isSending = ref(false);
const isConnected = ref(false);
let ws = null;
let reconnectTimer = null;

// --- WebSocket Logic for Real-time Thoughts ---
const connectWS = () => {
  if (ws) ws.close();
  ws = new WebSocket('ws://localhost:8000/ws/voice');
  
  ws.onopen = () => {
    isConnected.value = true;
  };
  
  ws.onclose = () => {
    isConnected.value = false;
    reconnectTimer = setTimeout(connectWS, 3000);
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (e) {
      console.error('WS Parse Error', e);
    }
  };
};

const handleWSMessage = (data) => {
  if (data.type === 'status') {
    if (data.content === 'thinking') {
      ensureActiveThoughtChain();
      if (data.detail) {
        const stepContent = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
        const lastStep = activeThoughtChain.value.steps[activeThoughtChain.value.steps.length - 1];
        if (!lastStep || lastStep.content !== stepContent) {
           activeThoughtChain.value.steps.push({
             type: 'thinking', 
             content: stepContent
           });
           scrollToBottom();
        }
      }
    } else if (data.content === 'idle') {
      if (activeThoughtChain.value) {
        activeThoughtChain.value.isThinking = false;
        activeThoughtChain.value = null; 
      }
    }
  }
  else if (data.type === 'text_response') {
    if (!isSending.value) {
      messages.value.push({ role: 'assistant', content: data.content });
      scrollToBottom();
    }
  }
  else if (data.type === 'mode_update') {
    if (data.mode === 'work') {
      emit('mode-change', data.is_active);
    }
  }
};

const activeThoughtChain = ref(null);

const ensureActiveThoughtChain = () => {
  const lastMsg = messages.value[messages.value.length - 1];
  if (lastMsg && lastMsg.role === 'thought_chain' && lastMsg.isThinking) {
    activeThoughtChain.value = lastMsg;
    return;
  }
  
  const newChain = {
    role: 'thought_chain',
    isThinking: true,
    isCollapsed: false,
    isPaused: false,
    steps: []
  };
  messages.value.push(newChain);
  activeThoughtChain.value = newChain;
  scrollToBottom();
};

const togglePause = async () => {
  if (!activeThoughtChain.value) return;
  const isPaused = activeThoughtChain.value.isPaused;
  const action = isPaused ? 'resume' : 'pause';
  
  await injectInstruction(action);
  activeThoughtChain.value.isPaused = !isPaused;
};

const injectInstruction = async (action) => {
  const sessionId = props.workMode ? 'current_work_session' : 'default'; 
  try {
    if (action === 'pause') {
      await fetch(`http://localhost:8000/api/task/${sessionId}/pause`, { method: 'POST' });
    } else if (action === 'resume') {
       await fetch(`http://localhost:8000/api/task/${sessionId}/resume`, { method: 'POST' });
    } else if (action === 'stop') {
       await fetch(`http://localhost:8000/api/task/${sessionId}/inject`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ instruction: '停止任务' })
       });
    }
  } catch (e) {
    console.error('Task control failed', e);
  }
};

onMounted(() => {
  connectWS();
  fetchHistory();
});

watch(() => props.workMode, () => {
  fetchHistory();
});

const fetchHistory = async () => {
  // If in work mode, use 'ide' source.
  // If in chat mode (workMode false), use 'desktop' source to sync with PetView.
  const source = props.workMode ? 'ide' : 'desktop';
  const sessionId = props.workMode ? 'current_work_session' : 'default';
  
  try {
    const res = await fetch(`http://localhost:9120/api/history/${source}/${sessionId}?limit=50&sort=asc`);
    if (res.ok) {
      const logs = await res.json();
      messages.value = logs.map(log => ({
        role: log.role,
        content: log.content
      }));
      await nextTick();
      scrollToBottom();
    }
  } catch (e) {
    console.error('Failed to fetch history', e);
  }
};

onUnmounted(() => {
  if (ws) ws.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
});

// --- Chat Logic ---
const handleEnter = (e) => {
    if (e.shiftKey) return;
    sendMessage();
};

const sendMessage = async () => {
  if (!input.value.trim() || isSending.value) return;
  
  const content = input.value;
  messages.value.push({ role: 'user', content });
  input.value = '';
  isSending.value = true;
  
  await nextTick();
  scrollToBottom();

  try {
    const res = await fetch('http://localhost:9120/api/ide/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: messages.value.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10), 
        source: props.workMode ? 'ide' : 'desktop',
        session_id: props.workMode ? 'current_work_session' : 'default'
      })
    });
    
    if (!res.body) throw new Error("No response body");
    
    const assistantMsg = { role: 'assistant', content: '' };
    messages.value.push(assistantMsg);
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        assistantMsg.content += chunk;
        scrollToBottom();
    }

  } catch (e) {
    messages.value.push({ role: 'assistant', content: `Error: ${e.message}` });
  } finally {
    isSending.value = false;
    if (activeThoughtChain.value) {
      activeThoughtChain.value.isThinking = false;
      activeThoughtChain.value = null;
    }
    scrollToBottom();
  }
};

const scrollToBottom = () => {
  if (msgContainer.value) {
    msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
  }
};
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #334155;
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #475569;
}
</style>