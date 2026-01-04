let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const WS_URL = "ws://localhost:3000/ws/browser";
const RECONNECT_ALARM_NAME = "reconnect-alarm";
const CHECK_CONNECTION_ALARM_NAME = "check-connection-alarm";

function connect() {
  if (socket) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      console.log("Socket already open or connecting, skipping...");
      return;
    }
    socket.close();
  }

  console.log(`Connecting to Pero backend at ${WS_URL} (Attempt ${reconnectAttempts + 1})...`);
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("Connected to Pero backend");
    isConnected = true;
    reconnectAttempts = 0;
    chrome.alarms.clear(RECONNECT_ALARM_NAME);
    // Start periodic check when connected
    chrome.alarms.create(CHECK_CONNECTION_ALARM_NAME, { periodInMinutes: 1 });
    
    // Start heartbeat
    startHeartbeat();
    
    // Request page info from active tab immediately after connection
    requestPageInfo();
  };

  socket.onmessage = (event) => {
    try {
      if (event.data === "pong") {
        // console.debug("Received pong from backend");
        return;
      }

      const message = JSON.parse(event.data);
      console.log("Received message:", message);
      
      if (message.type === "command") {
        handleCommand(message.data);
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  };

  socket.onclose = (event) => {
    console.log(`Disconnected from Pero backend (Code: ${event.code})`);
    isConnected = false;
    socket = null;
    stopHeartbeat();
    
    // Exponential backoff for reconnection
    const delayMinutes = Math.min(5, (Math.pow(2, reconnectAttempts) * 1000) / 60000);
    // For MV3, alarms must be at least 1 minute apart for most things, 
    // but for reconnection we might want something faster if possible.
    // However, chrome.alarms.create with small delays often works in practice or is throttled to 1 min.
    // We'll use a mix of setTimeout (for immediate) and alarms (for persistence).
    
    const delayMs = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000);
    console.log(`Will try to reconnect in ${delayMs}ms`);
    
    // Set an alarm as a fallback to wake up the SW
    chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: Math.max(1/60, delayMs / 60000) });
    
    reconnectAttempts++;
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

function requestPageInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      // Try to inject content script if not present (heuristic) or just ping it
      // For now, we just send a message. If it fails, we might need to inject.
      chrome.tabs.sendMessage(tabId, { type: "getPageInfo" }, (response) => {
         if (chrome.runtime.lastError) {
           console.log("Content script not ready or error:", chrome.runtime.lastError);
           // If the error is "Could not establish connection", the content script might be missing (e.g. on new tab page or restricted page).
           // Try to inject script
           injectContentScript(tabId, () => {
              // Retry request
              chrome.tabs.sendMessage(tabId, { type: "getPageInfo" });
           });
         }
      });
    }
  });
}

function injectContentScript(tabId, callback, errorCallback) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content_script.js']
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Failed to inject script:", chrome.runtime.lastError);
            if (errorCallback) errorCallback(chrome.runtime.lastError);
        } else {
            console.log("Script injected successfully");
            if (callback) callback();
        }
    });
}

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM_NAME || alarm.name === CHECK_CONNECTION_ALARM_NAME) {
    if (!isConnected) {
      console.log("Alarm triggered reconnection check...");
      connect();
    }
  }
});

// Wake up on tab activity
chrome.tabs.onActivated.addListener(() => {
  if (!isConnected) {
    console.log("Tab activated, checking connection...");
    connect();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && !isConnected) {
    console.log("Tab updated, checking connection...");
    connect();
  }
});

function handleCommand(commandData) {
  // Handle navigation specifically in background script
  if (commandData.command === "open_url") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { url: commandData.url }, (tab) => {
                sendCommandResult(commandData.requestId, { status: "success", result: "Navigation started" });
            });
        } else {
            chrome.tabs.create({ url: commandData.url }, (tab) => {
                sendCommandResult(commandData.requestId, { status: "success", result: "Navigation started in new tab" });
            });
        }
      });
      return;
  }

  // New command: back
  if (commandData.command === "back") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.goBack(tabs[0].id, () => {
                sendCommandResult(commandData.requestId, { status: "success", result: "Navigated back" });
            });
        } else {
            sendCommandResult(commandData.requestId, { error: "No active tab found" });
        }
      });
      return;
  }

  // New command: refresh
  if (commandData.command === "refresh") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.reload(tabs[0].id, {}, () => {
                sendCommandResult(commandData.requestId, { status: "success", result: "Page refreshed" });
            });
        } else {
            sendCommandResult(commandData.requestId, { error: "No active tab found" });
        }
      });
      return;
  }

  // Find the active tab to execute other commands
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
        sendCommandResult(commandData.requestId, { error: "No active tab found" });
        return;
    }
    const tabId = tabs[0].id;
    
    chrome.tabs.sendMessage(tabId, { type: "execute_command", data: commandData }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending to content script:", chrome.runtime.lastError);
        
        // Try to inject script and retry
        injectContentScript(tabId, () => {
            chrome.tabs.sendMessage(tabId, { type: "execute_command", data: commandData }, (retryResponse) => {
                if (chrome.runtime.lastError) {
                    sendCommandResult(commandData.requestId, { error: chrome.runtime.lastError.message });
                } else {
                    sendCommandResult(commandData.requestId, retryResponse);
                }
            });
        }, (err) => {
            // Injection failed (e.g. chrome:// pages), send error immediately
            sendCommandResult(commandData.requestId, { error: "Failed to inject content script: " + err.message });
        });
      } else {
        sendCommandResult(commandData.requestId, response);
      }
    });
  });
}

function sendCommandResult(requestId, result) {
  if (socket && isConnected && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "command_result",
      data: {
        requestId: requestId,
        ...result
      }
    }));
  }
}

// Initial connection
connect();

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    sendResponse({ 
      connected: isConnected,
      url: WS_URL,
      attempts: reconnectAttempts
    });
  } else if (message.type === "reconnect") {
    console.log("Manual reconnection requested...");
    reconnectAttempts = 0;
    connect();
    sendResponse({ status: "reconnecting" });
  } else if (message.type === "pageInfoUpdate") {
    if (socket && isConnected && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "pageInfoUpdate",
        data: message.data
      }));
    }
  }
  return true;
});

let heartbeatInterval;

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  // Send ping every 10 seconds (backend timeout is 30s)
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send("ping");
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
