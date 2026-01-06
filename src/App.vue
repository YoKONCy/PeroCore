<template>
  <router-view />
</template>

<script setup>
</script>

<style>
body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: transparent; /* Changed to transparent for Tauri window transparency */
}

#app {
  width: 100%;
  height: 100%;
}
</style>
