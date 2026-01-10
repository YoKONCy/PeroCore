function updateStatus() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
    const statusDiv = document.getElementById("status");
    const debugDiv = document.getElementById("debug-info");
    
    if (response && response.connected) {
      statusDiv.textContent = "Connected";
      statusDiv.className = "status connected";
    } else {
      statusDiv.textContent = "Disconnected";
      statusDiv.className = "status disconnected";
    }

    if (response) {
      debugDiv.innerHTML = `
        URL: ${response.url || 'ws://localhost:9120/ws/browser'}<br>
        Attempts: ${response.attempts || 0}<br>
        Last Error: ${response.lastError || 'None'}
      `;
    }
  });
}

document.getElementById("reconnect").addEventListener("click", () => {
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = "Reconnecting...";
  statusDiv.className = "status";
  
  chrome.runtime.sendMessage({ type: "reconnect" }, (response) => {
    setTimeout(updateStatus, 1000);
  });
});

// Initial status check
updateStatus();
// Refresh status every 2 seconds while popup is open
setInterval(updateStatus, 2000);