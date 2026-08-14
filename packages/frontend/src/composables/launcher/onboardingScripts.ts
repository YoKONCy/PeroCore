/**
 * Launcher 新手引导脚本。
 *
 * 用 Pero 的口吻介绍启动器的四个页面，文案与四个 Tab 及真实操作目标一一对应。
 */
import type { OnboardingStep } from '../../components/overlays/OnboardingOverlay.vue'

export const launcherSteps: OnboardingStep[] = [
  {
    speaker: 'Pero',
    eyebrow: 'WELCOME HOME',
    title: '欢迎回家，主人！',
    text: '这里是 infOS 的启动器喵~ 一会儿 Pero 带主人认识一下「伙伴选择」「电脑情况」「版本公告」三个小帮手，超快的，不用紧张啦 (◍•ᴗ•◍)',
    expression: 'normal',
    tab: 'launch',
  },
  {
    speaker: 'Pero',
    eyebrow: 'FOUR LITTLE DOORS',
    title: '四个小门，各管各的事',
    text: '顶上这排小门就是导航啦：选伙伴、看电脑、看公告、找帮助。想去哪就点哪，Pero 会在旁边跟着你喵~',
    expression: 'none',
    focusSelector: '#launcher-tabs',
  },
  {
    speaker: 'Pero',
    eyebrow: 'PICK YOUR PARTNER',
    title: '先挑一个今天的伙伴吧',
    text: '在这里点一下，就能换伙伴啦~ 选中的伙伴会同步到主界面和桌宠，下次打开也会乖乖记住，不会让你重新选哦！',
    expression: 'none',
    focusSelector: '#launcher-agent-stage',
  },
  {
    speaker: 'Pero',
    eyebrow: 'READY CHECK',
    title: '出发前，检查一下小行李',
    text: '这些是启动前要确认的：后台服务、数据库、模型、记忆和伙伴配置。有哪个不对劲，Pero 会提醒你，别担心~',
    expression: 'none',
    focusSelector: '#launcher-readiness',
  },
  {
    speaker: 'Pero',
    eyebrow: 'KNOW YOUR COMPUTER',
    title: '看看这台电脑的情况',
    text: '这一页会把电脑的系统、内存、客户端窗口都摊开给你看。万一以后出问题，这里就是 Pero 的「病历本」啦 (ᐡ •̥ω•̥ ᐡ)',
    expression: 'none',
    focusSelector: '#launcher-environment-content',
    tab: 'environment',
  },
  {
    speaker: 'Pero',
    eyebrow: 'WHAT IS NEW',
    title: '新版本带来了什么？',
    text: '这里是版本公告，会漂漂亮亮地显示 GitHub 上写好的更新内容。正式版可以点按钮升级，开发版只会告诉你安全的手动更新办法喵~',
    expression: 'none',
    focusSelector: '#launcher-release-notice',
    tab: 'updates',
  },
  {
    speaker: 'Pero',
    eyebrow: 'LET US GO',
    title: '都准备好啦，去召唤伙伴吧！',
    text: '回到启动页，点那个亮晶晶的「召唤伙伴」按钮，Pero 就会跑到桌面上陪你~ 也可以点「打开主界面」开始认真工作哦 ✧',
    expression: 'proud',
    focusSelector: '#launcher-primary-action',
    tab: 'launch',
  },
]

export const dashboardSteps: OnboardingStep[] = [
  {
    speaker: 'Pero',
    title: '欢迎来到控制中心',
    text: '左侧导航汇集了对话、工作区、记忆和系统设置。先从模型配置开始，就能为伙伴接入 AI 能力啦~',
    expression: 'normal',
  },
]
