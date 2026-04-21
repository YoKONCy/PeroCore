/**
 * VitePress 站点配置
 *
 * PeroCore Wiki 萌动像素风文档站
 *
 * @see https://vitepress.dev/reference/site-config
 * @module packages/wiki/.vitepress/config
 */

import { defineConfig } from 'vitepress'
import mathjax3 from 'markdown-it-mathjax3'
import fs from 'fs'
import path from 'path'
export default defineConfig({
  title: 'Perofamily Wiki',
  description: 'Documentation for PeroCore - The AI Desktop Companion',
  // base: '/PeroCore/', // Deploy to GitHub Pages: https://YoKONCy.github.io/PeroCore/
  head: [
    ['link', { rel: 'icon', href: '/Logo.png' }],
    // 引入更柔和的像素字体与平滑回退字体
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Ma+Shan+Zheng&display=swap'
      }
    ]
  ],
  appearance: false, // 禁用深色模式切换，统一使用全天候萌动色 🌸
  markdown: {
    config: (md) => {
      // MathJax 数学公式渲染
      md.use(mathjax3)
    },
    languages: [
      // NIT 协议语法高亮
      {
        ...JSON.parse(
          fs.readFileSync(path.resolve(__dirname, './grammars/nit.tmLanguage.json'), 'utf-8')
        )
      }
    ]
  },
  themeConfig: {
    logo: '/Logo.png',
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
          { text: 'MDP 系统', link: '/core-systems/mdp' },
          { text: 'NIT 协议', link: '/core-systems/nit' }
        ]
      },
      {
        text: '⚙️ 外围系统',
        items: [
          { text: 'Bedrock 3D 引擎', link: '/peripheral-systems/bedrock' },
          { text: '控制面板', link: '/peripheral-systems/dashboard' },
          { text: '角色管理', link: '/peripheral-systems/character' }
        ]
      },
      {
        text: '🌐 生态扩展',
        items: [
          { text: 'MOD组件', link: '/ecosystem/mod' },
          { text: '社交模式', link: '/ecosystem/social' },
          { text: '浏览器插件', link: '/ecosystem/extension' },
          { text: '移动端 App', link: '/ecosystem/mobile' },
          { text: '创意工坊', link: '/ecosystem/workshop' }
        ]
      },
      {
        text: '🚀 部署运维',
        items: [{ text: 'Docker 部署', link: '/deployment/docker' }]
      }
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/YoKONCy/PeroCore' }]
  }
})
