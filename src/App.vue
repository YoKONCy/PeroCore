<template>
  <router-view />
</template>

<script setup>
</script>

<style>
*,
*::before,
*::after {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}

body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: transparent !important;
  border: none !important;
  outline: none !important;
}

#app {
  width: 100%;
  height: 100%;
  background: transparent !important;
  border: none !important;
  outline: none !important;
}
</style>
