<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  refresh: 'M20 7a9 9 0 0 0-15-3L2 7m0-5v5h5M4 17a9 9 0 0 0 15 3l3-3m0 5v-5h-5',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  chevronDown: 'm6 9 6 6 6-6',
  connection:
    'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4l-1-1a1 1 0 0 1 1-2h3a4 4 0 0 0 4-4c0-4-4-7-9-7ZM7 9h.01M11 6h.01M16 7h.01M5 13h.01',
  sliders: 'M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  file: 'M14 2H5v20h14V7Zm0 0v5h5M8 12h8M8 16h6',
  folder: 'M3 7V4h6l2 3h10v13H3Z',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  outline: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-2 3 1 3-3 3-3-1-2 3-3-2-3 1-3-3 1-3-2-3 3-3 3 1Z',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 4v16M4 12h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  stop: 'M8 3h8l5 5v8l-5 5H8l-5-5V8ZM9 9h6v6H9Z',
  star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  archive: 'M3 4h18v4H3ZM5 8v13h14V8M9 12h6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  comment: 'M21 3H3v15h5l4 4 4-4h5ZM7 8h10M7 12h7',
  sparkle: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
  check: 'm5 12 4 4L19 6',
  panel: 'M3 4h18v16H3ZM15 4v16',
  chevron: 'm9 5 7 7-7 7',
  back: 'm12 5-7 7 7 7M5 12h15',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  undo: 'M9 4 3 10l6 6M3 10h11a7 7 0 0 1 7 7v3',
  redo: 'm15 4 6 6-6 6M21 10H10a7 7 0 0 0-7 7v3',
  power: 'M12 2v10M5.6 5.6a9 9 0 1 0 12.8 0',
  image: 'M3 3h18v18H3Zm0 14 6-6 4 4 3-3 5 5M15 7h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4Z',
  arrow: 'M7 17 17 7M7 7h10v10',
  alignLeft: 'M4 4h16M4 9h10M4 14h16M4 19h10',
  alignCenter: 'M4 4h16M7 9h10M4 14h16M7 19h10',
  alignRight: 'M4 4h16M10 9h10M4 14h16M10 19h10',
  compare: 'M8 3v18M16 3v18M3 8l5-5 5 5M11 16l5 5 5-5',
}
</script>

<template>
  <svg
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.file" />
  </svg>
</template>
