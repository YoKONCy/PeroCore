<template>
  <div class="w-12 h-full bg-[#333333] flex flex-col items-center py-2 select-none z-20 border-r border-[#2b2b2b]">
    <!-- Explorer -->
    <div 
      class="w-12 h-12 flex items-center justify-center cursor-pointer transition-colors relative mb-1"
      :class="activeTab === 'explorer' ? 'text-white' : 'text-[#858585] hover:text-white'"
      @click="$emit('update:activeTab', 'explorer')"
      title="Explorer (Ctrl+Shift+E)"
    >
      <div v-if="activeTab === 'explorer'" class="absolute left-0 top-0 bottom-0 w-0.5 bg-white"></div>
      <FilesIcon class="w-6 h-6" />
    </div>

    <!-- Search -->
    <div 
      class="w-12 h-12 flex items-center justify-center cursor-pointer transition-colors relative mb-1"
      :class="activeTab === 'search' ? 'text-white' : 'text-[#858585] hover:text-white'"
      @click="$emit('update:activeTab', 'search')"
      title="Search (Ctrl+Shift+F)"
    >
      <div v-if="activeTab === 'search'" class="absolute left-0 top-0 bottom-0 w-0.5 bg-white"></div>
      <SearchIcon class="w-6 h-6" />
    </div>

    <div class="flex-1"></div>

    <!-- Settings -->
    <div 
      class="w-12 h-12 flex items-center justify-center cursor-pointer transition-colors text-[#858585] hover:text-white mb-1"
      title="Settings"
    >
      <SettingsIcon class="w-6 h-6" />
    </div>
  </div>
</template>

<script setup>
import { 
  Files as FilesIcon, 
  Search as SearchIcon,
  Settings as SettingsIcon
} from 'lucide-vue-next';

defineProps({
  activeTab: String
});

defineEmits(['update:activeTab']);
</script>