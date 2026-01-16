// 注意：live2d_path 参数应使用绝对路径 看看有没有改成功
const core_js = "/live2d-widget/live2d.min.js";
const core_js_alt = "https://fastly.jsdelivr.net/gh/stevenjoezhang/live2d-widget@latest/live2d.min.js";
function loadExternalResource(url, type) {
  return new Promise((resolve, reject) => {
    let tag
    if (type === "css") { tag = document.createElement("link"); tag.rel = "stylesheet"; tag.href = url }
    else if (type === "js") { tag = document.createElement("script"); tag.src = url }
    if (tag) { 
      tag.onload = () => resolve(url); 
      tag.onerror = () => {
        console.error("[Live2D] Failed to load resource:", url);
        reject(url); 
      }
      document.head.appendChild(tag) 
    }
  })
}

// 错误提示工具
function showLive2DError(msg) {
  console.error("[Live2D Error]", msg);
  const errDiv = document.createElement('div');
  errDiv.style.position = 'fixed';
  errDiv.style.bottom = '10px';
  errDiv.style.left = '10px';
  errDiv.style.color = 'red';
  errDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
  errDiv.style.padding = '5px';
  errDiv.style.zIndex = '10000';
  errDiv.style.fontSize = '12px';
  errDiv.innerText = 'Live2D Error: ' + msg;
  document.body.appendChild(errDiv);
}

Promise.all([
  loadExternalResource(core_js, "js").catch((e) => {
      console.warn("[Live2D] Local core failed, trying CDN...", e);
      return loadExternalResource(core_js_alt, "js");
  }),
  loadExternalResource("/live2d-widget/waifu-config.js", "js"),
  loadExternalResource("/live2d-widget/waifu-tips.js", "js")
]).then(() => {
  if (typeof initWidget !== 'function') {
    showLive2DError("initWidget is not defined. waifu-tips.js failed to load?");
    return;
  }
  const start = () => initWidget({ 
    waifuPath: "/live2d-widget/waifu-texts.json", 
    cdnPath: "/live2d-widget/" 
  })
  const ready = window.__waifuTextsReady
  if (ready && typeof ready.then === 'function') { ready.then(start).catch(e => showLive2DError(e)) } else { start() }
}).catch(err => {
    showLive2DError("Failed to load Live2D dependencies: " + err);
})

console.log("[Live2D] autoload (no default CSS) initialized")
