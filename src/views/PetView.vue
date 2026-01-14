<template>
  <div class="pet-container">
    <div 
      class="character-wrapper" 
      :class="{ shake: isShaking, dragging: isDragging }"
      @mousedown="handleMouseDown"
      @dblclick.prevent.stop="handleDblClick"
      data-tauri-drag-region
    >
      <!-- 状态显示 (Mood/Mind/Vibe) -->
      <transition name="fade">
        <div class="status-tags" v-show="showInput">
          <div class="status-tag mood" :title="'情绪: ' + moodText">❤️ {{ moodText }}</div>
          <div class="status-tag vibe" :title="'氛围: ' + vibeText">✨ {{ vibeText }}</div>
          <div class="status-tag mind" :title="'内心: ' + mindText">💭 {{ mindText }}</div>
        </div>
      </transition>

      <!-- 气泡对话框 -->
      <transition name="fade">
        <div class="bubble" v-if="currentText || isThinking" :class="{ 'expanded': isBubbleExpanded }">
          <!-- 普通文本显示 -->
          <div class="text-content" :class="{ 'cursor-pointer': isThinking }">
            <template v-if="isThinking">
              <span class="thinking-text">{{ thinkingMessage }}</span>
            </template>
            <template v-else>
              <!-- 渲染解析后的片段 -->
              <div class="bubble-scroll-area" ref="bubbleScrollArea">
                <div v-for="(segment, index) in parsedBubbleContent" :key="index" class="bubble-segment">
                  <!-- 普通文本 -->
                  <span v-if="segment.type === 'text'">{{ segment.content }}</span>
                  
                  <!-- 动作描述 -->
                  <span v-else-if="segment.type === 'action'" class="action-text">*{{ segment.content }}*</span>

                  <!-- 思考过程 (折叠) -->
                  <details v-else-if="segment.type === 'thinking'" class="thinking-details">
                    <summary class="thinking-summary">🤔 思考过程...</summary>
                    <div class="thinking-body">{{ segment.content }}</div>
                  </details>
                </div>
              </div>
              <!-- 展开/收起按钮 -->
              <div v-if="isContentOverflowing" class="bubble-expand-btn" @click.stop="toggleBubbleExpand">
                {{ isBubbleExpanded ? '收起' : '展开' }}
              </div>
            </template>
          </div>
          <div class="bubble-tail"></div>
        </div>
      </transition>

      <!-- 任务详情/监控窗口 (已移除，改为独立窗口) -->
      <!-- <TaskMonitorModal v-model:visible="showTaskDetail" :segments="parsedBubbleContent" /> -->

      <!-- 极简灵动触发器 -->
      <div 
        class="floating-trigger" 
        :class="{ active: showInput }"
        @click.stop="toggleUI"
        style="-webkit-app-region: no-drag;"
      >
        <div class="trigger-core">
          <div class="pulse-ring"></div>
          <div class="core-dot"></div>
        </div>
      </div>
      
      <!-- Live2D 模型容器 -->
      <div id="waifu-container" class="pet-avatar-container" data-tauri-drag-region>
        <!-- 加载状态占位 -->
        <div v-if="isLoading" class="loading-placeholder">
          <img src="/icon.png" class="loading-icon" />
          <div class="loading-text">大脑加载中...</div>
        </div>
        <!-- Live2D 元素会被自动注入到 body，然后由脚本移动到这里 -->
        
        <!-- PTT 悬浮按钮 (仅在按住说话模式显示) -->
        <transition name="fade">
          <div 
            v-if="voiceMode === 2" 
            class="ptt-container"
            @mousedown.stop="startPTT"
            @mouseup.stop="stopPTT"
            @mouseleave.stop="stopPTT"
            style="-webkit-app-region: no-drag;"
          >
            <div class="ptt-button" :class="{ recording: isPTTRecording }" title="按住 Alt+Shift+V 说话">
            <div class="ptt-icon">🎙️</div>
          </div>
          </div>
        </transition>
      </div>

      <!-- 快速输入框 (鼠标移入显示) -->
      <div class="input-overlay" v-show="showInput">
        <input 
          ref="inputRef"
          v-model="userInput" 
          @keyup.enter="sendMessage"
          placeholder="跟 Pero 对话..."
          class="chat-input"
          :disabled="isThinking"
          style="-webkit-app-region: no-drag;"
        />
      </div>

      <!-- 悬浮工具栏 -->
      <div class="pet-tools" v-show="showInput" style="-webkit-app-region: no-drag;">
        <button class="tool-btn" @click.stop="randTextures" title="换装">👕</button>
        <button class="tool-btn" @click.stop="reloadPet" title="重载">🔄</button>
        <button 
          class="tool-btn voice-btn" 
          @click.stop="cycleVoiceMode" 
          :class="{ 
            active: voiceMode !== 0,
            'mode-vad': voiceMode === 1,
            'mode-ptt': voiceMode === 2 
          }" 
          :title="voiceModeTitle"
        >
            {{ voiceModeIcon }}
        </button>
        <button class="tool-btn" @click.stop="openDashboard" title="面板">⚙️</button>
      </div>
      

    </div>
    
    <!-- 文件搜索结果模态框 -->
    <FileSearchModal v-model:visible="showFileModal" :files="foundFiles" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, toRaw, nextTick } from 'vue'
import FileSearchModal from '../components/FileSearchModal.vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getAllWebviewWindows, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PhysicalPosition } from '@tauri-apps/api/dpi'

const appWindow = getCurrentWindow();

const voiceMode = ref(parseInt(localStorage.getItem('ppc.voice_mode') || '0')) // 0: off, 1: auto(vad), 2: ptt
const isPTTRecording = ref(false)
const isVoiceActive = computed(() => voiceMode.value !== 0)

const voiceModeIcon = computed(() => {
  if (voiceMode.value === 0) return '🔇'
  if (voiceMode.value === 1) return '🎙️'
  return '🖱️'
})

const voiceModeTitle = computed(() => {
  if (voiceMode.value === 0) return '语音对话: 已关闭'
  if (voiceMode.value === 1) return '语音对话: 自动感应 (VAD)'
  return '语音对话: 按住说话 (PTT)'
})

const handleGlobalKeyDown = (e) => {
  // 1. Alt + V 切换语音模式
  if (e.altKey && !e.shiftKey && e.code === 'KeyV') {
    e.preventDefault()
    cycleVoiceMode()
    return
  }

  // 2. Alt + Shift + V PTT (仅在模式为 2 时)
  if (e.altKey && e.shiftKey && e.code === 'KeyV' && voiceMode.value === 2 && !isPTTRecording.value) {
    e.preventDefault()
    startPTT()
  }
}

const handleGlobalKeyUp = (e) => {
  if (e.code === 'KeyV' && voiceMode.value === 2 && isPTTRecording.value) {
    stopPTT()
  }
}

const cycleVoiceMode = async () => {
  const nextMode = (voiceMode.value + 1) % 3
  voiceMode.value = nextMode
  localStorage.setItem('ppc.voice_mode', nextMode.toString())
  
  if (nextMode === 0) {
    stopVoiceMode()
  } else {
    // 如果还没开启麦克风/WS，则开启
    if (!voiceWs.value) {
      await startVoiceMode()
    }
  }
}

let isStartingPTT = false
const startPTT = async () => {
    if (voiceMode.value !== 2) return
    if (isPTTRecording.value || isStartingPTT) return
    
    isStartingPTT = true
    try {
      if (isThinking.value || isSpeaking.value) {
        console.log('PTT Ignored: Pero is busy', { isThinking: isThinking.value, isSpeaking: isSpeaking.value })
        return
      }
      
      // 确保 AudioContext 已激活
      if (audioContext.value && audioContext.value.state === 'suspended') {
        await audioContext.value.resume()
      }

      isPTTRecording.value = true
      isSpeakingState = true
      audioBuffer = []
      console.log('PTT Started')
    } finally {
      isStartingPTT = false
    }
}

const stopPTT = () => {
  if (!isPTTRecording.value) return
  isPTTRecording.value = false
  isSpeakingState = false
  console.log('PTT Ended, sending buffer...')
  sendAudioBuffer()
}

const voiceWs = ref(null)
const audioContext = ref(null)
const mediaStream = ref(null)
const scriptProcessor = ref(null)
const currentAudioSource = ref(null)
const audioQueue = ref([])
const isAudioPlaying = ref(false)

const currentText = ref('主人，我在桌面等你很久啦！')
// const showTaskDetail = ref(false) // 弃用，改为独立窗口

// 解析气泡文本，分离 Thinking 块和动作描述
const parsedBubbleContent = computed(() => {
  const text = currentText.value || ''
  if (!text) return []

  const segments = []
  // 改进正则表达式，支持多行 Thought/Action 和更灵活的匹配
  // 1. 【Type: Content】 - 块格式
  // 2. *Action* - 星号动作格式
  // 3. Thought/Action: Content - 标准 ReAct 格式（支持多行，直到下一个标识符或结束）
  const regex = /(?:【(Thinking|Error|Reflection)[:：]?\s*([\s\S]*?)】)|(?:\n|^)\s*\*([\s\S]+?)\*|(?:\n|^)\s*(Thought|Action)[:：]\s*([\s\S]+?)(?=\n\s*(?:Thought|Action)[:：]|\n\s*\*|【(?:Thinking|Error|Reflection)|$)/gi
  
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // 1. 添加匹配前的普通文本
    if (match.index > lastIndex) {
      const normalText = text.substring(lastIndex, match.index)
      if (normalText.trim()) {
        segments.push({ type: 'text', content: normalText })
      }
    }
    
    // 2. 判断匹配类型
    if (match[1] !== undefined) {
      // Tagged 块 (Thinking/Error/Reflection)
      const type = match[1].toLowerCase()
      segments.push({ type: type === 'thinking' ? 'thinking' : type, content: match[2].trim() })
    // 3. *Action* - 星号动作格式
    } else if (match[3] !== undefined) {
      // Action 块 (*Action*)
      segments.push({ type: 'action', content: match[3].trim() })
    // 4. 标准 ReAct 块 (Thought:/Action:)
    } else if (match[4] !== undefined) {
      const type = match[4].toLowerCase() === 'thought' ? 'thinking' : 'action'
      segments.push({ type, content: match[5].trim() })
    }
    
    lastIndex = regex.lastIndex
  }
  
  // 3. 添加剩余的普通文本
  if (lastIndex < text.length) {
    const normalText = text.substring(lastIndex)
    if (normalText.trim()) {
      segments.push({ type: 'text', content: normalText })
    }
  }
  
  return segments
})

const isSpeaking = ref(false)
const isThinking = ref(false)
const thinkingMessage = ref('努力思考中...')
const userInput = ref('')
const showInput = ref(false)
const isLoading = ref(true)
const inputRef = ref(null)
const lastAiReplyTime = ref(0)
let replyTimer = null

const showFileModal = ref(false)
const foundFiles = ref([])

// 气泡折叠相关
const isBubbleExpanded = ref(false)
const isContentOverflowing = ref(false)
const bubbleScrollArea = ref(null)

const toggleBubbleExpand = () => {
  isBubbleExpanded.value = !isBubbleExpanded.value
  // 强制重新检查溢出状态，防止状态不一致
  nextTick(() => {
     checkOverflow()
  })
}

// 监听内容变化，判断是否溢出
watch(parsedBubbleContent, async () => {
  await nextTick()
  checkOverflow()
}, { deep: true })

const checkOverflow = () => {
  if (bubbleScrollArea.value) {
    const el = bubbleScrollArea.value
    // 如果没有展开，clientHeight 应该是受限的 (例如 200px)
    // 如果 scrollHeight > 200，说明溢出
    // 我们这里放宽一点判定，避免临界值闪烁
    isContentOverflowing.value = el.scrollHeight > 210 
    
    // 如果内容变短了，自动收起
    if (!isContentOverflowing.value) {
      isBubbleExpanded.value = false
    }
  }
}

onMounted(async () => {
  // 初始开启穿透
  setIgnoreMouse(true)
  
  // 监听键盘快捷键
  window.addEventListener('keydown', handleGlobalKeyDown)
  window.addEventListener('keyup', handleGlobalKeyUp)

  // 监听后端日志
  const unlistenLog = await listen('backend-log', (event) => {
    console.log('[Backend]', event.payload)
  })

  // 监听状态更新 (从 Dashboard 发来的)
  const unlistenMood = await listen('update-mood', (event) => {
    moodText.value = event.payload
    localStorage.setItem('ppc.mood', event.payload)
  })
  const unlistenVibe = await listen('update-vibe', (event) => {
    vibeText.value = event.payload
    localStorage.setItem('ppc.vibe', event.payload)
  })
  const unlistenMind = await listen('update-mind', (event) => {
    mindText.value = event.payload
    localStorage.setItem('ppc.mind', event.payload)
  })

  // 同步后端消息到 IDE 聊天窗口
  const unlistenSyncChat = await listen('sync-chat-to-ide', (event) => {
      // 检查当前窗口是否是 PetView（通常是，但为了保险）
      // 我们需要通过 emit 发送给 IDE 窗口
      // 但这里是 PetView，它本身就是渲染进程
      // 实际上，IDE 窗口是另一个 WebView (DashboardView 或 独立的 ChatView)
      // 如果 IDE 聊天是在 Dashboard 中，我们需要确保 Dashboard 也能收到。
      // 或者，如果是通过 Tauri 的 emit，所有窗口都能收到。
      // 这里只需要确保 PetView 收到消息后，不做额外处理，因为 IDE 那边会有自己的监听器。
      // 但用户反馈 IDE 没有同步，说明 IDE 那边的监听可能没挂载，或者事件没发过去。
      
      // 这里我们尝试再次广播一下，或者直接调用 invoke 让 Rust 转发？
      // 不，后端 Python 通过 HTTP 发给 Rust，Rust 再 emit 给所有窗口。
      // 所以 IDE 窗口应该能直接收到 'sync-chat-to-ide'。
      // 让我们检查一下 IDE 侧的代码。
  })

  // 监听来自 IDE 的消息同步 (如果 IDE 发消息，Pet 也要显示)
  const unlistenIdeMsg = await listen('ide-message-sync', (event) => {
      const { role, content } = event.payload
      if (role === 'assistant') {
          currentText.value = content
      }
  })

  // 监听后端 PTT 全局快捷键
  const unlistenPTTStart = await listen('ptt-start', () => {
    if (voiceMode.value === 2 && !isPTTRecording.value) {
      console.log('Backend PTT Start')
      startPTT()
    }
  })

  const unlistenPTTStop = await listen('ptt-stop', () => {
    if (voiceMode.value === 2 && isPTTRecording.value) {
      console.log('Backend PTT Stop')
      stopPTT()
    }
  })

  // 监听文件搜索结果
  const unlistenSearch = await listen('file-search-result', (event) => {
    foundFiles.value = event.payload
    showFileModal.value = true
  })

  window.addEventListener('beforeunload', () => {
    unlistenLog()
    unlistenMood()
    unlistenVibe()
    unlistenMind()
    unlistenSearch()
    unlistenPTTStart()
    unlistenPTTStop()
  })
})

// 监听 UI 显示状态，动态切换穿透
watch([showInput, parsedBubbleContent, isThinking], ([inputVisible, bubbleContent, thinking]) => {
  // 如果输入框显示，或者有气泡内容，或者正在思考（显示气泡），则不穿透
  const hasContent = bubbleContent && bubbleContent.length > 0
  const shouldInteract = inputVisible || hasContent || thinking
  
  // console.log('Update IgnoreMouse:', !shouldInteract, { inputVisible, hasContent, thinking })
  setIgnoreMouse(!shouldInteract)
})

const moodText = ref(localStorage.getItem('ppc.mood') || '开心')
const mindText = ref(localStorage.getItem('ppc.mind') || '正在想主人...')
const vibeText = ref(localStorage.getItem('ppc.vibe') || '活泼')

const authToken = ref('')

const fetchAuthToken = async () => {
    try {
        const res = await fetch('http://localhost:9120/api/configs')
        if (res.ok) {
            const data = await res.json()
            if (data.frontend_access_token) {
                authToken.value = data.frontend_access_token
                // console.log('Auth token fetched:', authToken.value)
            }
        }
    } catch (e) {
        console.error('Failed to fetch auth token:', e)
    }
}

const fetchPetState = async () => {
    // 顺便更新 Token，防止后端重启后 Token 失效
    await fetchAuthToken()

    try {
        const res = await fetch('http://localhost:9120/api/pet/state')
        if (res.ok) {
            const data = await res.json()
            if (data.mood) {
                moodText.value = data.mood
                localStorage.setItem('ppc.mood', data.mood)
            }
            if (data.vibe) {
                vibeText.value = data.vibe
                localStorage.setItem('ppc.vibe', data.vibe)
            }
            if (data.mind) {
                mindText.value = data.mind
                localStorage.setItem('ppc.mind', data.mind)
            }
        }
    } catch (e) {
        // Silent fail
    }
}

// 切换语音模式 (已弃用，使用 cycleVoiceMode 代替)
const toggleVoiceMode = async () => {
    await cycleVoiceMode()
};

const startVoiceMode = async () => {
    console.log('[Voice] Starting voice mode...');
    try {
        // 0. 确保 AudioContext 存在并激活
        if (!audioContext.value || audioContext.value.state === 'closed') {
            audioContext.value = new (window.AudioContext || window.webkitAudioContext)()
        }
        if (audioContext.value.state === 'suspended') {
            await audioContext.value.resume()
        }

        // 1. 获取麦克风权限
        mediaStream.value = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // 检查音频轨道
        const audioTracks = mediaStream.value.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('No audio tracks found in media stream');
        }
        console.log('[Voice] Microphone access granted:', audioTracks[0].label);
        
        // 2. 连接 WebSocket
        voiceWs.value = new WebSocket('ws://localhost:9120/ws/voice');
        
        voiceWs.value.onopen = () => {
            console.log('Voice WebSocket connected');
            showToast(`语音对话已开启: ${voiceModeTitle.value}`);
            
            // 3. 开始录音处理
            startRecording();
        };
        
        voiceWs.value.onmessage = handleVoiceMessage;
        
        voiceWs.value.onclose = () => {
            console.log('Voice WebSocket closed');
            stopVoiceMode();
        };
        
    } catch (err) {
        console.error('Failed to start voice mode:', err);
        showToast('无法开启麦克风: ' + err.message);
    }
};

const stopVoiceMode = () => {
    if (voiceWs.value) {
        voiceWs.value.close()
        voiceWs.value = null
    }
    
    if (mediaStream.value) {
        mediaStream.value.getTracks().forEach(track => track.stop())
        mediaStream.value = null
    }
    
    if (audioContext.value) {
        audioContext.value.close()
        audioContext.value = null
    }
    
    showToast('语音对话已关闭')
}

// 简单的 VAD (语音活动检测) 阈值
const VAD_THRESHOLD = 0.01 // 降低阈值，更灵敏
let silenceStart = Date.now()
let isSpeakingState = false
let audioBuffer = []
let lastRmsUpdate = 0 // 用于限制日志频率

const startRecording = () => {
    audioContext.value = new (window.AudioContext || window.webkitAudioContext)()
    const source = audioContext.value.createMediaStreamSource(mediaStream.value)
    
    // 使用 ScriptProcessorNode 处理音频流 (deprecated but widely supported)
    // 也可以用 AudioWorklet，但在 Vue 单文件中稍微麻烦点
    scriptProcessor.value = audioContext.value.createScriptProcessor(4096, 1, 1)
    
    source.connect(scriptProcessor.value)
    scriptProcessor.value.connect(audioContext.value.destination)
    
    scriptProcessor.value.onaudioprocess = (e) => {
        if (!isVoiceActive.value) return

        // 如果正在思考或正在说话，直接忽略新的语音输入，防止污染和堆积
        if (isThinking.value || isSpeaking.value) {
             return
        }
        
        const inputData = e.inputBuffer.getChannelData(0)
        
        // --- 模式 2: 按住说话 (PTT) ---
        if (voiceMode.value === 2) {
            if (isPTTRecording.value) {
                audioBuffer.push(new Float32Array(inputData))
            }
            return
        }

        // --- 模式 1: 自动感应 (VAD) ---
        // 1. 计算音量 (RMS)
        let sum = 0
        for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i]
        }
        const rms = Math.sqrt(sum / inputData.length)
        
        // 调试日志：每秒输出一次当前音量，方便排查麦克风问题
        if (Date.now() - lastRmsUpdate > 1000) {
            console.log('Current Mic Volume (RMS):', rms.toFixed(4), 'Threshold:', VAD_THRESHOLD)
            lastRmsUpdate = Date.now()
        }
        
        // 2. VAD 逻辑
        if (rms > VAD_THRESHOLD) {
            silenceStart = Date.now()
            if (!isSpeakingState) {
                console.log('Speech detected (Volume:', rms.toFixed(4), ')')
                isSpeakingState = true
                audioBuffer = [] // 清空 buffer
            }
            // 收集音频数据
            audioBuffer.push(new Float32Array(inputData))
        } else {
            if (isSpeakingState) {
                // 如果静音超过 1000ms (稍微增加静音等待时间)，认为一句话结束
                if (Date.now() - silenceStart > 1000) {
                    console.log('Speech ended, sending buffer...')
                    isSpeakingState = false
                    sendAudioBuffer()
                } else {
                    // 短暂静音，继续收集
                     audioBuffer.push(new Float32Array(inputData))
                }
            }
        }
    }
}

const sendAudioBuffer = () => {
    if (audioBuffer.length === 0) return
    
    // 1. 合并 buffer
    const length = audioBuffer.length * 4096
    const merged = new Float32Array(length)
    let offset = 0
    for (const chunk of audioBuffer) {
        merged.set(chunk, offset)
        offset += chunk.length
    }
    
    // 2. 转换为 WAV (简单的 16bit PCM)
    const wavBlob = encodeWAV(merged, audioContext.value.sampleRate)
    
    // 3. 转 Base64 发送
    const reader = new FileReader()
    reader.onloadend = () => {
        const base64data = reader.result.split(',')[1]
        if (voiceWs.value && voiceWs.value.readyState === WebSocket.OPEN) {
            voiceWs.value.send(JSON.stringify({
                type: 'speech_end',
                data: base64data
            }))
        }
    }
    reader.readAsDataURL(wavBlob)
    
    audioBuffer = []
}

// 辅助函数：Float32Array 转 WAV Blob
const encodeWAV = (samples, sampleRate) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    
    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i))
        }
    }
    
    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)
    
    let offset = 44
    for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]))
        s = s < 0 ? s * 0x8000 : s * 0x7FFF
        view.setInt16(offset, s, true)
        offset += 2
    }
    
    return new Blob([view], { type: 'audio/wav' })
}

const handleVoiceMessage = (event) => {
    const msg = JSON.parse(event.data)
    
    if (msg.type === 'status') {
        if (msg.content === 'listening') {
             // 可以在 UI 上显示“正在听...”
             stopAudioPlayback(true)
             isThinking.value = true
             thinkingMessage.value = '正在听主人说话...'
             currentText.value = ''
        } else if (msg.content === 'thinking') {
             isThinking.value = true
             thinkingMessage.value = msg.message || '努力思考中...'
             currentText.value = ''
        } else if (msg.content === 'speaking') {
             isThinking.value = false
             thinkingMessage.value = '努力思考中...' // 重置默认值
        } else if (msg.content === 'idle') {
             isThinking.value = false
             thinkingMessage.value = '努力思考中...'
        }
    } else if (msg.type === 'transcription') {
        // 显示用户说的话 (可选)
        console.log('User said:', msg.content)
    } else if (msg.type === 'text_response') {
        currentText.value = msg.content
        // 收到文本回复时，强制结束思考状态，防止 UI 卡在"思考中"
        isThinking.value = false
        thinkingMessage.value = '努力思考中...'
    } else if (msg.type === 'triggers') {
        // 处理语音会话返回的触发器和状态
        applyTriggers(msg.data)
    } else if (msg.type === 'audio_response') {
        playAudio(msg.data)
    } else if (msg.type === 'error') {
        // Handle backend errors
        console.error('Voice Error:', msg.content)
        currentText.value = `(错误: ${msg.content})`
        isThinking.value = false
        thinkingMessage.value = '努力思考中...'
    }
}

// 应用触发器和状态更新
const applyTriggers = (data) => {
  if (!data) return
  
  // 1. 处理状态 (Mood/Mind/Vibe)
  if (data.state) {
    const statusMap = data.state
    if (statusMap.mood) {
      moodText.value = statusMap.mood
      localStorage.setItem('ppc.mood', statusMap.mood)
      window.dispatchEvent(new CustomEvent('ppc:mood', { detail: statusMap.mood }))
    }
    if (statusMap.vibe) {
      vibeText.value = statusMap.vibe
      localStorage.setItem('ppc.vibe', statusMap.vibe)
      window.dispatchEvent(new CustomEvent('ppc:vibe', { detail: statusMap.vibe }))
    }
    if (statusMap.mind) {
      mindText.value = statusMap.mind
      localStorage.setItem('ppc.mind', statusMap.mind)
      window.dispatchEvent(new CustomEvent('ppc:mind', { detail: statusMap.mind }))
    }
  }

  // 2. 处理交互消息 (Click/Idle/Back)
  let curTexts = {}
  try {
    const saved = localStorage.getItem('ppc.waifu.texts')
    if (saved) curTexts = JSON.parse(saved)
  } catch (e) {}

  let updated = false
  
  // 处理点击语
  if (data.click_messages) {
    const clickData = data.click_messages
    if (!Array.isArray(clickData) && typeof clickData === 'object') {
      if (clickData.head && Array.isArray(clickData.head)) {
        curTexts['click_head_01'] = clickData.head[0]
        curTexts['click_head_02'] = clickData.head[1]
      }
      if (clickData.chest && Array.isArray(clickData.chest)) {
        curTexts['click_chest_01'] = clickData.chest[0]
        curTexts['click_chest_02'] = clickData.chest[1]
      }
      if (clickData.body && Array.isArray(clickData.body)) {
        curTexts['click_body_01'] = clickData.body[0]
        curTexts['click_body_02'] = clickData.body[1]
      }
      updated = true
    }
  }

  // 处理挂机语
  if (data.idle_messages && Array.isArray(data.idle_messages)) {
    data.idle_messages.forEach((msg, i) => {
      curTexts[`idleMessages_0${i+1}`] = msg
    })
    updated = true
  }

  // 处理回归语
  if (data.back_messages && Array.isArray(data.back_messages)) {
    data.back_messages.forEach((msg, i) => {
      curTexts[`visibilityBack_0${i+1}`] = msg
    })
    updated = true
  }

  if (updated) {
    localStorage.setItem('ppc.waifu.texts', JSON.stringify(curTexts))
    window.dispatchEvent(new CustomEvent('ppc:waifu-texts-updated', { detail: curTexts }))
    window.WAIFU_TEXTS = curTexts
    localTexts.value = curTexts
  }
}

const lipSyncFrame = ref(null)

const stopAudioPlayback = (clearQueue = false) => {
    if (clearQueue) {
        audioQueue.value = []
        isAudioPlaying.value = false
    }
    
    if (currentAudioSource.value) {
        try {
            currentAudioSource.value.stop()
        } catch (e) {
            // ignore
        }
        currentAudioSource.value = null
    }
    isSpeaking.value = false
    stopLipSync()
}

const playAudio = async (base64Audio) => {
    if (!base64Audio) return
    
    // 将新音频加入队列
    audioQueue.value.push(base64Audio)
    
    // 如果当前没有在播放，则开始处理队列
    if (!isAudioPlaying.value) {
        processAudioQueue()
    }
}

const processAudioQueue = async () => {
    if (audioQueue.value.length === 0) {
        isAudioPlaying.value = false
        isSpeaking.value = false
        return
    }

    isAudioPlaying.value = true
    const base64Audio = audioQueue.value.shift()

    isSpeaking.value = true
    
    // 1. 准备 AudioContext
    let ctx = audioContext.value
    
    if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
        audioContext.value = ctx
    }
    
    // 确保 AudioContext 已恢复 (解决浏览器自动播放策略限制)
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume()
        } catch (e) {
            console.warn('[Pero] Failed to resume AudioContext:', e)
        }
    }
    
    // 2. 解码音频数据
    try {
        const binaryString = window.atob(base64Audio)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer)
        
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        currentAudioSource.value = source
        
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        
        source.connect(analyser)
        analyser.connect(ctx.destination)
        
        source.start(0)
        
        // 3. 启动口型同步
        startLipSync(analyser)
        
        source.onended = () => {
            currentAudioSource.value = null
            stopLipSync()
            source.disconnect()
            analyser.disconnect()
            
            // 播放完当前音频后，继续处理队列
            processAudioQueue()
        }
        
    } catch (e) {
        console.error('[Pero] Audio decode error:', e)
        // 发生错误时，也尝试播放下一条
        processAudioQueue()
    }
}

const startLipSync = (analyser) => {
  if (lipSyncFrame.value) cancelAnimationFrame(lipSyncFrame.value)
  
  const update = () => {
    if (!isSpeaking.value) {
      window.__pero_lip_sync_value = 0
      updateLive2DModelMouth(0)
      return
    }
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)
    
    let sum = 0
    const startBin = 4
    const endBin = Math.min(40, dataArray.length)
    
    for(let i = startBin; i < endBin; i++) {
        sum += dataArray[i]
    }
    const average = sum / (endBin - startBin)
    
    // 映射到 0-1. Average 是 0-255.
    // 再次增加增益系数，并增加基础值
    let volume = (average / 60) * 2.0 
    if (average > 10) volume = Math.max(volume, 0.2) // 只要有声音，嘴巴至少张开 20%
    volume = Math.min(1.0, Math.max(0, volume))
    
    // 调试：如果音量大于 0.1，打印一下
    if (volume > 0.1 && Math.random() > 0.9) {
        console.log('[Pero] LipSync Volume:', volume.toFixed(2), 'Average:', average.toFixed(2))
    }
    
    // 使用全局变量传递给 Hook
    window.__pero_lip_sync_value = volume
    
    lipSyncFrame.value = requestAnimationFrame(update)
  }
  update()
}

const stopLipSync = () => {
  if (lipSyncFrame.value) {
    cancelAnimationFrame(lipSyncFrame.value)
    lipSyncFrame.value = null
  }
  window.__pero_lip_sync_value = 0
  updateLive2DModelMouth(0)
}

const ensureMouthOverride = () => {
  // 1. 更加侵入式的模型查找逻辑
  const models = []
  
  // 尝试从不同的常见位置获取模型实例
  if (window.Live2D && window.Live2D.samples) {
      window.Live2D.samples.forEach(m => { if(m) models.push(m) })
  }
  
  // 检查全局变量
  ["live2dDisplay", "L2DTarget", "waifuModel"].forEach(key => {
      if (window[key] && !models.includes(window[key])) models.push(window[key])
  })
  
  // 如果还是没找到，尝试在 window 中扫描具有 setParamFloat 方法的对象
  if (models.length === 0) {
      for (const key in window) {
          try {
              if (window[key] && typeof window[key].setParamFloat === 'function' && typeof window[key].update === 'function') {
                  models.push(window[key])
                  console.log(`[Pero] Found potential model in window.${key}`)
              }
          } catch(e) {}
      }
  }

  if (models.length === 0) {
      // 如果完全没找到模型，尝试 Hook 构造函数或 loadlive2d
      if (window.loadlive2d && !window.loadlive2d._isHooked) {
          console.log('[Pero] Hooking window.loadlive2d to catch future models...')
          const origLoad = window.loadlive2d
          window.loadlive2d = function() {
              const res = origLoad.apply(this, arguments)
              // 加载后延迟一会尝试再次 Hook
              setTimeout(ensureMouthOverride, 1000)
              setTimeout(ensureMouthOverride, 3000)
              return res
          }
          window.loadlive2d._isHooked = true
      }
      
      // 循环重试，直到找到模型
      if (!window._pero_hook_retry_timer) {
          window._pero_hook_retry_timer = setInterval(ensureMouthOverride, 2000)
      }
      return
  }
  
  // 找到模型了，清除重试定时器
  if (window._pero_hook_retry_timer) {
      clearInterval(window._pero_hook_retry_timer)
      window._pero_hook_retry_timer = null
  }
  
  models.forEach(model => {
    // 防止重复 Hook
    if (model._mouthHooked) return
    
    // 将找到的模型存入全局，方便鼠标追踪逻辑调用
    if (!window._pero_models) window._pero_models = [];
    if (!window._pero_models.includes(model)) window._pero_models.push(model);
    
    console.log('[Pero] Lip-Sync: Installing hook for model', model)
    
    const core = model.live2DModel || model
    const possibleParams = ["PARAM_MOUTH_OPEN_Y", "PARAM_MOUTH_OPEN", "ParamMouthOpenY", "MouthOpenY"]
    let actualParam = "PARAM_MOUTH_OPEN_Y"
    
    // 识别可用参数
    if (core && core.getModelContext) {
        try {
            const ctx = core.getModelContext()
            if (ctx && ctx.getParamCount) {
                const count = ctx.getParamCount()
                const params = []
                for(let i=0; i<count; i++) {
                    params.push(ctx.getParamName(i))
                }
                const found = possibleParams.find(p => params.includes(p))
                if (found) actualParam = found
                console.log('[Pero] Lip-Sync: Detected params:', params, 'Using:', actualParam)
            }
        } catch (e) { console.warn('[Pero] Lip-Sync: Failed to inspect model params:', e) }
    } else if (core && core._parameterIds) { // Cubism 2.1 SDK
        const found = possibleParams.find(p => core._parameterIds.includes(p))
        if (found) actualParam = found
        console.log('[Pero] Lip-Sync: Detected Cubism 2.1 params, Using:', actualParam)
    }

    // 核心逻辑：覆盖所有可能的更新入口
    const hookMethod = (obj, methodName, pre = false) => {
        if (!obj || typeof obj[methodName] !== 'function') return
        const original = obj[methodName]
        obj[methodName] = function() {
            if (pre) applyMouthValue(model, actualParam)
            const result = original.apply(this, arguments)
            if (!pre) applyMouthValue(model, actualParam)
            return result
        }
    }

    // 1. Hook update (在动作更新后覆盖)
    hookMethod(model, 'update', false)
    
    // 2. Hook draw (在渲染前最后一刻覆盖)
    hookMethod(model, 'draw', true)
    if (model.live2DModel) {
        hookMethod(model.live2DModel, 'update', false)
        hookMethod(model.live2DModel, 'draw', true)
    }
    
    // 3. 极其暴力的 Hook: setParamFloat 和 setParameterValueByUsage (Cubism 4+)
    if (core) {
        const methods = ['setParamFloat', 'setParameterValueById', 'setParameterValueByIndex']
        methods.forEach(method => {
            if (typeof core[method] === 'function' && !core['_' + method]) {
                core['_' + method] = core[method]
                core[method] = function(id, val, weight) {
                    const currentLipSyncVal = window.__pero_lip_sync_value
                    if (typeof currentLipSyncVal === 'number' && currentLipSyncVal > 0) {
                        // 检查是否是嘴巴参数
                        let isMouth = false
                        if (typeof id === 'string') {
                            isMouth = (id === actualParam || id === "PARAM_MOUTH_OPEN_Y" || id === "PARAM_MOUTH_OPEN")
                        } else if (typeof id === 'number' && method === 'setParameterValueByIndex') {
                            // 如果是索引，这里比较难判断，先跳过或者通过实际名称映射
                        }
                        
                        if (isMouth) {
                            return core['_' + method].call(this, id, currentLipSyncVal, weight || 1)
                        }
                    }
                    return core['_' + method].call(this, id, val, weight)
                }
            }
        })
    }

    model._mouthHooked = true
  })

  function applyMouthValue(m, paramName) {
      const val = window.__pero_lip_sync_value
      if (typeof val === 'number' && val >= 0) {
          const c = m.live2DModel || m
          if (c && typeof c.setParamFloat === 'function') {
              c.setParamFloat(paramName, val, 1)
              c.setParamFloat("PARAM_MOUTH_OPEN_Y", val, 1)
              c.setParamFloat("PARAM_MOUTH_OPEN", val, 1)
          }
          if (c && typeof c.setParameterValueById === 'function') {
              c.setParameterValueById(paramName, val, 1)
          }
          if ('lipSyncValue' in m) m.lipSyncValue = val
      }
  }
}

const updateLive2DModelMouth = (value) => {
  window.__pero_lip_sync_value = value
  ensureMouthOverride()
}

const showToast = (msg) => {
    // 简单的提示，复用气泡
    const originalText = currentText.value
    currentText.value = msg
    setTimeout(() => {
        if (currentText.value === msg) {
            currentText.value = originalText
        }
    }, 2000)
}

const localTexts = ref({})
const loadLocalTexts = async () => {
  try {
    // 0. 尝试从后端同步最新配置 (新增)
    try {
        const syncRes = await fetch('http://localhost:9120/api/configs/waifu-texts')
        if (syncRes.ok) {
            const syncData = await syncRes.json()
            if (syncData && Object.keys(syncData).length > 0) {
                // 读取现有的 localStorage，避免覆盖非云端管理的字段
                let existing = {}
                try { existing = JSON.parse(localStorage.getItem('ppc.waifu.texts') || '{}') } catch(e) {}
                
                const merged = { ...existing, ...syncData }
                localStorage.setItem('ppc.waifu.texts', JSON.stringify(merged))
                console.log('[PetView] Synced waifu texts from backend')
            }
        }
    } catch (e) {
        console.warn('Failed to sync waifu texts from backend:', e)
    }

    // 1. 加载基础静态台词
    const response = await fetch('/live2d-widget/waifu-texts.json')
    const baseTexts = await response.json()
    
    // 2. 加载 localStorage 中的动态更新台词
    let dynamicTexts = {}
    try {
      const saved = localStorage.getItem('ppc.waifu.texts')
      if (saved) dynamicTexts = JSON.parse(saved)
    } catch (e) {
      console.warn('Failed to parse dynamic texts from localStorage:', e)
    }
    
    // 3. 合并台词 (动态台词覆盖基础台词)
    localTexts.value = { ...baseTexts, ...dynamicTexts }
    window.WAIFU_TEXTS = localTexts.value // 同步给 waifu-tips.js
    console.log('Local texts loaded (merged):', localTexts.value)
  } catch (err) {
    console.error('Failed to load local texts:', err)
  }
}

// 获取随机本地台词
const getRandomLocalText = (prefix) => {
  const keys = Object.keys(localTexts.value).filter(k => k.startsWith(prefix))
  if (keys.length === 0) return null
  const randomKey = keys[Math.floor(Math.random() * keys.length)]
  return localTexts.value[randomKey]
}

// --- 迁移自移动版的交互逻辑 ---

// 模拟震动反馈 (Desktop 方案)
const isShaking = ref(false)
const handleHaptic = () => {
  isShaking.value = true
  setTimeout(() => {
    isShaking.value = false
  }, 500)
}

// 状态更新处理器
const onMoodUpdate = (e) => { moodText.value = e.detail }
const onMindUpdate = (e) => { mindText.value = e.detail }
const onVibeUpdate = (e) => { vibeText.value = e.detail }
const onChatUpdate = (e) => { 
  if (e.detail && (e.detail === 'Pero正在思考中...' || e.detail.includes('思考中'))) {
    isThinking.value = true
    thinkingMessage.value = 'Pero正在努力思考...'
    currentText.value = ''
  } else {
    isThinking.value = false
    currentText.value = e.detail 
    lastAiReplyTime.value = Date.now()
    
    // 气泡至少显示 15 秒
    if (replyTimer) clearTimeout(replyTimer)
    replyTimer = setTimeout(() => {
      if (currentText.value === e.detail) {
        currentText.value = ''
      }
    }, 15000)
  }
}

// 接收来自 waifu-tips.js 的本地消息
const onWaifuMessage = (e) => {
  const { text, timeout, priority } = e.detail
  
  // 逻辑：
  // 1. 如果当前正在 AI 说话（isSpeaking），不显示本地消息
  // 2. 如果当前处于 AI 回复后的 15 秒保护期内：
  //    - 只有高优先级消息（触碰、点击，priority <= 8）可以覆盖
  //    - 普通挂机、回归消息（priority > 8）会被忽略
  
  const isProtected = (Date.now() - lastAiReplyTime.value) < 15000
  const isHighPriority = priority !== undefined && priority <= 8
  
  if (!isSpeaking.value) {
    if (isProtected && !isHighPriority) {
      console.log('[PetView] Ignoring low priority message during AI reply protection:', text)
      return
    }
    
    currentText.value = text
    
    // 如果是高优先级覆盖了 AI 回复，我们也重置保护期（或者不重置，取决于需求，这里选择重置以让位给触碰台词）
    if (isHighPriority && isProtected) {
      lastAiReplyTime.value = 0 
      if (replyTimer) clearTimeout(replyTimer)
    }

    setTimeout(() => {
      if (!isSpeaking.value && currentText.value === text) {
        currentText.value = ''
      }
    }, timeout || 4000)
  }
}

// 监听点击事件，改为本地反馈以节省 token
const handlePpcClick = () => {
  // 如果当前没有在说话，触发点击反馈
  if (!isSpeaking.value) {
    const localMsg = getRandomLocalText('click_messages')
    if (localMsg) {
      // 通过事件发送，统一处理逻辑
      window.dispatchEvent(new CustomEvent('waifu-message', { 
        detail: { text: localMsg, timeout: 4000, priority: 8 } 
      }))
    } else {
      // 兜底逻辑
      const clickPrompt = "【管理系统提醒：主人刚才摸了摸你/点击了你。请根据你现在的状态、情绪以及对主人的好感度，做出一个简短的、符合人设的即时反馈。可以是害羞、开心、撒娇或者调皮地吐槽。】"
      sendSystemMessage(clickPrompt)
    }
  }
}

// 发送系统/隐藏消息
const sendSystemMessage = (content) => {
  if (isSpeaking.value) return
  sendMessage(content, true)
}

// 解析 Pero 状态标签 (Mood/Mind/Vibe 等)
const parsePeroStatus = (content) => {
  if (!content) return
  
  const triggers = {}
  
  // 1. 解析 PEROCUE (状态机)
  const perocueMatch = content.match(/<PEROCUE>([\s\S]*?)<\/PEROCUE>/)
  if (perocueMatch) {
    try {
      triggers.state = JSON.parse(perocueMatch[1].trim())
    } catch (e) {
      console.error('Failed to parse PEROCUE JSON:', e)
    }
  }

  // 2. 解析其他消息标签 (CLICK/IDLE/BACK/FILE_RESULTS)
  const tags = [
    { regex: /<CLICK_MESSAGES>([\s\S]*?)<\/CLICK_MESSAGES>/, key: 'click_messages' },
    { regex: /<IDLE_MESSAGES>([\s\S]*?)<\/IDLE_MESSAGES>/, key: 'idle_messages' },
    { regex: /<BACK_MESSAGES>([\s\S]*?)<\/BACK_MESSAGES>/, key: 'back_messages' },
    { regex: /<FILE_RESULTS>([\s\S]*?)<\/FILE_RESULTS>/, key: 'file_results' }
  ]

  tags.forEach(tag => {
    const match = content.match(tag.regex)
    if (match) {
      try {
        const data = JSON.parse(match[1].trim())
        if (tag.key === 'file_results') {
           foundFiles.value = data
           showFileModal.value = true
        } else {
           triggers[tag.key] = data
        }
      } catch (e) {
        console.warn(`Failed to parse ${tag.key} JSON:`, e)
      }
    }
  })

  if (Object.keys(triggers).length > 0) {
    applyTriggers(triggers)
  }
}

// 清理消息内容，移除所有标签 (XML 和 NIT)
const cleanMessageContent = (text) => {
  if (!text) return ''
  return text
    .replace(/<([A-Z_]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/\[\[\[NIT_CALL\]\]\][\s\S]*?\[\[\[NIT_END\]\]\]/g, '')
    .trim()
}

// --- 结束迁移逻辑 ---

// 加载 Live2D 脚本
const loadLive2D = () => {
  return new Promise((resolve, reject) => {
    // 如果已经有 initWidget，说明之前加载过
    if (window.initWidget) {
      resolve()
      return
    }

    // 直接加载 autoload.js，由它负责后续资源的加载
    const autoload = document.createElement('script')
    autoload.src = '/live2d-widget/autoload.js'
    autoload.id = 'live2d-autoload'
    autoload.onload = () => {
      console.log('Live2D autoload.js loaded')
      resolve()
    }
    autoload.onerror = (e) => {
      console.error('Live2D autoload.js failed to load', e)
      reject(e)
    }
    document.body.appendChild(autoload)
  })
}


// 同步前端配置到后端
const syncConfigToBackend = async () => {
  try {
    const config = {
      'ppc.apiKey': localStorage.getItem('ppc.apiKey') || '',
      'ppc.apiBase': localStorage.getItem('ppc.apiBase') || 'https://api.openai.com',
      'ppc.modelName': localStorage.getItem('ppc.modelName') || 'gpt-3.5-turbo',
      'ppc.remoteEnabled': localStorage.getItem('ppc.remoteEnabled') || 'false',
      'ppc.remoteUrl': localStorage.getItem('ppc.remoteUrl') || ''
    }
    
    await fetch('http://localhost:9120/api/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    })
    console.log('Config synced to backend')
  } catch (err) {
    console.warn('Failed to sync config to backend:', err)
  }
}

// 欢迎语逻辑
const showWelcomeMessage = () => {
  const now = new Date().getHours()
  let prefix = 'welcome_timeRanges_'
  if (now > 5 && now <= 7) prefix += 'morningEarly'
  else if (now > 7 && now <= 11) prefix += 'morning'
  else if (now > 11 && now <= 13) prefix += 'noon'
  else if (now > 13 && now <= 17) prefix += 'afternoon'
  else if (now > 17 && now <= 19) prefix += 'eveningSunset'
  else if (now > 19 && now <= 21) prefix += 'night'
  else if (now > 21 && now <= 23) prefix += 'lateNight'
  else prefix += 'midnight'
  
  const welcomeMsg = getRandomLocalText(prefix)
  if (welcomeMsg) {
    currentText.value = welcomeMsg
    setTimeout(() => {
      if (!isSpeaking.value && currentText.value === welcomeMsg) {
        currentText.value = ''
      }
    }, 6000)
  }
}

onMounted(async () => {
   // Tauri Global Mouse Listener
   // Tauri Global Mouse Listener
   // if (window.__TAURI__) { // Removed obsolete check
       // const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke; // Use imported invoke
       invoke('set_fix_window_topmost').catch(e => console.error('Failed to set topmost:', e));

       listen('mouse-pos', async (event) => {
           if (isDragging.value) return;
           
           const { x, y } = event.payload;
           try {
               const outerPos = await appWindow.outerPosition();
               const scaleFactor = window.devicePixelRatio || 1;
               
               // Convert physical pixels (Rust/OS) to logical CSS pixels (Browser)
               const localX = (x - outerPos.x) / scaleFactor;
               const localY = (y - outerPos.y) / scaleFactor;

               // Synthetic Event for Live2D Eyes (Live2D typically expects coordinates relative to the canvas/window)
               // Note: If Live2D widget handles DPI internally, we might need to adjust. 
               // Usually standard MouseEvent clientX/Y are in CSS pixels.
               const mouseEventInit = {
                   clientX: localX,
                   clientY: localY,
                   screenX: x,
                   screenY: y,
                   pageX: localX,
                   pageY: localY,
                   bubbles: true,
                   cancelable: true
               };
               const mouseEvent = new MouseEvent('mousemove', mouseEventInit);
               window.dispatchEvent(mouseEvent);
               
               // 尝试直接派发给 canvas 以确保一些库能正确接收
               const canvas = document.querySelector('#live2d');
               if (canvas) {
                   canvas.dispatchEvent(new MouseEvent('mousemove', mouseEventInit));
                   
                   // 手动更新模型参数作为兜底
                   if (window._pero_models && window._pero_models.length > 0) {
                       const rect = canvas.getBoundingClientRect();
                       const canvasX = localX - rect.left;
                       const canvasY = localY - rect.top;
                       
                       // 归一化坐标 (-1 到 1)
                       const normX = (canvasX / rect.width) * 2 - 1;
                       const normY = 1 - (canvasY / rect.height) * 2;
                       
                       window._pero_models.forEach(model => {
                           // 针对不同版本的 Live2D SDK 尝试设置不同的目标变量
                           const target = model.live2DModel || model;
                           
                           // Cubism 2.1 风格
                           if ('dragX' in target) target.dragX = normX;
                           if ('dragY' in target) target.dragY = normY;
                           if ('faceTargetX' in target) target.faceTargetX = normX;
                           if ('faceTargetY' in target) target.faceTargetY = normY;
                           
                           // Cubism 4+ 风格 (如果使用了某些特定的 wrapper)
                           if (target.focus && typeof target.focus === 'function') {
                               target.focus(localX, localY);
                           }
                       });
                   }
               }

               // Hit Test
               if (showFileModal.value) { setIgnoreMouse(false); return; }

               let el = document.elementFromPoint(localX, localY);
                
                // [Fix] 增加兜底逻辑：如果 elementFromPoint 没拿到元素（可能因为透明度或层级问题），
                // 但坐标在角色区域或 PTT 区域内，则尝试手动判定
                if (!el) {
                    const wrapper = document.querySelector('.character-wrapper');
                    if (wrapper) {
                        const rect = wrapper.getBoundingClientRect();
                        if (localX >= rect.left && localX <= rect.right && 
                            localY >= rect.top && localY <= rect.bottom) {
                            el = wrapper;
                        }
                    }
                    
                    // 额外检查 PTT 按钮区域
                    if (voiceMode.value === 2 && showInput.value) {
                        const ptt = document.querySelector('.ptt-container');
                        if (ptt) {
                            const rect = ptt.getBoundingClientRect();
                            if (localX >= rect.left && localX <= rect.right && 
                                localY >= rect.top && localY <= rect.bottom) {
                                el = ptt;
                            }
                        }
                    }
                }

                if (el) {
                   // 1. Check UI elements first (High Priority)
                   const isUI = el.closest('.input-overlay') || 
                                el.closest('.floating-trigger') ||
                                el.closest('.bubble') ||
                                el.closest('.status-tags') ||
                                el.closest('.pet-tools') ||
                                el.closest('.ptt-container') ||
                                el.closest('.task-monitor-modal') ||
                                el.closest('.file-search-modal');
                   
                   if (isUI) {
                       setIgnoreMouse(false);
                       return;
                   }

                   // 2. Check character area with pixel transparency
                   const isCharacter = el.tagName === 'CANVAS' || 
                                       el.id === 'live2d' ||
                                       el.classList.contains('character-wrapper') || 
                                       el.closest('.character-wrapper') ||
                                       el.closest('.pet-avatar-container');
                   
                   if (isCharacter) {
                       const canvas = document.querySelector('#live2d');
                       if (canvas) {
                           const rect = canvas.getBoundingClientRect();
                           const canvasX = localX - rect.left;
                           const canvasY = localY - rect.top;

                           if (canvasX >= 0 && canvasX <= rect.width && canvasY >= 0 && canvasY <= rect.height) {
                               const ctx = canvas.getContext('2d', { willReadFrequently: true });
                               if (ctx) {
                                   try {
                                        const pixel = ctx.getImageData(Math.floor(canvasX), Math.floor(canvasY), 1, 1).data;
                                        // [Fix] 更加宽松的透明度判定，Alpha > 5 就认为点到了角色
                                        const isTransparent = pixel[3] < 5; 
                                        setIgnoreMouse(isTransparent);
                                        return;
                                    } catch (e) {
                                       // ImageData 可能失败，回退到非穿透
                                       setIgnoreMouse(false);
                                       return;
                                   }
                               }
                           }
                       }
                       // 如果没找到 canvas 或者 canvas 检查没通过，但确实在角色区域，则不穿透
                       setIgnoreMouse(false);
                   } else {
                       // 既不是 UI 也不是角色，穿透
                       setIgnoreMouse(true);
                   }
               } else {
                   // 没点到任何东西，穿透
                   setIgnoreMouse(true);
               }
           } catch(e) { console.error(e); }
       });
   // }

   // 默认开启穿透
    // setIgnoreMouse(true) // Removed to avoid duplication
    
    console.log('PetView mounted, starting Live2D load...')

  // 加载本地台词
  await loadLocalTexts()

  // [Fix] 立即同步一次后端状态，并开启轮询
  await fetchPetState()
  setInterval(fetchPetState, 30000)
  
  // 显示欢迎语
   showWelcomeMessage()
   
   // 同步配置
  await syncConfigToBackend()
  
  // 注册交互监听
  window.addEventListener('ppc:mood', onMoodUpdate)
  window.addEventListener('ppc:mind', onMindUpdate)
  window.addEventListener('ppc:vibe', onVibeUpdate)
  window.addEventListener('ppc:chat', onChatUpdate)
  window.addEventListener('waifu-message', onWaifuMessage)
  
  try {
    // 1. 清理可能存在的旧元素（处理 HMR 热更新）
    const oldWaifu = document.getElementById('waifu')
    if (oldWaifu) {
      console.log('Cleaning up old waifu element')
      oldWaifu.remove()
    }

    // 2. 检查是否已经加载过脚本，如果没有则加载
    await loadLive2D()
    
    // 3. 如果脚本已经加载过（initWidget 已存在），手动触发一次初始化
    // 因为单页应用切回来时，autoload.js 不会重新运行
    if (window.initWidget && !document.getElementById('waifu')) {
      console.log('initWidget exists, but waifu element missing. Re-initializing...')
      window.initWidget({ 
        waifuPath: "/live2d-widget/waifu-texts.json", 
        cdnPath: "/live2d-widget/" 
      })
    }

    // 4. 轮询检查 waifu 元素是否已生成并移动它
    let attempts = 0
    const timer = setInterval(() => {
      attempts++
      const waifu = document.getElementById('waifu')
      const container = document.getElementById('waifu-container')
      
      if (waifu && container) {
        console.log('Found waifu element, moving to container')
        container.appendChild(waifu)
        waifu.style.position = 'relative'
        waifu.style.bottom = '0'
        waifu.style.display = 'block'
        waifu.style.zIndex = '10'
        
        // 隐藏自带的工具栏和提示框，我们用自己的
        const tool = document.getElementById('waifu-tool')
        if (tool) tool.style.display = 'none'
        const tips = document.getElementById('waifu-tips')
        if (tips) tips.style.display = 'none'
        
        const canvas = document.getElementById('live2d')
        if (canvas) {
          canvas.style.width = '300px'
          canvas.style.height = '300px'
          // 确保 canvas 能够响应点击
          canvas.style.pointerEvents = 'auto'
          // [Fix] 增加拖拽属性，确保点击角色本体可以拖动窗口
          canvas.setAttribute('data-tauri-drag-region', '')
        }
        
        isLoading.value = false
        clearInterval(timer)
      }
      
      if (attempts > 100) { // 10秒超时
        console.warn('Live2D initialization timeout')
        isLoading.value = false
        clearInterval(timer)
      }
    }, 100)
    
  } catch (err) {
    console.error('Failed to load Live2D:', err)
    isLoading.value = false
  }
})
// 设置鼠标穿透状态
 const setIgnoreMouse = (ignore) => {
   // Tauri Implementation
   // Tauri Implementation
   // if (window.__TAURI__) {
       if (window._lastIgnoreState === ignore) return;
       console.log('Setting ignore mouse to:', ignore);
       window._lastIgnoreState = ignore;
       invoke('set_ignore_mouse', { ignore }).catch(e => console.error("set_ignore_mouse failed", e));
       return;
   // }
 }
 
 // 区分点击和拖动
let mouseDownTime = 0
let lastX = 0
let lastY = 0
let startX = 0
let startY = 0
const isDragging = ref(false)

const toggleUI = () => {
  showInput.value = !showInput.value
  if (showInput.value) {
    setTimeout(() => inputRef.value?.focus(), 100)
  }
  handleHaptic()
}

const handleDblClick = (e) => {
  // 彻底拦截双击事件，防止触发原生窗口的最大化
  e.preventDefault();
  e.stopPropagation();
  console.log('Intercepted double click to prevent fullscreen');
}

const handleMouseDown = async (e) => {
  console.log('MouseDown triggered on character-wrapper', e.target.className);
  // 如果点击的是输入框、按钮、状态标签或浮动触发器，不处理
  if (
    e.target.closest('.chat-input') || 
    e.target.closest('.tool-btn') || 
    e.target.closest('.status-tags') ||
    e.target.closest('.floating-trigger') ||
    e.target.closest('.task-detail-modal') ||
    e.target.closest('.modal-card') ||
    e.target.closest('.monitor-window') || 
    e.target.closest('.task-monitor-modal') ||
    e.target.closest('.ptt-container')
  ) return
  
  // 强制调用一次 setIgnoreMouse(false)，确保窗口现在可以接收后续事件
  setIgnoreMouse(false);

  // 立即尝试启动原生拖拽
  try {
    console.log('Attempting to start dragging...');
    await appWindow.startDragging();
  } catch (err) {
    console.error('startDragging failed:', err);
  }

  // 记录按下时的位置和时间，用于判定点击
  mouseDownTime = Date.now()
  startX = e.screenX
  startY = e.screenY
  
  // 标记可能进入拖拽状态
  isDragging.value = true

  // 监听全局 mouseup 处理点击事件
  const onMouseUp = (upEvent) => {
    window.removeEventListener('mouseup', onMouseUp)
    isDragging.value = false
    console.log('MouseUp triggered');

    const duration = Date.now() - mouseDownTime
    const totalDeltaX = Math.abs(upEvent.screenX - startX)
    const totalDeltaY = Math.abs(upEvent.screenY - startY)
    
    // 只有在位移非常小且时间非常短的情况下，才判定为点击
    if (duration < 200 && totalDeltaX < 5 && totalDeltaY < 5) {
      handleHaptic()
      handlePpcClick()
    }
  }
  
  window.addEventListener('mouseup', onMouseUp)
}

const randTextures = () => {
   if (window.WaifuWidget && window.WaifuWidget.loadRandModel) {
     window.WaifuWidget.loadRandModel()
   } else if (window.loadRandModel) {
     window.loadRandModel()
   } else {
     console.warn('loadRandModel not found')
   }
 }
 
 const switchModel = () => {
   if (window.WaifuWidget && window.WaifuWidget.loadOtherModel) {
     window.WaifuWidget.loadOtherModel()
   } else if (window.loadOtherModel) {
     window.loadOtherModel()
   } else {
     console.warn('loadOtherModel not found')
   }
 }

const reloadPet = () => {
  window.location.reload()
}

const openDashboard = () => {
  invoke('open_dashboard').catch(e => console.error(e))
}

const sendMessage = async (systemMsg = null, isHidden = false) => {
  const userMsg = typeof systemMsg === 'string' ? systemMsg : userInput.value
  if (!userMsg.trim()) return
  
  if (!isHidden) {
    userInput.value = ''
    showInput.value = false
  }
  
  // 发送新消息时，停止当前播放并清空队列
  stopAudioPlayback(true)
  
  isSpeaking.value = true
  isThinking.value = true
  currentText.value = ''
  
  // 发送“正在思考”状态
  window.dispatchEvent(new CustomEvent('ppc:chat', { detail: 'Pero正在思考中...' }))
  
  // 优先使用 localStorage 中的 sessionId，如果没有则默认为 'default'
  let desktopSessionId = localStorage.getItem('ppc.sessionId') || 'default'
  
  // 强制修正：如果 sessionId 不符合规范（例如是旧版本的 UUID 格式），则重置为 'default'
  // 这里我们认为规范的 sessionId 应该是 'default' 或 'voice_session'，或者至少不是纯 UUID
  const isLegacyId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(desktopSessionId)
  if (isLegacyId || !['default', 'voice_session'].includes(desktopSessionId)) {
    console.log('Resetting legacy or invalid sessionId:', desktopSessionId)
    desktopSessionId = 'default'
    localStorage.setItem('ppc.sessionId', 'default')
  }
  
  if (!localStorage.getItem('ppc.sessionId')) {
    localStorage.setItem('ppc.sessionId', desktopSessionId)
  }

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (authToken.value) {
        headers['Authorization'] = `Bearer ${authToken.value}`
    }

    const response = await fetch('http://localhost:9120/api/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: userMsg }],
        source: 'desktop',
        session_id: desktopSessionId
      })
    })

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // 保留最后一行（可能是不完整的）
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.slice(6).trim()
          if (dataStr === '[DONE]') continue
          try {
            const data = JSON.parse(dataStr)
            
            // 处理音频数据
            if (data.audio) {
              console.log('[Pero] Received audio data in SSE')
              playAudio(data.audio)
              continue
            }

            // [New] 实时处理状态触发器
            if (data.triggers) {
              console.log('[Pero] Received real-time triggers:', data.triggers)
              applyTriggers(data.triggers)
              continue
            }

            // 处理状态更新 (MCP/工具调用)
            if (data.status) {
              const { type, message } = data.status
              console.log(`[Pero] Status update: [${type}] ${message}`)
              // 如果还没有正式文本内容，就在气泡显示状态
              if (!fullText) {
                currentText.value = message
                isThinking.value = true
              }
              continue
            }

            const content = data.choices[0]?.delta?.content || ''
            if (content) {
              isThinking.value = false
              fullText += content
              const filteredFullText = fullText.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/<[^>]*>?/g, '')
              currentText.value = filteredFullText
            }
          } catch (e) {
            // 解析失败可能是因为行还不完整，但在 split('\n') 逻辑下通常不会发生
            console.warn('Failed to parse SSE data:', trimmedLine, e)
          }
        }
      }
    }
    
    // 解析状态和记忆
    parsePeroStatus(fullText)
    
    // 最终清理文本并显示
    const cleanText = cleanMessageContent(fullText)
    isThinking.value = false
    currentText.value = cleanText || '主人，我刚才好像走神了...'
    
    // 触发气泡更新
    window.dispatchEvent(new CustomEvent('ppc:chat', { detail: currentText.value }))

    // 同步助手回复到 IDE
    emit('sync-chat-to-ide', { role: 'assistant', content: currentText.value }).catch(e => console.error(e))

  } catch (err) {
    console.error('Failed to send message:', err)
    isThinking.value = false
    currentText.value = '哎呀，网络好像出了一点小状况...'
  } finally {
    // isSpeaking.value = false // Don't force stop speaking, as audio might be playing
    isThinking.value = false
  }
}

onUnmounted(() => {
  // 1. 清理定时器
  if (replyTimer) clearTimeout(replyTimer)
  
  // 2. 移除交互监听
  window.removeEventListener('keydown', handleGlobalKeyDown)
  window.removeEventListener('keyup', handleGlobalKeyUp)
  window.removeEventListener('ppc:mood', onMoodUpdate)
  window.removeEventListener('ppc:mind', onMindUpdate)
  window.removeEventListener('ppc:vibe', onVibeUpdate)
  window.removeEventListener('ppc:chat', onChatUpdate)
  window.removeEventListener('waifu-message', onWaifuMessage)

  // 3. 停止语音模式和清理资源
  stopVoiceMode()
  stopAudioPlayback(true)
  stopLipSync()
  
  console.log('PetView unmounted and cleaned up.')
})
</script>

<style scoped>
.pet-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent !important;
  pointer-events: none; /* 允许点击穿透到桌面 */
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  margin: 0 !important;
  padding: 0 !important;
}

.character-wrapper {
  position: relative;
  pointer-events: auto; /* 仅角色区域响应点击 */
  cursor: grab;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: transform 0.2s;
  user-select: none;
  -webkit-app-region: drag;
}

.character-wrapper.dragging {
  cursor: grabbing;
}

.character-wrapper.shake {
  animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
}

/* 极简灵动触发器 */
.floating-trigger {
  position: absolute;
  right: 5px;
  top: 55%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  -webkit-app-region: no-drag;
}

.trigger-core {
  position: relative;
  width: 14px;
  height: 14px;
  transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.core-dot {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  transition: all 0.4s ease;
  box-shadow: 
    0 0 15px rgba(255, 255, 255, 0.6),
    0 0 5px rgba(255, 136, 170, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.pulse-ring {
  position: absolute;
  top: -100%;
  left: -100%;
  width: 300%;
  height: 300%;
  border: 1px solid rgba(255, 136, 170, 0.3);
  border-radius: 50%;
  opacity: 0;
  animation: pulse-ring 3s infinite cubic-bezier(0.215, 0.61, 0.355, 1);
}

@keyframes pulse-ring {
  0% { transform: scale(0.1); opacity: 0; }
  50% { opacity: 0.6; }
  100% { transform: scale(1.2); opacity: 0; }
}

.floating-trigger:hover .core-dot {
  background: #ffffff;
  transform: scale(1.4);
  box-shadow: 
    0 0 20px rgba(255, 255, 255, 1),
    0 0 10px rgba(255, 136, 170, 0.6);
}

.floating-trigger.active .trigger-core {
  transform: scale(1.3) rotate(180deg);
}

.floating-trigger.active .core-dot {
  background: #ffffff;
  border-radius: 4px; 
  box-shadow: 0 0 20px rgba(255, 136, 170, 0.5);
  border-color: #ff88aa;
}

.floating-trigger.active .pulse-ring {
  animation: pulse-ring-active 2s infinite ease-out;
}

@keyframes pulse-ring-active {
  0% { transform: scale(0.5); opacity: 0.8; border-color: rgba(255, 136, 170, 0.5); }
  100% { transform: scale(1.5); opacity: 0; border-color: rgba(255, 136, 170, 0); }
}

@keyframes shake {
  10%, 90% { transform: translate3d(-0.5px, 0, 0); }
  20%, 80% { transform: translate3d(1px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-1px, 0, 0); }
  40%, 60% { transform: translate3d(1px, 0, 0); }
}

/* 状态标签样式 */
.status-tags {
  position: absolute;
  left: -140px;
  top: 30px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  perspective: 1000px;
  align-items: flex-end;
}

.status-tag {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: #ff6699;
  border: 1px solid rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  box-shadow: 
    0 4px 15px rgba(255, 136, 170, 0.15),
    inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  cursor: default;
  animation: float-tag 4s infinite ease-in-out;
}

.status-tag:hover {
  transform: translateX(-5px) scale(1.05);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 25px rgba(255, 136, 170, 0.25);
  max-width: 240px;
  white-space: normal;
  z-index: 110;
}

.status-tag.mood {
  animation-delay: 0s;
  background: linear-gradient(135deg, rgba(255, 240, 245, 0.8), rgba(255, 220, 230, 0.8));
}

.status-tag.vibe {
  animation-delay: -1.3s;
  background: linear-gradient(135deg, rgba(240, 248, 255, 0.8), rgba(220, 235, 255, 0.8));
  color: #6699ff;
  border-color: rgba(200, 230, 255, 0.5);
}

.status-tag.mind {
  animation-delay: -2.6s;
  background: linear-gradient(135deg, rgba(245, 255, 240, 0.85), rgba(225, 250, 220, 0.85));
  color: #449977;
  border-color: rgba(200, 250, 220, 0.5);
  white-space: normal;
  max-width: 180px;
  word-break: break-all;
  line-height: 1.5;
  padding: 10px 16px;
  border-radius: 20px 20px 4px 20px;
  align-items: flex-start;
  text-overflow: clip;
}

.status-tag.mind:hover {
  max-width: 220px;
  transform: translateX(-10px) scale(1.02);
}

@keyframes float-tag {
  0%, 100% { transform: translateY(0) rotate(0); }
  33% { transform: translateY(-3px) rotate(1deg); }
  66% { transform: translateY(2px) rotate(-1deg); }
}

.pet-avatar-container {
  width: 400px;
  height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  position: relative;
}

.loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #ffccdd;
  animation: pulse 1.5s infinite;
}

.loading-icon {
  width: 60px;
  height: 60px;
  margin-bottom: 10px;
  opacity: 0.7;
}

.loading-text {
  font-size: 12px;
  font-weight: bold;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
}

#waifu {
  width: 400px;
  height: 400px;
  display: none; /* 初始隐藏，直到被移动到容器 */
}

#live2d {
  cursor: grab;
}

#live2d:active {
  cursor: grabbing;
}

.bubble {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 14px 20px;
  border-radius: 24px;
  margin-bottom: -10px;
  z-index: 100;
  max-width: 240px;
  box-shadow: 
    0 10px 40px rgba(255, 136, 170, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.4);
  position: relative;
  -webkit-app-region: no-drag;
  border: none;
  animation: bubble-float 3s infinite ease-in-out;
  display: flex;
  flex-direction: column;
  transition: max-height 0.3s ease;
}

.bubble.expanded {
  /* 展开时允许更高的高度，或者不限制 */
  max-height: 500px;
  overflow-y: auto;
}

/* 隐藏滚动条但保留功能 */
.bubble.expanded::-webkit-scrollbar {
  width: 4px;
}
.bubble.expanded::-webkit-scrollbar-thumb {
  background: rgba(255, 136, 170, 0.3);
  border-radius: 2px;
}

.bubble-scroll-area {
  max-height: 200px; /* 默认最大高度 */
  overflow: hidden;
  transition: max-height 0.3s ease;
  position: relative;
}

.bubble.expanded .bubble-scroll-area {
  max-height: 500px; /* 展开后的最大高度 */
  overflow-y: auto;
}

/* 遮罩效果，提示还有内容 (可选，配合 CSS mask 使用更佳) */
/* .bubble-scroll-area::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 40px;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.9));
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
} */
/* 只有在溢出且未展开时显示遮罩，这需要 JS 控制 class，暂时省略 */

.bubble-expand-btn {
  font-size: 12px;
  color: #ff6699;
  text-align: center;
  margin-top: 8px;
  cursor: pointer;
  padding-top: 4px;
  border-top: 1px dashed rgba(255, 136, 170, 0.3);
  user-select: none;
  transition: all 0.2s;
}

.bubble-expand-btn:hover {
  color: #ff3366;
  font-weight: bold;
}

.text-content {
  font-size: 14px;
  line-height: 1.6;
  color: #4a5568;
  word-break: break-all;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  font-weight: 500;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
}

.thinking-text {
  color: #888;
  font-style: italic;
  display: flex;
  align-items: center;
}

.thinking-text::after {
  content: "...";
  display: inline-block;
  width: 12px;
  animation: thinking-dots 1.5s infinite;
}

.thinking-details {
  margin: 4px 0;
  border: 1px dashed rgba(136, 136, 136, 0.3);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.4);
  font-size: 12px;
}

.thinking-summary {
  cursor: pointer;
  padding: 4px 8px;
  color: #888;
  user-select: none;
  font-size: 12px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.thinking-summary:hover {
  opacity: 1;
}

.thinking-body {
  padding: 4px 8px 8px 8px;
  color: #666;
  white-space: pre-wrap;
  font-family: Consolas, Monaco, "Andale Mono", monospace;
  font-size: 11px;
  line-height: 1.4;
  border-top: 1px dashed rgba(136, 136, 136, 0.1);
}

.action-text {
  color: #888;
  font-style: italic;
  font-size: 0.95em;
  margin: 0 2px;
}

@keyframes thinking-dots {
  0% { content: "."; }
  33% { content: ".."; }
  66% { content: "..."; }
}

.bubble-tail {
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 12px;
  overflow: hidden;
}

.bubble-tail::after {
  content: '';
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 16px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  border-radius: 4px;
  transform: rotate(45deg) translateX(-70%);
  box-shadow: 2px 2px 5px rgba(255, 136, 170, 0.1);
}

@keyframes bubble-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

.input-overlay {
  margin-top: 15px;
  -webkit-app-region: no-drag;
  perspective: 1000px;
}

.chat-input {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: 1.5px solid rgba(255, 136, 170, 0.4);
  border-radius: 24px;
  padding: 10px 22px;
  width: 220px;
  outline: none;
  font-size: 14px;
  font-weight: 500;
  color: #d6336c; /* 更深一些的粉紫色，提升可读性 */
  box-shadow: 
    0 8px 25px rgba(255, 136, 170, 0.2),
    inset 0 0 10px rgba(255, 255, 255, 0.5);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.chat-input::placeholder {
  color: rgba(214, 51, 108, 0.5); /* 对应加深的占位符颜色 */
  font-weight: 400;
}

.chat-input:focus {
  width: 260px;
  background: rgba(255, 255, 255, 0.95);
  border-color: #ff6699;
  box-shadow: 
    0 10px 30px rgba(255, 136, 170, 0.35),
    0 0 0 4px rgba(255, 136, 170, 0.15);
  transform: translateY(-2px);
  color: #c2185b;
}

.pet-tools {
  position: absolute;
  right: -50px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 10px;
  border-radius: 24px;
  -webkit-app-region: no-drag;
  box-shadow: 
    0 8px 32px rgba(255, 136, 170, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.tool-btn {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.5);
  width: 36px;
  height: 36px;
  border-radius: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
  color: #ff6699;
}

.tool-btn:hover {
  transform: scale(1.15) rotate(5deg);
  background: #ffffff;
  box-shadow: 0 6px 15px rgba(255, 136, 170, 0.3);
  color: #ff3366;
}

.tool-btn:active {
  transform: scale(0.95);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.5s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* PTT 样式 */
.ptt-container {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: auto;
}

.ptt-button {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  width: 50px;
  height: 50px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
}

.ptt-button:hover {
  background: rgba(0, 0, 0, 0.7);
  transform: scale(1.1);
  border-color: #ff99cc;
  box-shadow: 0 6px 15px rgba(255, 136, 170, 0.4);
}

.ptt-button:active, .ptt-button.recording {
  background: #ff6699;
  border-color: white;
  transform: scale(0.95);
  box-shadow: 0 0 20px rgba(255, 102, 153, 0.6);
}

.ptt-icon {
  font-size: 24px;
}

.voice-btn.active.mode-vad {
  color: #ff99cc;
}

.voice-btn.active.mode-ptt {
  color: #5fb878;
}

/* --- Complex Task & Modal Styles --- */

.complex-task-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  border: 1px solid rgba(255, 136, 170, 0.2);
  box-shadow: 0 4px 15px rgba(255, 136, 170, 0.1);
  min-width: 200px;
}

.complex-task-summary:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 8px 20px rgba(255, 136, 170, 0.2);
  border-color: rgba(255, 136, 170, 0.5);
}

.complex-task-summary:active {
  transform: scale(0.98);
}

.summary-icon {
  font-size: 22px;
  background: linear-gradient(135deg, #fff0f5 0%, #ffe6ee 100%);
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.8);
}

.summary-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.summary-title {
  font-size: 13px;
  font-weight: bold;
  color: #4a5568;
  margin-bottom: 2px;
}

.summary-hint {
  font-size: 11px;
  color: #ff6699;
  opacity: 0.8;
}

/* Modal Styles */
.task-detail-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: transparent; /* 移除全屏半透明背景，避免显示巨大的矩形边框 */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999; /* Ensure it's on top of everything */
  pointer-events: auto;
}

.modal-card {
  background: rgba(255, 255, 255, 0.98);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  border-radius: 24px;
  box-shadow: 
    0 20px 50px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes modal-pop {
  0% { transform: scale(0.9) translateY(20px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

.modal-header {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(to right, #fffafa, #fff);
}

.modal-title {
  font-size: 16px;
  font-weight: bold;
  color: #333;
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #ccc;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: all 0.2s;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.close-btn:hover {
  color: #ff6699;
  background: rgba(255, 102, 153, 0.1);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  font-size: 15px;
  line-height: 1.7;
  color: #2d3748;
}

.modal-body::-webkit-scrollbar {
  width: 8px;
}

.modal-body::-webkit-scrollbar-track {
  background: transparent;
}

.modal-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

/* Thinking Block in Modal */
.thinking-block {
  margin: 16px 0;
  background: #f8f9fa;
  border-radius: 12px;
  border: 1px solid #e9ecef;
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
}

.thinking-label {
  padding: 8px 16px;
  background: #eef1f5;
  font-size: 12px;
  font-weight: bold;
  color: #6c757d;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  gap: 6px;
}

.thinking-content {
  padding: 16px;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 13px;
  color: #495057;
  white-space: pre-wrap;
  background: #fafbfc;
}</style>
