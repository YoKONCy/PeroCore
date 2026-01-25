
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

const emit = defineEmits(['save', 'change']);

const code = ref(props.initialContent || '');
const editorRef = shallowRef();

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: true, renderCharacters: false },
  fontSize: 15,
  fontFamily: "'Comic Shanns', 'Comic Sans MS', 'Cascadia Code', 'Fira Code', monospace",
  fontWeight: "600",
  lineHeight: 24,
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  roundedSelection: true,
  renderLineHighlight: "all",
  fontLigatures: true,
};

watch(() => props.initialContent, (newVal) => {
    if (newVal !== code.value) {
        code.value = newVal || '';
    }
});

const handleMount = (editor, monaco) => {
  editorRef.value = editor;
  
  // 监听内容变更
  editor.onDidChangeModelContent(() => {
    emit('change', code.value);
  });
  
  // 绑定保存快捷键 (Ctrl+S)
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save', code.value);
  });
};
</script>
