import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Perofamily Wiki",
  description: "Documentation for PeroCore - The AI Desktop Companion",
  head: [['link', { rel: 'icon', href: '/logo.png' }]],
  appearance: true, // Enable dark mode toggle
  themeConfig: {
    logo: '/logo.png',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/intro' }
    ],

    sidebar: [
      {
        text: '📘 指南',
        items: [
          { text: '项目简介', link: '/guide/intro' },
          { text: '快速上手', link: '/guide/usage' }
        ]
      },
      {
        text: '🧠 核心系统',
        items: [
          { text: '记忆系统', link: '/core-systems/memory' },
          { text: '扩散激活算法', link: '/core-systems/spreading-activation' },
          { text: '社交模式', link: '/core-systems/social' },
          { text: 'MDP 系统', link: '/core-systems/mdp' },
          { text: 'NIT 协议', link: '/core-systems/nit' }
        ]
      },
      {
        text: '⚙️ 外围系统',
        items: [
          { text: 'Bedrock 3D 引擎', link: '/peripheral-systems/bedrock' },
          { text: '角色管理', link: '/peripheral-systems/character' }
        ]
      },
      {
        text: '🌐 生态扩展',
        items: [
          { text: '浏览器插件', link: '/ecosystem/extension' },
          { text: '移动端 App', link: '/ecosystem/mobile' },
          { text: '创意工坊', link: '/ecosystem/workshop' }
        ]
      },
      {
        text: '🚀 部署运维',
        items: [
          { text: 'Docker 部署', link: '/deployment/docker' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/YoKONCy/PeroCore' }
    ]
  }
})
