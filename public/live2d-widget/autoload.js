// 注意：live2d_path 参数应使用绝对路径 看看有没有改成功
const core_js = "/live2d-widget/live2d.min.js";
const core_js_alt = "https://fastly.jsdelivr.net/gh/stevenjoezhang/live2d-widget@latest/live2d.min.js";
function loadExternalResource(url, type) {
  return new Promise((resolve, reject) => {
    let tag
    if (type === "css") { tag = document.createElement("link"); tag.rel = "stylesheet"; tag.href = url }
    else if (type === "js") { tag = document.createElement("script"); tag.src = url }
    if (tag) { tag.onload = () => resolve(url); tag.onerror = () => reject(url); document.head.appendChild(tag) }
  })
}

Promise.all([
  loadExternalResource(core_js, "js").catch(() => loadExternalResource(core_js_alt, "js")),
  loadExternalResource("/live2d-widget/waifu-config.js", "js"),
  loadExternalResource("/live2d-widget/waifu-tips.js", "js")
]).then(() => {
  const start = () => initWidget({ 
    waifuPath: "/live2d-widget/waifu-texts.json", 
    cdnPath: "/live2d-widget/" 
  })
  const ready = window.__waifuTextsReady
  if (ready && typeof ready.then === 'function') { ready.then(start).catch(start) } else { start() }
})

console.log("[Live2D] autoload (no default CSS) initialized")
