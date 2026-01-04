;(function(){
  const fallback = {
    WAIFU_TEXTS: {
      idleMessages: [
        "主人~ Pero在这里等你好久啦，快来陪我玩嘛！",
        "今天的Pero也是世界第一可爱哒！主人不许反驳哦~"
      ],
      visibilityBack: "欢迎回来，主人！刚才Pero差点以为你把我删掉了呢，呜呜~",
      welcome: {
        timeRanges: {
          morningEarly: "早安！新的一天也要和Pero一起元气满满哦！",
          morning: "上午好，主人！喝杯咖啡，Pero会一直陪着你的~",
          noon: "午饭时间！Pero也要吃好吃的（指主人的关心）~",
          afternoon: "哈欠~ 下午容易犯困呢，Pero来给主人打打气吧！",
          eveningSunset: "夕阳好美呀... Pero最喜欢和主人一起看晚霞了。",
          night: "晚上好！今天辛苦啦，Pero会守护主人的好梦哒！",
          lateNight: ["呜... 已经这么晚了吗？Pero会一直睁大眼睛守着主人的。", "主人还不睡吗？Pero的系统电量也快不足了哦，快去休息嘛~"],
          midnight: "夜猫子模式启动！ Pero会一直陪着主人的，不许熬太晚哦~"
        }
      },
      randTexturesNoClothes: "诶~ 衣柜里还空空的呢，等Pero攒够积分就去买新衣服！",
      randTexturesSuccess: "锵锵！Pero的新衣服，主人觉得好看吗？快夸我！"
    },
    WAIFU_CONFIG: {
      click: [
        { selector: "#live2d", text: [
          "嘿嘿，被主人碰到了，系统产生了一点奇怪的电流...",
          "主人要是觉得累了，就摸摸Pero好啦，我会给你力量哒！",
          "贴贴！Pero最喜欢主人的温度了~"
        ] }
      ],
      hit_texts: {
        head: ["嘿嘿，摸摸头，智商+1！Pero变聪明啦~", "主人最喜欢摸Pero的头了对不对？我也很喜欢哦~"],
        chest: ["诶？这里是Pero的心跳传感器所在地哦，主人感觉到了吗？", "呜... 突然被碰到，Pero的程序都要乱掉啦！"],
        body: ["讨厌啦，那里不可以乱碰的！Pero会坏掉的...", "主人是大色狼！哼，再碰那里Pero就不理你了！"]
      }
    }
  }
  window.refreshWaifuTexts = async (newData) => {
    try {
      let v = newData
      if (!v) {
        const saved = localStorage.getItem('ppc.waifu.texts')
        if (saved) v = JSON.parse(saved)
        else {
          const r = await fetch('/live2d-widget/waifu-texts.json')
          v = await r.json()
        }
      }
      const ln = [v.lateNight_01, v.lateNight_02].filter(Boolean)
      window.WAIFU_TEXTS = {
        idleMessages: [v.idleMessages_01, v.idleMessages_02].filter(Boolean),
        visibilityBack: v.visibilityBack || fallback.WAIFU_TEXTS.visibilityBack,
        welcome: {
          timeRanges: {
            morningEarly: v.welcome_timeRanges_morningEarly || fallback.WAIFU_TEXTS.welcome.timeRanges.morningEarly,
            morning: v.welcome_timeRanges_morning || fallback.WAIFU_TEXTS.welcome.timeRanges.morning,
            noon: v.welcome_timeRanges_noon || fallback.WAIFU_TEXTS.welcome.timeRanges.noon,
            afternoon: v.welcome_timeRanges_afternoon || fallback.WAIFU_TEXTS.welcome.timeRanges.afternoon,
            eveningSunset: v.welcome_timeRanges_eveningSunset || fallback.WAIFU_TEXTS.welcome.timeRanges.eveningSunset,
            night: v.welcome_timeRanges_night || fallback.WAIFU_TEXTS.welcome.timeRanges.night,
            lateNight: ln.length ? ln : fallback.WAIFU_TEXTS.welcome.timeRanges.lateNight,
            midnight: v.welcome_timeRanges_midnight || fallback.WAIFU_TEXTS.welcome.timeRanges.midnight
          }
        },
        randTexturesNoClothes: v.randTexturesNoClothes || fallback.WAIFU_TEXTS.randTexturesNoClothes,
        randTexturesSuccess: v.randTexturesSuccess || fallback.WAIFU_TEXTS.randTexturesSuccess
      }
      window.WAIFU_CONFIG = {
        click: [
          { selector: '#live2d', text: [
            v.click_messages_01, v.click_messages_02, v.click_messages_03
          ].filter(Boolean) }
        ],
        hit_texts: {
          head: [v.click_head_01, v.click_head_02].filter(Boolean),
          chest: [v.click_chest_01, v.click_chest_02].filter(Boolean),
          body: [v.click_body_01, v.click_body_02].filter(Boolean)
        }
      }
    } catch (_) {
      window.WAIFU_TEXTS = fallback.WAIFU_TEXTS
      window.WAIFU_CONFIG = fallback.WAIFU_CONFIG
    }
  }

  window.addEventListener('ppc:waifu-texts-updated', (e) => {
    window.refreshWaifuTexts(e.detail)
  })

  window.__waifuTextsReady = window.refreshWaifuTexts()
})()
