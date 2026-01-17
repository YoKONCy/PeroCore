<template>
  <!-- Global colored background layer to force tint over Windows Acrylic -->
  <div class="absolute inset-0 bg-gradient-to-br from-sky-200/20 via-sky-100/10 to-transparent pointer-events-none z-0"></div>
  
  <div class="h-full w-full flex overflow-hidden backdrop-blur-xl relative z-10">
    <!-- Sidebar (VCPChat Style) -->
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
        <div class="px-2 py-1.5 text-[10px] font-bold text-slate-500/70 uppercase tracking-widest">Agents</div>
        
        <!-- Active Agent (Pero) -->
        <div class="flex items-center gap-3 p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 cursor-pointer">
          <div class="relative">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 shadow-md flex items-center justify-center text-white font-bold text-sm">P</div>
            <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-slate-800 truncate">Pero</span>
              <span class="text-[10px] text-slate-400">刚刚</span>
            </div>
            <div class="text-xs text-sky-600 truncate">主人，我在听呢~</div>
          </div>
        </div>

        <!-- Placeholder Agents -->
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 p-2 rounded-xl hover:bg-white/30 cursor-pointer transition-colors group">
          <div class="w-10 h-10 rounded-full bg-slate-200/50 flex items-center justify-center text-slate-400 group-hover:bg-slate-200 transition-colors">
            <User class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0 opacity-60 group-hover:opacity-100 transition-opacity">
            <div class="text-sm font-medium text-slate-700">未连接助手 {{ i }}</div>
            <div class="text-xs text-slate-400 truncate">离线</div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div class="p-4 border-t border-white/20 flex gap-2">
        <button class="flex-1 py-2 rounded-lg bg-sky-500/10 text-sky-600 text-xs font-bold hover:bg-sky-500/20 transition-colors">创建 Agent</button>
      </div>
    </div>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col relative z-10 pt-8">
      <!-- Header (Mock VCPChat) -->
      <header class="h-14 px-6 flex items-center justify-between border-b border-white/20 bg-white/20 backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <span class="text-lg font-bold text-slate-800">与 Pero 聊天中</span>
          <span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-bold border border-emerald-500/20">ONLINE</span>
        </div>
        <div class="flex items-center gap-4 text-slate-500">
           <button class="hover:text-sky-600 transition-colors"><Bell class="w-4 h-4" /></button>
           <button class="hover:text-sky-600 transition-colors"><Settings class="w-4 h-4" /></button>
        </div>
      </header>

      <!-- Chat Component -->
      <IdeChat :work-mode="false" class="flex-1" />
    </div>
  </div>
</template>

<script setup>
import { Search, User, Bell, Settings } from 'lucide-vue-next';
import IdeChat from '../components/ide/IdeChat.vue';
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