function loadWidget(config) {
  let { waifuPath, apiPath, cdnPath } = config
  let useCDN = false, modelList
  if (typeof cdnPath === "string") { useCDN = true; if (!cdnPath.endsWith("/")) cdnPath += "/" }
  else if (typeof apiPath === "string") { if (!apiPath.endsWith("/")) apiPath += "/" }
  else { console.error("Invalid initWidget argument!"); return }
  localStorage.removeItem("waifu-display")
  sessionStorage.removeItem("waifu-text")
  document.body.insertAdjacentHTML("beforeend", `<div id="waifu">
      <div id="waifu-tips"></div>
      <canvas id="live2d" width="800" height="800"></canvas>
      <div id="waifu-tool">
        <span class="fa fa-lg fa-comment"></span>
        <span class="fa fa-lg fa-paper-plane"></span>
        <span class="fa fa-lg fa-user-circle"></span>
        <span class="fa fa-lg fa-street-view"></span>
        <span class="fa fa-lg fa-camera-retro"></span>
        <span class="fa fa-lg fa-info-circle"></span>
        <span class="fa fa-lg fa-times"></span>
      </div>
    </div>`)
  setTimeout(() => { document.getElementById("waifu").style.bottom = 0 }, 0)

  function randomSelection(obj) { return Array.isArray(obj) ? obj[Math.floor(Math.random() * obj.length)] : obj }
  let userAction = false, userActionTimer, messageTimer
  window.addEventListener("mousemove", () => userAction = true)
  window.addEventListener("keydown", () => userAction = true)
  setInterval(() => {
    if (userAction) { userAction = false; clearInterval(userActionTimer); userActionTimer = null }
    else if (!userActionTimer) { 
      userActionTimer = setInterval(() => { 
        const T = window.WAIFU_TEXTS || {}
        const messageArray = (Array.isArray(T.idleMessages) && T.idleMessages.length ? T.idleMessages : ["好久不见，日子过得好快呢……", "大坏蛋！你都多久没理人家了呀，嘤嘤嘤～", "嗨～快来逗我玩吧！", "拿小拳拳锤你胸口！"])
        showMessage(randomSelection(messageArray), 6000, 9) 
      }, 20000) 
    }
  }, 1000)

  ;(function registerEventListener() {
    document.querySelector("#waifu-tool .fa-paper-plane").addEventListener("click", () => {
      if (window.Asteroids) { if (!window.ASTEROIDSPLAYERS) window.ASTEROIDSPLAYERS = []; window.ASTEROIDSPLAYERS.push(new Asteroids()) }
      else { const script = document.createElement("script"); script.src = "https://fastly.jsdelivr.net/gh/stevenjoezhang/asteroids/asteroids.js"; document.head.appendChild(script) }
    })
    document.querySelector("#waifu-tool .fa-user-circle").addEventListener("click", loadOtherModel)
    document.querySelector("#waifu-tool .fa-street-view").addEventListener("click", loadRandModel)
    document.querySelector("#waifu-tool .fa-camera-retro").addEventListener("click", () => { Live2D.captureName = "photo.png"; Live2D.captureFrame = true })
    document.querySelector("#waifu-tool .fa-info-circle").addEventListener("click", () => { open("https://github.com/stevenjoezhang/live2d-widget") })
    document.querySelector("#waifu-tool .fa-times").addEventListener("click", () => { localStorage.setItem("waifu-display", Date.now()); document.getElementById("waifu").style.bottom = "-500px"; setTimeout(() => { document.getElementById("waifu").style.display = "none"; const t = document.getElementById("waifu-toggle"); if (t) t.classList.add("waifu-toggle-active") }, 3000) })
    const devtools = () => {}
    console.log("%c", devtools)
    window.addEventListener("visibilitychange", () => { 
      const T = window.WAIFU_TEXTS || {}
      if (!document.hidden) showMessage(T.visibilityBack || "哇，你终于回来了～", 6000, 9) 
    })
  })()

  ;(function welcomeMessage() {
    if (location.pathname === "/") {
      const T = window.WAIFU_TEXTS || {}
      const W = (T.welcome || {})
      const TR = (W.timeRanges || {})
      let text
      const now = new Date().getHours()
      if (now > 5 && now <= 7) text = TR.morningEarly || "早上好！一日之计在于晨，美好的一天就要开始了。"
      else if (now > 7 && now <= 11) text = TR.morning || "上午好！工作顺利嘛，不要久坐，多起来走动走动哦！"
      else if (now > 11 && now <= 13) text = TR.noon || "中午了，工作了一个上午，现在是午餐时间！"
      else if (now > 13 && now <= 17) text = TR.afternoon || "午后很容易犯困呢，今天的运动目标完成了吗？"
      else if (now > 17 && now <= 19) text = TR.eveningSunset || "傍晚了！窗外夕阳的景色很美丽呢，最美不过夕阳红～"
      else if (now > 19 && now <= 21) text = TR.night || "晚上好，今天过得怎么样？"
      else if (now > 21 && now <= 23) text = TR.lateNight || ["已经这么晚了呀，早点休息吧，晚安～", "深夜时要爱护眼睛呀！"]
      else text = TR.midnight || "你是夜猫子呀？这么晚还不睡觉，明天起的来嘛？"
      showMessage(text, 7000, 8)
    }
  })()

  function showMessage(text, timeout, priority) {
    if (!text || (sessionStorage.getItem("waifu-text") && sessionStorage.getItem("waifu-text") > priority)) return
    if (messageTimer) { clearTimeout(messageTimer); messageTimer = null }
    text = randomSelection(text)
    
    // 触发自定义事件，允许外部（如 Vue）拦截消息显示
    window.dispatchEvent(new CustomEvent('waifu-message', { 
      detail: { text, timeout, priority } 
    }))

    sessionStorage.setItem("waifu-text", priority)
    const tips = document.getElementById("waifu-tips")
    if (!tips) return
    tips.innerHTML = text
    tips.classList.remove("waifu-tips-active")
    void tips.offsetWidth // trigger reflow
    tips.classList.add("waifu-tips-active")
    messageTimer = setTimeout(() => { sessionStorage.removeItem("waifu-text"); tips.classList.remove("waifu-tips-active") }, timeout)
  }

  ;(function initModel() {
    let modelId = localStorage.getItem("modelId"), modelTexturesId = localStorage.getItem("modelTexturesId")
    if (modelId === null) {
      modelId = 0; modelTexturesId = 0
    } else {
      modelId = parseInt(modelId); modelTexturesId = parseInt(modelTexturesId)
    }
    if (useCDN) {
      if (!modelList) {
        loadModelList().then(() => {
          if (isNaN(modelId) || modelId >= modelList.models.length) {
            modelId = 0; modelTexturesId = 0
          } else {
            const maxTextures = modelList.model_textures[modelId];
            if (isNaN(modelTexturesId) || modelTexturesId >= maxTextures) {
              modelTexturesId = 0
            }
          }
          loadModel(modelId, modelTexturesId)
        })
      } else {
        if (isNaN(modelId) || modelId >= modelList.models.length) {
          modelId = 0; modelTexturesId = 0
        }
        loadModel(modelId, modelTexturesId)
      }
    } else {
      if (isNaN(modelId)) { modelId = 1; modelTexturesId = 53 }
      loadModel(modelId, modelTexturesId)
    }
    window.addEventListener("click", event => {
      const C = window.WAIFU_CONFIG || { click: [] }

      // 坐标系部位检测逻辑
      if (event.target.id === 'live2d') {
         const rect = event.target.getBoundingClientRect();
         const x = event.clientX - rect.left;
         const y = event.clientY - rect.top;
         
         // 转换为 Live2D 模型坐标 (假设 Canvas 800x800)
         // Live2D X: -1 (左) 到 1 (右)
         // Live2D Y: 1 (上) 到 -1 (下)
         const modelX = (x / rect.width) * 2 - 1;
         const modelY = 1 - (y / rect.height) * 2;
         
         // 定义点击区域 (基于 potion-Maker-Pio 模型)
         const hitAreas = {
           head: { x: [-0.5, 0.6], y: [0.95, -0.2] }, // 扩大 X 轴左边界从 -0.35 到 -0.5，上边界 Y 轴从 0.19 提升到 0.95
           body: { x: [-0.4, 0.4], y: [0.3, -1.0] } // 扩大 X 轴范围从 0.25 到 0.4，下边界 Y 轴从 -0.9 到 -1.0
         };
         
         let hitPart = null;
         
         // 优先检测头部
         // [Fix] 增加空值检查，防止 hitAreas.head undefined 导致报错
         if (hitAreas.head && hitAreas.head.x && modelX >= hitAreas.head.x[0] && modelX <= hitAreas.head.x[1] &&
             hitAreas.head.y && modelY <= hitAreas.head.y[0] && modelY >= hitAreas.head.y[1]) {
            hitPart = 'head';
         } 
         // 检测身体 (头部以外)
         else if (hitAreas.body && hitAreas.body.x && modelX >= hitAreas.body.x[0] && modelX <= hitAreas.body.x[1] &&
                  hitAreas.body.y && modelY <= hitAreas.body.y[0] && modelY >= hitAreas.body.y[1]) {
            // 将身体细分为胸部和下身
            // 头部底部约 -0.2, 身体顶部 0.3.
            // 设定 -0.4 为胸部与下身的分界线
            if (modelY > -0.4) { 
                hitPart = 'chest';
            } else {
                hitPart = 'body'; // 下身
            }
         }
         
         if (hitPart && C.hit_texts && C.hit_texts[hitPart] && C.hit_texts[hitPart].length > 0) {
             const t = randomSelection(C.hit_texts[hitPart]);
             showMessage(t, 4000, 8);
             return;
         }
      }

      for (let config of (C.click || [])) {
        if (!event.target.matches(config.selector)) continue;
        
        let t;
        if (Array.isArray(config.text)) {
          // Sequential playback
          if (config.nextIndex === undefined) config.nextIndex = 0;
          t = config.text[config.nextIndex];
          config.nextIndex = (config.nextIndex + 1) % config.text.length;
        } else {
          t = config.text;
        }
        
        t = String(t).replace("{text}", event.target.innerText);
        showMessage(t, 4000, 8);
        return
      }
    })
  })()

  async function loadModelList() { const response = await fetch(`${cdnPath}model_list.json`); modelList = await response.json() }

  async function ensureLoadFn() {
    if (typeof window.loadlive2d === "function") return true
    return await new Promise(resolve => {
      const start = Date.now()
      const timer = setInterval(() => {
        if (typeof window.loadlive2d === "function") { clearInterval(timer); resolve(true) }
        else if (Date.now() - start > 8000) { clearInterval(timer); resolve(false) }
      }, 60)
    })
  }

  async function loadModel(modelId, modelTexturesId, message) {
    localStorage.setItem("modelId", modelId)
    localStorage.setItem("modelTexturesId", modelTexturesId)
    showMessage(message, 4000, 10)
    const ok = await ensureLoadFn()
    if (!ok || typeof window.loadlive2d !== "function") { try { console.warn("loadlive2d unavailable") } catch (_) {}; return }
    if (useCDN) {
      if (!modelList) await loadModelList();
      const target = modelList.models[modelId];
      const indexName = modelTexturesId > 0 ? `index_${modelTexturesId}.json` : "index.json";
      window.loadlive2d("live2d", `${cdnPath}model/${target}/${indexName}`);
      console.log(`Live2D 模型 ${modelId} 纹理 ${modelTexturesId} 加载完成`);
    }
    else { window.loadlive2d("live2d", `${apiPath}get/?id=${modelId}-${modelTexturesId}`); console.log(`Live2D 模型 ${modelId}-${modelTexturesId} 加载完成`) }
  }

  async function loadRandModel() {
    const T = window.WAIFU_TEXTS || {}
    if (useCDN && !modelList) await loadModelList();
    
    let modelId = parseInt(localStorage.getItem("modelId") || "0")
    let modelTexturesId = parseInt(localStorage.getItem("modelTexturesId") || "0")
    
    if (useCDN) {
      if (isNaN(modelId) || modelId >= modelList.models.length) modelId = 0;
      const maxTextures = modelList.model_textures[modelId] || 1;
      modelTexturesId++;
      if (modelTexturesId >= maxTextures) modelTexturesId = 0;
      loadModel(modelId, modelTexturesId, (T.randTexturesSuccess || "我的新衣服好看嘛？"))
    }
    else { fetch(`${apiPath}rand_textures/?id=${modelId}-${modelTexturesId}`).then(response => response.json()).then(result => { if (result.textures.id === 1 && (modelTexturesId === 1 || modelTexturesId === 0)) showMessage((T.randTexturesNoClothes || "我还没有其他衣服呢！"), 4000, 10); else loadModel(modelId, result.textures.id, (T.randTexturesSuccess || "我的新衣服好看嘛？")) }) }
  }

  async function loadOtherModel() {
    let modelId = parseInt(localStorage.getItem("modelId") || "0")
    if (useCDN) { 
      if (!modelList) await loadModelList(); 
      if (isNaN(modelId) || modelId >= modelList.models.length) modelId = 0;
      const index = (++modelId >= modelList.models.length) ? 0 : modelId; 
      loadModel(index, 0, modelList.messages[index]) 
    }
    else { fetch(`${apiPath}switch/?id=${modelId}`).then(response => response.json()).then(result => { loadModel(result.model.id, 0, result.model.message) }) }
  }
  window.WaifuWidget = { loadOtherModel, loadRandModel }
}

function initWidget(config, apiPath) {
  if (typeof config === "string") { config = { waifuPath: config, apiPath } }
  loadWidget(config)
}

// --- Pero Pero Lip Sync Extension ---
;(function() {
    let _peroModel = null;
    let _hooked = false;

    // 尝试获取模型实例的函数
    function findLive2DModel() {
        if (_peroModel) return _peroModel;
        
        // 1. 检查标准 Live2D.samples
        if (window.Live2D && window.Live2D.samples && window.Live2D.samples.length > 0) {
            return window.Live2D.samples[0];
        }
        
        // 2. 暴力扫描全局对象 (针对混淆过的或非标准实现的库)
        // 这是一个昂贵的操作，只在找不到时偶尔执行
        // 但鉴于我们非常需要这个功能，我们在初始化阶段可以做一次
        
        return null;
    }

    // 口型同步的核心逻辑
    function installLipSync() {
        const model = findLive2DModel();
        if (!model) {
            // 如果还没找到，稍后重试
            setTimeout(installLipSync, 1000);
            return;
        }

        if (model._pero_lip_sync_installed) return;

        console.log("[Pero-Widget] Live2D Model found, installing LipSync hooks...");
        _peroModel = model;

        // 确定口型参数 ID
        let mouthParam = "PARAM_MOUTH_OPEN_Y";
        const core = model.live2DModel || model;
        if (core && core.getModelContext) {
            const ctx = core.getModelContext();
            // 简单的探测逻辑
            if (ctx.getParamIndex("PARAM_MOUTH_OPEN_Y") !== -1) mouthParam = "PARAM_MOUTH_OPEN_Y";
            else if (ctx.getParamIndex("PARAM_MOUTH_OPEN") !== -1) mouthParam = "PARAM_MOUTH_OPEN";
        }
        
        console.log("[Pero-Widget] Using mouth parameter:", mouthParam);

        // Hook Update
        const originalUpdate = model.update;
        model.update = function() {
            if (originalUpdate) originalUpdate.apply(this, arguments);
            applyLipSync(this);
        };

        // Hook Draw (这是为了防止 update 之后被其他逻辑（如鼠标跟随）覆盖)
        // 尝试 Hook 不同的 Draw 入口
        if (model.draw) {
            const originalDraw = model.draw;
            model.draw = function() {
                applyLipSync(this);
                originalDraw.apply(this, arguments);
            };
        }
        
        // 如果有内部的 live2DModel 对象，也尝试 Hook 它的 draw
        if (model.live2DModel && model.live2DModel.draw) {
            const originalCoreDraw = model.live2DModel.draw;
            model.live2DModel.draw = function() {
                 applyLipSync(model); // 注意这里传入外层 model 或内层 core 取决于 applyLipSync 的实现
                 originalCoreDraw.apply(this, arguments);
            };
        }

        function applyLipSync(m) {
            const val = window.__pero_lip_sync_value; // 从 Vue 传来的全局变量
            if (typeof val === 'number' && val > 0) {
                const c = m.live2DModel || m;
                if (c && typeof c.setParamFloat === 'function') {
                    // 强制覆盖
                    c.setParamFloat(mouthParam, val);
                    // 为了保险，把常见的都设置一遍
                    if (mouthParam !== "PARAM_MOUTH_OPEN_Y") c.setParamFloat("PARAM_MOUTH_OPEN_Y", val);
                    if (mouthParam !== "PARAM_MOUTH_OPEN") c.setParamFloat("PARAM_MOUTH_OPEN", val);
                    
                    // 某些特殊的内部标志位
                    if ('lipSync' in m) m.lipSync = true;
                }
            }
        }

        model._pero_lip_sync_installed = true;
        console.log("[Pero-Widget] LipSync hooks installed successfully.");
    }

    // 启动监听
    if (document.readyState === 'complete') {
        installLipSync();
    } else {
        window.addEventListener('load', installLipSync);
    }
    
    // 额外的轮询，防止 load 事件错过模型加载
    setInterval(installLipSync, 3000);
})();
