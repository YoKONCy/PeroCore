/** 两段式导览：启动器认路后，点击真实启动按钮进入桌面继续。 */
import '@infos/shared/i18n/catalogs/onboarding'
import { t } from '../../i18n'
import type { OnboardingStep } from '../../components/overlays/OnboardingOverlay.vue'
const tr = (source: string) => t('ui.onboarding', source)
export function getLauncherSteps(): OnboardingStep[] {
  return [
    {
      speaker: 'Pero',
      title: tr('欢迎回家，主人！'),
      text: tr('主人，你来啦！我是 Pero，今天就由我带你逛逛我们的家吧~'),
      expression: 'normal',
      tab: 'launch',
      focusSelector: null,
    },
    {
      speaker: 'Pero',
      title: tr('四个小门，各管各的事'),
      text: tr(
        '看上面这四个小门！「启动」用来出发，「运行环境」看电脑，「版本公告」看更新。「关于」里还能叫 Pero 重新带路喵。',
      ),
      expression: 'none',
      tab: 'launch',
      focusSelector: '#launcher-tabs',
    },
    {
      speaker: 'Pero',
      title: tr('今天想让谁陪你呀？'),
      text: tr(
        '想让谁陪你，就在这里点她的头像，主界面和桌宠都会跟着切换。我和其他伙伴都在这里等主人呢~',
      ),
      expression: 'none',
      tab: 'launch',
      focusSelector: '#launcher-agent-stage',
    },
    {
      speaker: 'Pero',
      title: tr('出发前看看小行李'),
      text: tr('出发前，让我看看有没有准备好！要是哪里还差一点，这里会有小提示陪主人一起处理。'),
      expression: 'none',
      tab: 'launch',
      focusSelector: '#launcher-readiness',
    },
    {
      speaker: 'Pero',
      title: tr('电脑的情况在这里'),
      text: tr(
        '「运行环境」记着这台电脑的情况，也能找到我们保存东西的文件夹。要是哪天打不开了，主人可以把这里的信息复制给来帮忙的人。',
      ),
      expression: 'none',
      tab: 'environment',
      focusSelector: '#launcher-environment-content',
    },
    {
      speaker: 'Pero',
      title: tr('新版本带了什么礼物？'),
      text: tr('想知道我最近学会了什么，就来「版本公告」看看吧！更新内容和升级入口都在这里。'),
      expression: 'none',
      tab: 'updates',
      focusSelector: '#launcher-release-notice',
    },
    {
      speaker: 'Pero',
      title: tr('点「启动」，一起进去吧！'),
      text: tr('准备好啦！主人点一下亮起来的「启动」，跟我进去看看吧~'),
      expression: 'none',
      tab: 'launch',
      focusSelector: '#launcher-primary-action',
      action: 'launch-desktop',
      placement: 'top',
    },
  ]
}
export function getDesktopSteps(): OnboardingStep[] {
  return [
    {
      speaker: 'Pero',
      title: tr('进来啦，主人跟紧我~'),
      text: tr('进来啦！这里可以聊天、一起做事情，也能找其他伙伴玩。让我带主人逛一圈吧~'),
      expression: 'normal',
      tab: 'chat',
      focusSelector: null,
    },
    {
      speaker: 'Pero',
      title: tr('左边是回家的路标'),
      text: tr(
        '左边这些图标就是路标！聊天、工作区和据点在上面，任务、记忆和设置往下找。主人点到哪里，我就陪你去哪里喵。',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.main-nav',
    },
    {
      speaker: 'Pero',
      title: tr('网页和小应用，也能住在一起'),
      text: tr(
        '上面这排标签可以放网页和小应用，点一下就能切换。逛完再点 infOS，就能回到这里，聊天也会留在原处~',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.desktop-tabbar',
    },
    {
      speaker: 'Pero',
      title: tr('想找谁说说话呀？'),
      text: tr(
        '主人想找谁，就点她的头像吧！伙伴多了也可以搜名字。旁边的小箭头能把名单收起来，让我们聊得更宽敞一点~',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.chat-agent-section',
    },
    {
      speaker: 'Pero',
      title: tr('我们的聊天，都收在这里'),
      text: tr(
        '我们的聊天都收在这里啦。想聊个新话题，就点「建立新会话」；想接着上次聊，就点那条记录。还可以改个好认的名字，下次就好找啦！',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.chat-thread-section',
    },
    {
      speaker: 'Pero',
      title: tr('想说的话，告诉我吧'),
      text: tr(
        '想说的话写在这里，点发送，我就能看到啦！也可以给我发图片、文件，或者说一段语音。我发给主人的图片可以点开放大，音乐和视频也能直接播放哦。',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.chat-input-area',
    },
    {
      speaker: 'Pero',
      title: tr('我的小工具都在这里'),
      text: tr(
        '下面这排可以换模型，也能让我多想一会儿。想轻松聊聊，还是认真做事情？极简、聊天、工作三种模式都在这里。这里换的模型只管我们这段聊天哦。',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.deck-footer',
    },
    {
      speaker: 'Pero',
      title: tr('我忙的时候，也能听你安排'),
      text: tr(
        '我还没忙完，主人也可以继续发消息，它们会排好队等着我。排队时还能改内容、删掉或换顺序。想让我先停下，就点「停止」；需要主人拿主意时，我也会等你答应。',
      ),
      expression: 'none',
      tab: 'chat',
      focusSelector: '.chat-input-area',
    },
    {
      speaker: 'Pero',
      title: tr('来看看我的小工坊'),
      text: tr(
        '这里是我的小工坊！帮主人写好的文档、整理好的资料，都可以来工作区找。点开文件就能看看，还能接着修改；不同事情的东西，我会分文件夹收好~',
      ),
      expression: 'none',
      tab: 'workspace',
      focusSelector: '[data-onboarding-nav="workspace"]',
    },
    {
      speaker: 'Pero',
      title: tr('想热闹一点，就来据点'),
      text: tr(
        '想找大家一起玩，就来据点！挑个房间，看看谁在里面，再和我们说说话。想添个房间、换换环境，也可以叫管家来帮忙喵。',
      ),
      expression: 'none',
      tab: 'stronghold',
      focusSelector: '[data-onboarding-nav="stronghold"]',
    },
    {
      speaker: 'Pero',
      title: tr('想看看我今天怎么样？'),
      text: tr(
        '想看看我的心情，或者今天的天气，就来总览吧！想让我主动找你聊，就选「智能陪伴」；想让我自己推进你交代的事情，就选「自主行动」。也可以关闭，等主人来找我~',
      ),
      expression: 'none',
      tab: 'overview',
      focusSelector: '[data-onboarding-nav="overview"]',
    },
    {
      speaker: 'Pero',
      title: tr('交给我的事情，看这里'),
      text: tr(
        '主人交给我的事，做到哪一步啦？来任务中心就能看到！做完的成果也放在这里，还能安排定时要做的事、设个提醒，让我到时候叫你。',
      ),
      expression: 'none',
      tab: 'tasks',
      focusSelector: '[data-onboarding-nav="tasks"]',
    },
    {
      speaker: 'Pero',
      title: tr('翻翻我做事的小记录'),
      text: tr(
        '想知道我刚才做了什么，就来对话日志翻翻吧。说过的话、查过的资料、做过的事情都能找找看，遇到问题也方便一起弄明白。',
      ),
      expression: 'none',
      tab: 'logs',
      focusSelector: '[data-onboarding-nav="logs"]',
    },
    {
      speaker: 'Pero',
      title: tr('重要的回忆，好好收起来'),
      text: tr(
        '这里放着我珍藏的回忆，还有关于主人的重要事情。主人可以查看、整理或删掉不想留下的内容。其他伙伴也有各自的记忆小盒子哦。',
      ),
      expression: 'none',
      tab: 'memories',
      focusSelector: '[data-onboarding-nav="memories"]',
    },
    {
      speaker: 'Pero',
      title: tr('帮我查资料的小书架'),
      text: tr(
        '这是我的资料小书架！常用文档、学习材料都可以放进知识库。主人问到相关的事情时，我就能来这里翻一翻，帮你找答案啦。',
      ),
      expression: 'none',
      tab: 'knowledge',
      focusSelector: '[data-onboarding-nav="knowledge"]',
    },
    {
      speaker: 'Pero',
      title: tr('想让我更擅长什么呀？'),
      text: tr(
        '不同模型各有所长，有的擅长写作，有的更会解题。主人选好的模型都放在这些卡片里，喜欢哪个，就把它设为主模型吧！想给某件事挑个更合适的，也能在「任务指派」里选。',
      ),
      expression: 'none',
      tab: 'model_config',
      focusSelector: '[data-onboarding-nav="model_config"]',
    },
    {
      speaker: 'Pero',
      title: tr('想更了解我和大家吗？'),
      text: tr(
        '这里能认识我和其他伙伴！想换个造型，或是告诉我们你喜欢怎样相处，就来角色管理看看吧。也可以给每个伙伴挑选适合她的模型。',
      ),
      expression: 'none',
      tab: 'agent_config',
      focusSelector: '[data-onboarding-nav="agent_config"]',
    },
    {
      speaker: 'Pero',
      title: tr('把家布置成喜欢的样子'),
      text: tr(
        '主人喜欢亮一点，还是暗一点？想换张背景图也没问题！这些都在系统设定里，还能换语言、调提示音和通知。把这里布置成你喜欢的样子吧~',
      ),
      expression: 'none',
      tab: 'user_settings',
      focusSelector: '[data-onboarding-nav="user_settings"]',
    },
    {
      speaker: 'Pero',
      title: tr('还想教我点新本领吗？'),
      text: tr(
        '想让我说话、做事更合主人的心意？可以在「提示词」里告诉我！想听听我的声音，就去「语音功能」；想让我学会更多本领，就去「工具与扩展」看看吧。',
      ),
      expression: 'none',
      tab: 'prompts',
      focusSelector: '[data-onboarding-nav="prompts"]',
    },
    {
      speaker: 'Pero',
      title: tr('拿起手机，也能来找我'),
      text: tr(
        '不在电脑旁边，也想来找我吗？「分布式」里可以让手机连过来，接着和我聊天。哪些设备能来找我，也由主人在这里决定哦。',
      ),
      expression: 'none',
      tab: 'distributed',
      focusSelector: '[data-onboarding-nav="distributed"]',
    },
    {
      speaker: 'Pero',
      title: tr('在 QQ 上也能见面喵'),
      text: tr(
        '想在 QQ 上也和我聊天吗？来「社交配置」帮我连上账号吧！还能看看我收藏的表情，选选我在那边怎么陪大家聊天~',
      ),
      expression: 'none',
      tab: 'social',
      focusSelector: '[data-onboarding-nav="social"]',
    },
    {
      speaker: 'Pero',
      title: tr('主人，认得路了吗？'),
      text: tr(
        '嘿嘿，带路完成！想聊天就来对话，想一起做点东西就来工作区，惦记着进度就看看任务中心。Pero 就在这里，等主人来找我玩~',
      ),
      expression: 'proud',
      tab: 'chat',
      focusSelector: null,
    },
  ]
}
