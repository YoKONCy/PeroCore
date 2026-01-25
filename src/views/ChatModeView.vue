<template>
  <!-- Global colored background layer -->
  <div class="absolute inset-0 bg-gradient-to-br from-sky-200/20 via-sky-100/10 to-transparent pointer-events-none z-0"></div>
  
  <div class="h-full w-full flex overflow-hidden backdrop-blur-xl relative z-10">
    <!-- Sidebar -->
    <div class="w-64 flex flex-col border-r border-white/40 bg-white/40 backdrop-blur-md pt-8">
      <!-- Search -->
      <div class="px-4 pb-4 pt-2">
        <div class="relative">
          <input 
            type="text" 
            placeholder="搜索助手或群..." 
            class="w-full bg-black/5 text-slate-700 text-xs rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:bg-white/50 transition-colors placeholder-slate-500/50"
          >
          <Search class="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500/50" />
        </div>
      </div>

      <!-- Agent List -->
      <div class="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1">
        <div class="flex items-center justify-between px-2 py-1.5">
            <div class="text-[10px] font-bold text-slate-500/70 uppercase tracking-widest">Agents</div>
            <button @click="loadAgents" class="text-slate-400 hover:text-sky-500 transition-colors" title="刷新">
                <div class="w-3 h-3 border-2 border-current border-t-transparent rounded-full" :class="{ 'animate-spin': isLoading }"></div>
            </button>
        </div>
        
        <div v-if="errorMsg" class="px-2 py-2 text-xs text-red-500 bg-red-50 rounded">
            {{ errorMsg }}
        </div>

        <div v-if="agents.length === 0 && !isLoading && !errorMsg" class="px-2 py-4 text-center text-xs text-slate-400">
            暂无助手 (No Agents)
        </div>

        <div 
            v-for="agent in agents" 
            :key="agent.id"
            @click="switchAgent(agent)"
            class="flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors group"
            :class="activeMode === 'direct' && activeAgentId === agent.id ? 'bg-sky-500/10 border border-sky-500/20' : 'hover:bg-white/30'"
        >
          <div class="relative">
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md"
                :class="activeMode === 'direct' && activeAgentId === agent.id ? 'bg-gradient-to-br from-sky-400 to-blue-500' : 'bg-slate-400'"
            >
                {{ agent.name ? agent.name[0].toUpperCase() : '?' }}
            </div>
            <div v-if="activeMode === 'direct' && activeAgentId === agent.id" class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-slate-800 truncate">{{ agent.name }}</span>
            </div>
            <div class="text-xs truncate" :class="activeMode === 'direct' && activeAgentId === agent.id ? 'text-sky-600' : 'text-slate-400'">
                {{ activeMode === 'direct' && activeAgentId === agent.id ? 'Active' : 'Standby' }}
            </div>
          </div>
        </div>

        <div class="px-2 py-1.5 text-[10px] font-bold text-slate-500/70 uppercase tracking-widest mt-4">Groups</div>
        
        <div 
            v-for="group in groups" 
            :key="group.id"
            @click="switchGroup(group)"
            class="flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors group"
            :class="activeMode === 'group' && activeGroupId === group.id ? 'bg-purple-500/10 border border-purple-500/20' : 'hover:bg-white/30'"
        >
          <div class="relative">
             <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md"
                :class="activeMode === 'group' && activeGroupId === group.id ? 'bg-gradient-to-br from-purple-400 to-indigo-500' : 'bg-slate-400'"
             >
                <Users class="w-5 h-5" />
             </div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-slate-800 truncate">{{ group.name }}</span>
            </div>
            <div class="text-xs truncate" :class="activeMode === 'group' && activeGroupId === group.id ? 'text-purple-600' : 'text-slate-400'">
                 {{ group.description || 'Group Chat' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div class="p-4 border-t border-white/20 flex gap-2">
        <button 
            @click="showCreateGroup = true"
            class="flex-1 py-2 rounded-lg bg-sky-500/10 text-sky-600 text-xs font-bold hover:bg-sky-500/20 transition-colors flex items-center justify-center gap-2"
        >
            <Plus class="w-4 h-4" />
            创建群聊
        </button>
      </div>
    </div>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col relative z-10 pt-8">
      <!-- Header -->
      <header class="h-14 px-6 flex items-center justify-between border-b border-white/20 bg-white/20 backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <span class="text-lg font-bold text-slate-800">
             {{ activeMode === 'direct' ? `与 ${activeAgentName} 聊天中` : activeGroupName }}
          </span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
            :class="activeMode === 'direct' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-purple-500/10 text-purple-600 border-purple-500/20'"
          >
             {{ activeMode === 'direct' ? 'ONLINE' : 'GROUP' }}
          </span>
        </div>
        <div class="flex items-center gap-4 text-slate-500">
           <button class="hover:text-sky-600 transition-colors"><Bell class="w-4 h-4" /></button>
           <button class="hover:text-sky-600 transition-colors"><Settings class="w-4 h-4" /></button>
        </div>
      </header>

      <!-- Chat Component -->
      <!-- Force remount when target changes using key -->
      <ChatInterface 
        v-if="activeMode === 'direct' && activeAgentId || activeMode === 'group' && activeGroupId"
        :work-mode="false" 
        class="flex-1" 
        :mode="activeMode"
        :target-id="activeMode === 'direct' ? activeAgentId : activeGroupId" 
        :agent-name="activeMode === 'direct' ? activeAgentName : activeGroupName"
        :key="activeMode + '-' + (activeMode === 'direct' ? activeAgentId : activeGroupId)"
      />
      <div v-else class="flex-1 flex items-center justify-center text-slate-400">
          <div class="text-center">
              <p>请选择一个助手或群聊开始</p>
          </div>
      </div>
    </div>
  </div>
  
  <!-- Simple Create Group Modal -->
  <div v-if="showCreateGroup" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div class="bg-white text-slate-900 rounded-2xl shadow-2xl w-96 p-6">
          <h3 class="text-lg font-bold mb-4 text-slate-900">创建群聊</h3>
          <input v-model="newGroupName" placeholder="群聊名称" class="w-full mb-4 p-2 border rounded-lg bg-slate-50 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
          
          <div class="mb-4 max-h-48 overflow-y-auto custom-scrollbar border rounded-lg p-2">
              <label class="block text-xs font-bold text-slate-500 mb-2">选择成员</label>
              <div v-for="agent in agents" :key="agent.id" class="flex items-center gap-2 mb-2 hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" :value="agent.id" v-model="newGroupMembers" class="rounded text-sky-500 focus:ring-sky-500" />
                  <span class="text-sm text-slate-700">{{ agent.name }}</span>
              </div>
          </div>
          
          <div class="flex justify-end gap-2">
              <button @click="showCreateGroup = false" class="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm font-medium">取消</button>
              <button @click="createGroup" class="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 text-sm font-bold shadow-lg shadow-sky-500/20">创建</button>
          </div>
      </div>
  </div>

</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { Search, User, Bell, Settings, Plus, Users } from 'lucide-vue-next';
import ChatInterface from '../components/chat/ChatInterface.vue';

const API_BASE = 'http://127.0.0.1:9120'; // Use IP to avoid localhost resolution issues

// State
const agents = ref([]);
const groups = ref([]);
const isLoading = ref(false);
const errorMsg = ref('');
const activeMode = ref('direct'); // 'direct' | 'group'
const activeAgentId = ref(null);
const activeAgentName = ref('Pero');
const activeGroupId = ref(null);
const activeGroupName = ref('');

// Create Group State
const showCreateGroup = ref(false);
const newGroupName = ref('');
const newGroupMembers = ref([]);

// Fetch Data
const loadAgents = async () => {
    isLoading.value = true;
    errorMsg.value = '';
    try {
        // Fetch ALL agents with status
        const resAll = await fetch(`${API_BASE}/api/agents`);
        if (!resAll.ok) throw new Error(`HTTP ${resAll.status}`);
        
        const allAgents = await resAll.json();
        
        // Filter enabled agents directly from the response
        agents.value = allAgents.filter(a => a.is_enabled);
        
        // Fetch Active Agent (Double check with backend or just use local flag)
        const active = allAgents.find(a => a.is_active);
        if (active) {
            activeAgentId.value = active.id;
            activeAgentName.value = active.name;
        } else if (agents.value.length > 0) {
            // Fallback
            activeAgentId.value = agents.value[0].id;
            activeAgentName.value = agents.value[0].name;
        }
    } catch (e) {
        console.error("Failed to load agents", e);
        errorMsg.value = `加载失败: ${e.message}`;
    } finally {
        isLoading.value = false;
    }
};

const loadGroups = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/groupchat/rooms`);
        if (res.ok) {
            groups.value = await res.json();
        }
    } catch (e) {
        console.error("Failed to load groups", e);
    }
};

// Actions
const switchAgent = async (agent) => {
    activeMode.value = 'direct';
    activeAgentId.value = agent.id;
    activeAgentName.value = agent.name;
    
    // Call API to switch active agent in backend
    try {
        await fetch(`${API_BASE}/api/agents/active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agent.id })
        });
    } catch (e) {
        console.error("Failed to switch agent", e);
    }
};

const switchGroup = (group) => {
    activeMode.value = 'group';
    activeGroupId.value = group.id;
    activeGroupName.value = group.name;
};

const toggleMember = (agentId) => {
    const idx = newGroupMembers.value.indexOf(agentId);
    if (idx === -1) {
        newGroupMembers.value.push(agentId);
    } else {
        newGroupMembers.value.splice(idx, 1);
    }
};

const createGroup = async () => {
    if (!newGroupName.value.trim() || newGroupMembers.value.length === 0) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/groupchat/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: newGroupName.value,
                creator_id: 'user', // 用户创建
                member_ids: newGroupMembers.value,
                description: '用户创建的群组'
            })
        });
        
        if (res.ok) {
            await loadGroups();
            showCreateGroup.value = false;
            newGroupName.value = '';
            newGroupMembers.value = [];
        }
    } catch (e) {
        console.error("Failed to create group", e);
    }
};

onMounted(() => {
    loadAgents();
    loadGroups();
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
  background: rgba(0, 0, 0, 0.1);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}
</style>
