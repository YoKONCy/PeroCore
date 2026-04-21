---
layout: home

hero:
  name: '萌动链接'
  text: 'PEROPEROCHAT'
  tagline: '官方Wiki文档'
  image:
    src: /hero.png
    alt: PeroCore
  actions:
    - theme: brand
      text: '快速开始'
      link: /guide/usage
    - theme: alt
      text: '了解更多'
      link: https://github.com/YoKONCy/PeroCore

features:
  - title: ⚡ Electron + Python
    details: 高度模块化的现代架构
    icon: ⚡
  - title: 🧠 仿生记忆引擎
    details: 赋予永恒记忆
    icon: 🧠
  - title: 👁️ 视觉意图
    details: “所见即所思，所思即所得”
    icon: 👁️
  - title: 🛠️ NIT 协议
    details: 非侵入式工具链集成
    icon: 🛠️
---

<style>
/* 🌸 首页萌动特效增强 🌸 */
:deep(.VPHero) {
  padding-top: 80px;
  padding-bottom: 80px;
}

:deep(.VPHero .name) {
  letter-spacing: -4px;
}

:deep(.VPHero .text) {
  font-family: 'ZCOOL KuaiLe', sans-serif;
  letter-spacing: 2px;
  color: var(--moe-cocoa-brown) !important;
  opacity: 0.8;
}

:deep(.VPFeature) {
  padding: 32px !important;
}

:deep(.VPFeature .title) {
  font-weight: 900 !important;
  color: var(--moe-cocoa-brown) !important;
}

/* 隐藏深色模式相关的残留样式 */
:deep(.VPNav), :deep(.VPSidebar) {
  transition: none !important;
}
</style>
