<template>
  <div v-if="visible" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="handleOverlayClick">
    <div class="bg-[#252526] border border-[#454545] rounded-lg shadow-2xl w-[400px] overflow-hidden transform transition-all">
      <!-- Header -->
      <div class="px-4 py-3 border-b border-[#333333] flex justify-between items-center bg-[#2d2d2d]">
        <h3 class="text-sm font-semibold text-[#cccccc] select-none">{{ title }}</h3>
        <button @click="handleCancel" class="text-[#888888] hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <!-- Body -->
      <div class="p-4">
        <p v-if="message" class="text-sm text-[#cccccc] mb-4 whitespace-pre-wrap">{{ message }}</p>
        
        <div v-if="type === 'prompt'">
          <input 
            ref="inputRef"
            v-model="inputValue"
            @keyup.enter="handleConfirm"
            class="w-full bg-[#3c3c3c] border border-[#3c3c3c] focus:border-[#007fd4] text-white text-sm px-3 py-2 rounded outline-none placeholder-gray-500"
            :placeholder="placeholder"
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="px-4 py-3 bg-[#2d2d2d] flex justify-end gap-2">
        <button 
          v-if="type !== 'alert'"
          @click="handleCancel"
          class="px-4 py-1.5 text-sm text-white bg-[#454545] hover:bg-[#525252] rounded transition-colors"
        >
          取消
        </button>
        <button 
          @click="handleConfirm"
          class="px-4 py-1.5 text-sm text-white bg-[#007fd4] hover:bg-[#0069b4] rounded transition-colors"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  visible: Boolean,
  type: {
    type: String,
    default: 'alert', // alert, confirm, prompt
    validator: (value) => ['alert', 'confirm', 'prompt'].includes(value)
  },
  title: {
    type: String,
    default: '提示'
  },
  message: {
    type: String,
    default: ''
  },
  defaultValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:visible', 'confirm', 'cancel']);

const inputValue = ref('');
const inputRef = ref(null);

watch(() => props.visible, async (newVal) => {
  if (newVal) {
    inputValue.value = props.defaultValue;
    if (props.type === 'prompt') {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  }
});

const handleConfirm = () => {
  if (props.type === 'prompt') {
    emit('confirm', inputValue.value);
  } else {
    emit('confirm');
  }
  emit('update:visible', false);
};

const handleCancel = () => {
  emit('cancel');
  emit('update:visible', false);
};

const handleOverlayClick = () => {
  if (props.type !== 'alert') {
    handleCancel();
  }
};
</script>
