
<template>
  <vue-monaco-editor
    v-model:value="code"
    :language="language"
    theme="vs-dark"
    :options="editorOptions"
    class="h-full w-full"
    @mount="handleMount"
  />
</template>

<script setup>
import { ref, watch, shallowRef } from 'vue';
import { VueMonacoEditor } from '@guolao/vue-monaco-editor';

const props = defineProps({
  initialContent: String,
  language: String,
  filePath: String
});

const emit = defineEmits(['save']);

const code = ref(props.initialContent || '');
const editorRef = shallowRef();

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: true },
  fontSize: 14,
  fontFamily: "'Consolas', 'Monaco', monospace",
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  smoothScrolling: true,
  cursorBlinking: "smooth"
};

watch(() => props.initialContent, (newVal) => {
    // Only update if content is significantly different to avoid cursor jumps
    // In a real app we'd use a more robust model tracking
    if (newVal !== code.value) {
        code.value = newVal || '';
    }
});

const handleMount = (editor, monaco) => {
  editorRef.value = editor;
  
  // Add Save Command (Ctrl+S)
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save', code.value);
  });
};
</script>
