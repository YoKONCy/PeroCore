<template>
  <div class="flex flex-col h-full transition-colors duration-300" :class="workMode ? 'bg-[#1e293b] text-slate-200' : 'bg-transparent text-slate-700'">
    <!-- Messages Area -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar flex flex-col" ref="msgContainer">
      <!-- Load More Button -->
      <div v-if="hasMore" class="flex justify-center py-4">
         <button @click="loadMore" class="text-xs text-slate-400 hover:text-sky-500 transition-colors flex items-center gap-1">
           <Clock class="w-3 h-3" />
           <span>查看更多历史记录</span>
         </button>
      </div>

      <div v-for="(msg, idx) in messages" :key="idx" class="flex flex-col">
        
        <!-- User Message -->
        <div v-if="msg.role === 'user'" class="flex justify-end mb-4 animate-fade-in-up group">
          <div class="max-w-[85%] animate-float flex flex-col items-end">
            <div 
              class="px-5 py-3 rounded-2xl rounded-tr-sm shadow-md text-sm leading-relaxed whitespace-pre-wrap font-sans transition-all backdrop-blur-xl border border-white/10 hover:scale-[1.02] hover:-translate-y-[2px] hover:shadow-lg hover:shadow-sky-500/30 relative hover:z-10 duration-300 ease-out"
              :class="workMode ? 'bg-amber-600/90 text-white' : 'bg-gradient-to-br from-sky-500/60 to-blue-600/60 text-white shadow-sky-500/20'"
            >
              <template v-if="editingMsgId === msg.id">
                 <textarea v-model="editingContent" class="w-full bg-transparent border-none outline-none resize-none text-white custom-scrollbar" rows="3" style="min-width: 200px;"></textarea>
                 <div class="flex gap-2 justify-end mt-2 pt-2 border-t border-white/20">
                    <button @click="saveEdit(msg)" class="p-1 hover:bg-white/20 rounded text-white" title="Save"><Check class="w-4 h-4" /></button>
                    <button @click="cancelEdit" class="p-1 hover:bg-white/20 rounded text-white" title="Cancel"><X class="w-4 h-4" /></button>
                 </div>
              </template>
              <template v-else>
                  {{ msg.content }}
               </template>
            </div>
            <div class="flex items-center gap-2 mt-1 mr-1">
               <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2" v-if="!editingMsgId">
                  <button @click="startEdit(msg)" class="text-slate-400 hover:text-sky-500 transition-colors"><Edit2 class="w-3 h-3" /></button>
                  <button @click="deleteMessage(msg.id)" class="text-slate-400 hover:text-red-500 transition-colors"><Trash2 class="w-3 h-3" /></button>
               </div>
               <div class="text-[10px] text-right" :class="workMode ? 'text-slate-500' : 'text-slate-400'">{{ formatTime(msg.timestamp) }}</div>
            </div>
          </div>
        </div>

        <!-- Pero Message -->
        <div v-else-if="msg.role === 'assistant'" class="flex justify-start mb-4 gap-3 group animate-fade-in-up">
          <!-- Avatar -->
          <div class="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white shadow-md transition-all overflow-hidden relative animate-float"
            :class="workMode ? 'bg-gradient-to-br from-indigo-400 to-purple-500' : 'bg-gradient-to-br from-sky-400 to-blue-500 shadow-sky-500/20'"
          >
             <span class="text-sm font-bold">P</span>
             <!-- Online Status Dot -->
             <div class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></div>
          </div>
          
          <div class="max-w-[85%] min-w-[200px] animate-float" style="animation-delay: 1s;">
             <!-- Name & Time -->
             <div class="flex items-center gap-2 mb-1.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
               <span class="text-xs font-bold" :class="workMode ? 'text-indigo-300' : 'text-slate-500'">Pero</span>
               <span class="text-[10px] text-slate-400">{{ formatTime(msg.timestamp) }}</span>
               
               <!-- Actions -->
               <div class="flex gap-2 ml-2" v-if="!editingMsgId">
                  <button @click="startEdit(msg)" class="text-slate-400 hover:text-sky-500 transition-colors"><Edit2 class="w-3 h-3" /></button>
                  <button @click="deleteMessage(msg.id)" class="text-slate-400 hover:text-red-500 transition-colors"><Trash2 class="w-3 h-3" /></button>
               </div>
             </div>

            <div 
              class="p-4 rounded-2xl rounded-tl-sm shadow-sm text-sm leading-relaxed font-sans border transition-all flex flex-col gap-3 backdrop-blur-xl hover:scale-[1.02] hover:-translate-y-[2px] hover:shadow-xl relative hover:z-10 duration-300 ease-out"
              :class="workMode 
                ? 'bg-[#1e293b]/90 text-slate-200 border-slate-700/50' 
                : 'bg-white/30 text-slate-700 border-white/20 shadow-lg shadow-sky-100/30'"
            >
              <template v-if="editingMsgId === msg.id">
                 <textarea v-model="editingContent" class="w-full bg-transparent border-none outline-none resize-none custom-scrollbar" :class="workMode ? 'text-slate-200' : 'text-slate-700'" rows="10"></textarea>
                 <div class="flex gap-2 justify-end mt-2 pt-2 border-t" :class="workMode ? 'border-slate-700' : 'border-slate-200'">
                    <button @click="saveEdit(msg)" class="p-1 hover:bg-black/10 rounded" :class="workMode ? 'text-slate-300' : 'text-slate-600'" title="Save"><Check class="w-4 h-4" /></button>
                    <button @click="cancelEdit" class="p-1 hover:bg-black/10 rounded" :class="workMode ? 'text-slate-300' : 'text-slate-600'" title="Cancel"><X class="w-4 h-4" /></button>
                 </div>
              </template>
              <template v-else>
              <template v-if="!msg.content && msg.role === 'assistant' && idx === messages.length - 1 && isSending">
                 <div class="flex items-center gap-2 h-6 px-1">
                    <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                    <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                    <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                    <span class="text-xs text-slate-400 ml-2 font-medium">Pero 正在思考...</span>
                 </div>
              </template>
              <template v-else v-for="(segment, sIdx) in parseMessage(msg.content)" :key="sIdx">
                
                <!-- Thinking Block -->
                <div v-if="segment.type === 'thinking'" class="rounded-lg overflow-hidden border my-1 transition-all duration-300"
                   :class="workMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50/50 border-slate-200/60'"
                >
                   <div class="px-3 py-1.5 flex items-center justify-between cursor-pointer select-none border-b transition-colors"
                      :class="workMode ? 'text-sky-400 border-slate-700 hover:bg-slate-700/50' : 'text-slate-500 bg-slate-100/30 border-slate-200/60 hover:bg-slate-100/50'"
                      @click="toggleCollapse(idx, sIdx)"
                   >
                      <div class="flex items-center gap-2 text-xs font-bold">
                        <Brain class="w-3.5 h-3.5" />
                        <span>Thinking Process</span>
                      </div>
                      <span class="text-[10px] transition-transform duration-200" :class="{'rotate-180': isCollapsed(idx, sIdx)}">▼</span>
                   </div>
                   <div v-show="!isCollapsed(idx, sIdx)" class="p-3 text-xs italic opacity-80 whitespace-pre-wrap font-mono leading-relaxed text-slate-500">
                     {{ segment.content }}
                   </div>
                </div>

                <!-- Monologue Block -->
                <div v-else-if="segment.type === 'monologue'" class="rounded-lg overflow-hidden border relative my-1 transition-all duration-300"
                   :class="workMode ? 'bg-pink-900/10 border-pink-500/20' : 'bg-pink-50/30 border-pink-100/60'"
                >
                   <div class="px-3 py-1.5 flex items-center justify-between cursor-pointer select-none border-b transition-colors"
                      :class="[
                         workMode ? 'text-pink-400 border-pink-500/10 hover:bg-pink-900/20' : 'text-pink-400 bg-pink-50/30 border-pink-100/60 hover:bg-pink-50/60'
                      ]"
                      @click="toggleCollapse(idx, sIdx)"
                   >
                      <div class="flex items-center gap-2 text-xs font-bold">
                        <MessageSquareQuote class="w-3.5 h-3.5" />
                        <span>Inner Monologue</span>
                      </div>
                      <span class="text-[10px] transition-transform duration-200" :class="{'rotate-180': isCollapsed(idx, sIdx)}">▼</span>
                   </div>
                   <div v-show="!isCollapsed(idx, sIdx)" class="px-3 py-3 text-xs opacity-90 whitespace-pre-wrap leading-relaxed text-slate-600">
                     {{ segment.content }}
                   </div>
                </div>

                <!-- Tool Block (NIT) -->
                <div v-else-if="segment.type === 'tool'" class="rounded-xl overflow-hidden border shadow-sm my-2"
                   :class="workMode ? 'border-blue-500/30' : 'border-blue-100/60'"
                >
                   <div class="px-3 py-2 text-xs font-bold text-white flex items-center justify-between cursor-pointer"
                      :class="workMode ? 'bg-blue-600/80' : 'bg-gradient-to-r from-blue-500/80 to-sky-500/80 backdrop-blur-sm'"
                      @click="toggleCollapse(idx, sIdx)"
                   >
                      <div class="flex items-center gap-2">
                        <Terminal class="w-3.5 h-3.5" />
                        <span>NIT: {{ segment.name }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                         <span class="font-mono opacity-70 text-[10px]">{{ segment.id }}</span>
                         <span class="text-[10px] transition-transform duration-200" :class="{'rotate-180': isCollapsed(idx, sIdx)}">▼</span>
                      </div>
                   </div>
                   <div v-show="!isCollapsed(idx, sIdx)" class="p-3 text-xs font-mono overflow-x-auto custom-scrollbar whitespace-pre"
                      :class="workMode ? 'bg-[#0f172a]/80 text-blue-200' : 'bg-slate-50/50 text-slate-600'"
                   >
                      {{ segment.content }}
                   </div>
                </div>

                <!-- Normal Text -->
                <div v-else class="min-h-[1.5em]">
                   <AsyncMarkdown :content="segment.content" v-if="segment.content" />
                </div>
                
              </template>
              </template>
            </div>
          </div>
        </div>

        <!-- Thought Chain Card -->
        <div v-else-if="msg.role === 'thought_chain'" class="flex justify-start mb-4 gap-3 w-full">
           <div class="w-10 h-10 flex-shrink-0"></div> <!-- Spacer -->
           <div class="w-full max-w-2xl">
              <div 
                class="rounded-2xl overflow-hidden shadow-lg transition-all duration-300 border hover:shadow-xl hover:scale-[1.01] hover:-translate-y-[2px]"
                :class="workMode 
                  ? 'bg-[#0f172a] border-slate-700/50' 
                  : 'bg-white/40 backdrop-blur-md border-white/30 shadow-sky-200/30'"
              >
                <!-- Header -->
                <div 
                  class="px-4 py-3 flex items-center justify-between cursor-pointer transition-colors"
                  :class="workMode ? 'hover:bg-slate-800/50' : 'hover:bg-white/40'"
                  @click="msg.isCollapsed = !msg.isCollapsed"
                >
                  <div class="flex items-center gap-2">
                    <div class="relative">
                       <div class="w-2 h-2 rounded-full" :class="[workMode ? 'bg-sky-400' : 'bg-sky-500', {'animate-pulse': msg.isThinking}]"></div>
                       <div v-if="msg.isThinking" class="absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-75" :class="workMode ? 'bg-sky-400' : 'bg-sky-500'"></div>
                    </div>
                    <span class="text-xs font-bold tracking-wide" :class="workMode ? 'text-sky-400' : 'text-sky-600'">
                      {{ msg.isThinking ? 'PERO 正在思考...' : '思考过程' }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] font-mono" :class="workMode ? 'text-slate-500' : 'text-slate-500'" v-if="msg.steps.length > 0">{{ msg.steps.length }} 步</span>
                    <span class="transition-transform duration-200" :class="[workMode ? 'text-slate-500' : 'text-slate-400', {'rotate-180': !msg.isCollapsed}]">▼</span>
                  </div>
                </div>
                
                <!-- Content -->
                <div v-if="!msg.isCollapsed" class="max-h-[400px] overflow-y-auto custom-scrollbar" :class="workMode ? 'bg-[#020617]/50 border-t border-slate-800/50' : 'bg-white/30 border-t border-white/20'">
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
                        :class="[
                          workMode ? '' : 'font-semibold',
                          {
                           'text-sky-400': step.type === 'thinking' && workMode,
                           'text-sky-700': step.type === 'thinking' && !workMode,
                           'text-emerald-400': step.type === 'action' && workMode,
                           'text-emerald-700': step.type === 'action' && !workMode,
                           'text-red-400': step.type === 'error' && workMode,
                           'text-red-700': step.type === 'error' && !workMode,
                           'text-amber-400': step.type === 'reflection' && workMode,
                           'text-amber-700': step.type === 'reflection' && !workMode
                        }]"
                      >
                        {{ step.type }}
                      </div>
                      <div class="text-xs font-mono whitespace-pre-wrap leading-relaxed opacity-90" :class="workMode ? 'text-slate-300' : 'text-slate-700'">{{ step.content }}</div>
                    </div>
                  </div>

                  <!-- Actions -->
                  <div v-if="msg.isThinking" class="px-4 py-2 flex gap-2 border-t" :class="workMode ? 'bg-slate-900/50 border-slate-800/50' : 'bg-white/40 border-white/20'">
                     <button @click="injectInstruction('stop')" class="px-3 py-1 text-xs rounded-md border transition-all font-medium flex items-center gap-1"
                       :class="workMode 
                         ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20' 
                         : 'bg-red-100 text-red-600 hover:bg-red-200 border-red-200'"
                     >
                       <span class="w-1.5 h-1.5 rounded-sm" :class="workMode ? 'bg-red-500' : 'bg-red-600'"></span> 停止
                     </button>
                     <button @click="togglePause" class="px-3 py-1 text-xs rounded-md border transition-all font-medium flex items-center gap-1"
                       :class="workMode 
                         ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20' 
                         : 'bg-amber-100 text-amber-600 hover:bg-amber-200 border-amber-200'"
                     >
                       <span class="w-1.5 h-1.5 rounded-full" :class="workMode ? 'bg-amber-500' : 'bg-amber-600'"></span> {{ msg.isPaused ? '继续' : '暂停' }}
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
      <div 
        class="relative rounded-2xl shadow-xl border transition-all"
        :class="workMode 
          ? 'bg-[#0f172a] border-slate-700/50 focus-within:border-amber-500/50 focus-within:shadow-amber-500/10' 
          : 'bg-white/60 border-sky-200/50 focus-within:border-sky-400/50 focus-within:shadow-sky-400/20 backdrop-blur-md'"
      >
        <textarea 
          v-model="input" 
          @keydown.enter.prevent="handleEnter"
          class="w-full bg-transparent text-sm p-4 pr-16 rounded-2xl focus:outline-none resize-none h-14 max-h-32 min-h-[56px] custom-scrollbar font-sans"
          :class="workMode ? 'text-slate-200 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'"
          placeholder="问 Pero 任何问题..."
          :disabled="isSending"
          style="field-sizing: content;" 
        ></textarea>
        
        <div class="absolute right-2 bottom-2 flex items-center gap-1">
          <button 
             @click="sendMessage" 
             :disabled="isSending || !input.trim()"
             class="p-2 text-white rounded-xl transition-all shadow-lg flex items-center justify-center group"
             :class="workMode 
               ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20 disabled:bg-slate-700 disabled:text-slate-500' 
               : 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/20 disabled:bg-slate-200 disabled:text-slate-400'"
          >
             <svg v-if="!isSending" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 group-hover:translate-x-0.5 transition-transform">
               <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
             </svg>
             <div v-else class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </button>
        </div>
      </div>
      <div class="text-center mt-2 text-[10px] font-medium tracking-wide" :class="workMode ? 'text-slate-600' : 'text-slate-400'">
        PERO AI AGENT · POWERED BY RE-ACT ENGINE
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import { Brain, MessageSquareQuote, Terminal, Play, Pause, Square, Clock, Edit2, Trash2, Check, X } from 'lucide-vue-next';
import AsyncMarkdown from '../AsyncMarkdown.vue';

const props = defineProps({
  workMode: Boolean
});

const emitEvent = defineEmits(['mode-change']);

const messages = ref([]);
const offset = ref(0);
const hasMore = ref(true);
const input = ref('');
const msgContainer = ref(null);
const isSending = ref(false);
const isConnected = ref(false);
let ws = null;
let reconnectTimer = null;

// Configuration
const API_BASE = 'http://localhost:9120';
const WS_BASE = 'ws://localhost:9120';
const HISTORY_LIMIT = 30;

const parseMessage = (content) => {
  if (!content) return [{ type: 'text', content: '' }];
  
  const segments = [];
  
  // Robust Regex Pattern
  // 1. Thinking/Monologue: 【Thinking: ...】 or 【Monologue: ...】
  // 2. NIT Tool: <nit>...</nit> or <nit-ID>...</nit-ID> or [[[NIT_CALL]]]...[[[NIT_END]]]
  // 3. DeepSeek Thinking: <think>...</think>
  
  const regex = /【(Thinking|Monologue)\s*:\s*([\s\S]*?)】|<(nit(?:-[a-zA-Z0-9-]+)?)>([\s\S]*?)<\/\3>|\[\[\[NIT_CALL\]\]\]([\s\S]*?)\[\[\[NIT_END\]\]\]|<think>([\s\S]*?)<\/think>/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        segments.push({ type: 'text', content: text });
      }
    }
    
    if (match[1]) { // Thinking or Monologue (Standard)
      segments.push({ 
        type: match[1].toLowerCase(), 
        content: match[2].trim() 
      });
    } else if (match[6]) { // DeepSeek <think>
      segments.push({ 
        type: 'thinking', 
        content: match[6].trim() 
      });
    } else if (match[3] || match[5]) { // NIT Tool (XML or Bracket)
       const nitTag = match[3];
       const code = match[4] || match[5]; // Group 4 for XML, Group 5 for Bracket
       
       // Extract ID from tag if present (e.g. nit-123 -> 123)
       let toolId = 'unknown';
       if (nitTag && nitTag.startsWith('nit-')) {
         toolId = nitTag.substring(4);
       }
       
       const trimmedCode = code.trim();
       
       let toolName = 'Script Execution';
       const funcMatch = /([a-zA-Z_][a-zA-Z0-9_]*)\./.exec(trimmedCode);
       if (funcMatch) {
         toolName = funcMatch[1];
       }
       
       segments.push({
         type: 'tool',
         name: toolName,
         id: toolId,
         content: trimmedCode
       });
    }
    
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text.trim()) {
      segments.push({ type: 'text', content: text });
    }
  }
  
  return segments.length > 0 ? segments : [{ type: 'text', content: content }];
};

// --- Collapse Logic ---
const collapsedStates = ref(new Set());

const toggleCollapse = (msgIdx, segIdx) => {
  const key = `${msgIdx}-${segIdx}`;
  if (collapsedStates.value.has(key)) {
    collapsedStates.value.delete(key);
  } else {
    collapsedStates.value.add(key);
  }
};

const isCollapsed = (msgIdx, segIdx) => {
  return collapsedStates.value.has(`${msgIdx}-${segIdx}`);
};

// --- Editing Logic ---
const editingMsgId = ref(null);
const editingContent = ref('');

const startEdit = (msg) => {
  editingMsgId.value = msg.id;
  editingContent.value = msg.content;
};

const cancelEdit = () => {
  editingMsgId.value = null;
  editingContent.value = '';
};

const saveEdit = async (msg) => {
  if (!editingContent.value.trim() || !msg.id) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/history/${msg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editingContent.value })
    });
    
    if (res.ok) {
      msg.content = editingContent.value;
      editingMsgId.value = null;
    }
  } catch (e) {
    console.error('Failed to edit message', e);
  }
};

const deleteMessage = async (msgId) => {
  if (!confirm('确定删除这条消息吗？')) return;
  try {
    const res = await fetch(`${API_BASE}/api/history/${msgId}`, { method: 'DELETE' });
    if (res.ok) {
      messages.value = messages.value.filter(m => m.id !== msgId);
    }
  } catch (e) {
    console.error('Failed to delete message', e);
  }
};

// --- WebSocket Logic for Real-time Thoughts ---
const connectWS = () => {
  if (ws) ws.close();
  ws = new WebSocket(`${WS_BASE}/ws/voice`);
  
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
      // Emit sync event for PetView
      if (!props.workMode) {
        emit('sync-chat-to-pet', { role: 'assistant', content: data.content });
      }
    }
  }
  else if (data.type === 'mode_update') {
    if (data.mode === 'work') {
      emitEvent('mode-change', data.is_active);
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
    steps: [],
    timestamp: new Date().toISOString()
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
      await fetch(`${API_BASE}/api/task/${sessionId}/pause`, { method: 'POST' });
    } else if (action === 'resume') {
       await fetch(`${API_BASE}/api/task/${sessionId}/resume`, { method: 'POST' });
    } else if (action === 'stop') {
       await fetch(`${API_BASE}/api/task/${sessionId}/inject`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ instruction: '停止任务' })
       });
    }
  } catch (e) {
    console.error('Task control failed', e);
  }
};

const formatTime = (ts) => {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  
  const isToday = date.getDate() === now.getDate() && 
                  date.getMonth() === now.getMonth() && 
                  date.getFullYear() === now.getFullYear();
                  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
};

const fetchHistory = async (append = false) => {
  // If in work mode, use 'ide' source.
  // If in chat mode (workMode false), use 'desktop' source to sync with PetView.
  const source = props.workMode ? 'ide' : 'desktop';
  const sessionId = props.workMode ? 'current_work_session' : 'default';
  
  try {
    // Fetch desc (Newest first)
    const res = await fetch(`${API_BASE}/api/history/${source}/${sessionId}?limit=${HISTORY_LIMIT}&offset=${offset.value}&sort=desc`);
    if (res.ok) {
      const logs = await res.json();
      if (logs.length < HISTORY_LIMIT) {
        hasMore.value = false;
      }
      
      const newMsgs = logs.map(log => ({
        id: log.id,
        role: log.role,
        content: log.raw_content || log.content, // Prioritize raw_content for NIT tool display
        timestamp: log.timestamp
      }));
      
      // Reverse to get [Oldest, ..., Newest] order for display
      newMsgs.reverse();

      if (append) {
        // Prepend older messages (history) to the top
        // Save scroll position
        if (msgContainer.value) {
            const oldHeight = msgContainer.value.scrollHeight;
            const oldTop = msgContainer.value.scrollTop;
            
            messages.value.unshift(...newMsgs);
            
            await nextTick();
            // Restore scroll position relative to the new content
            const newHeight = msgContainer.value.scrollHeight;
            msgContainer.value.scrollTop = newHeight - oldHeight + oldTop;
        } else {
            messages.value.unshift(...newMsgs);
        }
      } else {
        // Initial load
        messages.value = newMsgs;
        await nextTick();
        scrollToBottom();
      }
    } else {
       console.error("Fetch history failed with status:", res.status);
    }
  } catch (e) {
    console.error('Failed to fetch history', e);
  }
};

const loadMore = async () => {
  // Fix: If messages are empty (initial load failed), do NOT increment offset
  if (messages.value.length === 0) {
      offset.value = 0;
  } else {
      offset.value += HISTORY_LIMIT;
  }
  await fetchHistory(true);
};

let unlistenSync = null;
let unlistenDelete = null;

onMounted(async () => {
  connectWS();
  fetchHistory();

  // Setup Tauri Event Listeners for Chat Sync
  try {
    // Listen for log deletion
    unlistenDelete = await listen('log-deleted', (event) => {
      const deletedLogId = event.payload;
      if (deletedLogId) {
        messages.value = messages.value.filter(msg => msg.id !== deletedLogId);
      }
    });

    // 监听来自后端/PetView的同步消息
    unlistenSync = await listen('sync-chat-to-ide', (event) => {
      const { role, content, timestamp } = event.payload;
      
      // 避免重复添加
      // Since Newest is at Bottom (Index N)
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg && lastMsg.role === role && lastMsg.content === content) {
        return;
      }
      
      messages.value.push({ role, content, timestamp: timestamp || new Date().toISOString() });
      scrollToBottom();
    });
  } catch (e) {
    console.warn('Failed to setup Tauri listener:', e);
  }
});

watch(() => props.workMode, () => {
  offset.value = 0;
  hasMore.value = true;
  fetchHistory();
});

onUnmounted(() => {
  if (ws) ws.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (unlistenSync) unlistenSync();
  if (unlistenDelete) unlistenDelete();
});

// --- Chat Logic ---
const handleEnter = (e) => {
    if (e.shiftKey) return;
    sendMessage();
};

const sendMessage = async () => {
  if (!input.value.trim() || isSending.value) return;
  
  const content = input.value;
  messages.value.push({ role: 'user', content, timestamp: new Date().toISOString() });
  
  // Emit sync event for PetView if not in Work Mode
  if (!props.workMode) {
    emit('sync-chat-to-pet', { role: 'user', content, timestamp: new Date().toISOString() });
  }

  input.value = '';
  isSending.value = true;
  
  await nextTick();
  scrollToBottom();

  // Pre-add assistant message for immediate feedback
  const assistantMsg = { role: 'assistant', content: '', timestamp: new Date().toISOString() };
  messages.value.push(assistantMsg);
  await nextTick();
  scrollToBottom();

  try {
    const res = await fetch(`${API_BASE}/api/ide/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        // Filter out the empty assistant message we just added
        messages: messages.value.slice(0, -1).filter(m => m.role === 'user' || m.role === 'assistant').slice(-10), 
        source: props.workMode ? 'ide' : 'desktop',
        session_id: props.workMode ? 'current_work_session' : 'default'
      })
    });
    
    if (!res.body) throw new Error("No response body");
    
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
    assistantMsg.content = `Error: ${e.message}`;
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
@keyframes float {
  0%, 100% { transform: translateY(0px) scale(1); }
  50% { transform: translateY(-6px) scale(1.01); }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

/* Add random delays for natural feel */
.animate-float:nth-child(odd) {
  animation-delay: 0s;
}
.animate-float:nth-child(even) {
  animation-delay: 2s;
}
.animate-float:nth-child(3n) {
  animation-delay: 4s;
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.animate-fade-in-up {
  animation: fadeInUp 0.4s ease-out forwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>