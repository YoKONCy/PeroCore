// Helper to simplify page content to Markdown-like text
function getSimplifiedContent() {
  let content = "";
  content += "# " + document.title + "\n\n";
  content += "URL: " + window.location.href + "\n\n";
  
  const elements = document.body.querySelectorAll('h1, h2, h3, p, a, button, input, textarea');
  
  elements.forEach(el => {
    if (el.offsetParent === null) return; // Hidden element
    
    // Check if element or any of its parents is aria-hidden
    let current = el;
    while (current) {
        if (current.getAttribute && (current.getAttribute('aria-hidden') === 'true' || current.style.display === 'none' || current.style.visibility === 'hidden')) {
            return;
        }
        current = current.parentElement;
    }

    let text = el.innerText ? el.innerText.trim() : "";
    if (!text && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        text = `[Input: ${el.placeholder || el.name || el.id || 'Text Field'}]`;
    }
    
    if (text) {
      if (el.tagName.startsWith('H')) {
        content += `\n### ${text}\n`;
      } else if (el.tagName === 'A') {
        content += `[Link: ${text}](${el.href})\n`;
      } else if (el.tagName === 'BUTTON') {
        content += `[Button: ${text}]\n`;
      } else {
        content += `${text}\n`;
      }
    }
  });
  
  return content;
}

// Send initial page info
function sendPageInfo() {
  const info = {
    title: document.title,
    url: window.location.href,
    markdown: getSimplifiedContent()
  };
  chrome.runtime.sendMessage({ type: "pageInfoUpdate", data: info });
}

// Listen for commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "execute_command") {
    const { command, target, text } = message.data;
    handleCommand(command, target, text).then(result => {
       const newContent = getSimplifiedContent();
       sendResponse({ status: "success", result: result, page_content: newContent });
       sendPageInfo(); 
    }).catch(err => {
       sendResponse({ status: "error", error: err.toString() });
    });
    return true; 
  } else if (message.type === "getPageInfo") {
      sendPageInfo();
      sendResponse({ status: "sent" });
  }
});

async function handleCommand(command, target, text) {
  if (command === "click") {
     const el = findElement(target);
     if (el) {
       el.click();
       return `Clicked element: ${target}`;
     } else {
       throw new Error(`Element not found: ${target}`);
     }
  } else if (command === "type") {
     const el = findElement(target);
     if (el) {
       el.value = text;
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));
       return `Typed "${text}" into ${target}`;
     } else {
       throw new Error(`Element not found: ${target}`);
     }
  } else if (command === "scroll") {
      if (text === "up") {
          window.scrollBy(0, -window.innerHeight / 2);
      } else {
          window.scrollBy(0, window.innerHeight / 2);
      }
      return "Scrolled";
  }
  throw new Error(`Unknown command: ${command}`);
}

function findElement(target) {
  if (!target) return null;
  
  const targetLower = target.toLowerCase();

  // Try XPath first if it looks like one
  if (target.startsWith('/') || target.startsWith('(')) {
      try {
        const result = document.evaluate(target, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (e) {}
  }
  
  // Try CSS selector
  try {
    const el = document.querySelector(target);
    if (el) return el;
  } catch (e) {}
  
  // Try exact text match (case-insensitive)
  const allElements = document.querySelectorAll('button, a, p, span, h1, h2, h3, h4, h5, h6, label');
  for (let el of allElements) {
    const text = (el.innerText || "").trim().toLowerCase();
    if (text === targetLower && el.offsetParent !== null) {
      return el;
    }
  }

  // Try partial text match
  for (let el of allElements) {
    const text = (el.innerText || "").trim().toLowerCase();
    if (text.includes(targetLower) && el.offsetParent !== null) {
      // Return the deepest element that contains the text
      if (el.children.length === 0) return el;
      
      // If it has children, check if any child also matches
      let hasMatchingChild = false;
      for (let child of el.children) {
          if ((child.innerText || "").toLowerCase().includes(targetLower)) {
              hasMatchingChild = true;
              break;
          }
      }
      if (!hasMatchingChild) return el;
    }
  }
  
  // Try placeholder, name, id, or aria-label for inputs
  const inputs = document.querySelectorAll('input, textarea, [role="button"], [aria-label]');
  for (let el of inputs) {
      if ((el.placeholder && el.placeholder.toLowerCase().includes(targetLower)) || 
          (el.name && el.name.toLowerCase().includes(targetLower)) ||
          (el.id && el.id.toLowerCase().includes(targetLower)) ||
          (el.getAttribute('aria-label') && el.getAttribute('aria-label').toLowerCase().includes(targetLower))) {
          return el;
      }
  }
  
  return null;
}

// Initialize
// Delay slightly to ensure page is loaded enough
setTimeout(sendPageInfo, 1000);
// Also send on load
window.addEventListener('load', sendPageInfo);
