<template>
  <div class="pet-3d-container">
    <!-- 3D Avatar Component -->
    <!-- 3D 角色组件 -->
    <BedrockAvatar 
      ref="avatarRef" 
      @pet="onPet"
      @hover-start="onHoverStart"
      @hover-end="onHoverEnd"
    />
    
    <!-- UI Overlay -->
    <!-- UI 覆盖层 -->
    <div class="ui-overlay" @mouseenter="onUIEnter" @mouseleave="onUILeave">
       <!-- Status Tags (Top Left) -->
       <!-- 状态标签 (左上角) -->
       <transition name="fade">
         <div class="status-tags" v-show="showInput">
            <div class="status-tag mood" :title="'情绪: ' + moodText">❤️ {{ moodText }}</div>
            <div class="status-tag vibe" :title="'氛围: ' + vibeText">✨ {{ vibeText }}</div>
            <div class="status-tag mind" :title="'内心: ' + mindText">💭 {{ mindText }}</div>
         </div>
       </transition>

      <!-- Floating Trigger (Light Orb) -->
      <!-- 悬浮触发器 (光球) -->
      <div 
        class="floating-trigger" 
        :class="{ active: showInput }"
        @click.stop="toggleUI"
        style="-webkit-app-region: no-drag;"
        @mouseenter="onUIEnter"
        @mouseleave="onUILeave"
      >
        <div class="trigger-core">
          <div class="pulse-ring"></div>
          <div class="core-dot"></div>
        </div>
      </div>

      <!-- Input Overlay -->
      <!-- 输入覆盖层 -->
      <div class="input-overlay" v-show="showInput" @mouseenter="onUIEnter">
        <input 
          ref="inputRef"
          v-model="userInput" 
          @keyup.enter="sendMessage"
          :placeholder="isWorkMode ? '工作模式下已禁用输入' : `跟 ${currentAgentName} 对话...`"
          class="chat-input"
          :disabled="isThinking || isWorkMode"
          style="-webkit-app-region: no-drag;"
        />
      </div>

      <!-- Avatar Tools -->
      <!-- 角色工具 -->
      <div class="pet-tools" v-show="showInput" style="-webkit-app-region: no-drag;" @mouseenter="onUIEnter">
        <button class="tool-btn" @click.stop="toggleAppearanceMenu" title="外观设置" :class="{ active: showAppearanceMenu }">🎨</button>
        <button class="tool-btn" @click.stop="reloadPet" title="重载">🔄</button>
        <button class="tool-btn" @click.stop="toggleWindowSize" title="调整大小">📏</button>
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
        <button class="tool-btn" @click.stop="openChatWindow" title="聊天">💬</button>
        <button class="tool-btn" @click.stop="openDashboard" title="面板">⚙️</button>
      </div>

      <!-- PTT Floating Button (Voxel Style) -->
      <!-- PTT 悬浮按钮 (体素风格) -->
      <transition name="fade">
        <div 
          v-if="voiceMode === 2" 
          class="ptt-voxel-container"
          @mousedown.stop="startPTT"
          @mouseup.stop="stopPTT"
          @mouseleave.stop="stopPTT"
          style="-webkit-app-region: no-drag;"
        >
          <div class="ptt-voxel-btn" :class="{ recording: isPTTRecording }" title="按住 Alt+Shift+V 说话">
            <span class="ptt-icon">🎙️</span>
            <span class="ptt-text" v-if="isPTTRecording">LISTENING...</span>
          </div>
        </div>
      </transition>

      <!-- Appearance Menu (Voxel Style) -->
      <!-- 外观菜单 (体素风格) -->
      <transition name="fade">
        <div class="appearance-menu" v-if="showAppearanceMenu && showInput" @mouseenter="onUIEnter">
          <div class="menu-header">
            <span>外观控制</span>
            <button class="close-mini-btn" @click="showAppearanceMenu = false">×</button>
          </div>
          
          <div class="menu-section" v-if="avatarRef && avatarRef.clothingState">
            <div class="menu-label">服装部件</div>
            <label class="voxel-checkbox">
              <input type="checkbox" v-model="avatarRef.clothingState.dress" @change="avatarRef.updateClothing()">
              <span class="checkmark"></span>
              Dress
            </label>
            <label class="voxel-checkbox">
              <input type="checkbox" v-model="avatarRef.clothingState.armour" @change="avatarRef.updateClothing()">
              <span class="checkmark"></span>
              Armour
            </label>
            <label class="voxel-checkbox">
              <input type="checkbox" v-model="avatarRef.clothingState.hat" @change="avatarRef.updateClothing()">
              <span class="checkmark"></span>
              Hat
            </label>
            <label class="voxel-checkbox">
              <input type="checkbox" v-model="avatarRef.clothingState.underwear" @change="avatarRef.updateClothing()">
              <span class="checkmark"></span>
              Underwear
            </label>
             <label class="voxel-checkbox">
              <input type="checkbox" v-model="avatarRef.clothingState.censored" @change="avatarRef.updateClothing()">
              <span class="checkmark"></span>
              Censored
            </label>
          </div>

          <div class="menu-section" v-if="avatarRef && avatarRef.animList && avatarRef.animList.length > 0">
            <div class="menu-label">动作调试</div>
            <select class="voxel-select" @change="(e) => avatarRef.setAnimation(e.target.value)">
              <option value="">-- 选择动作 --</option>
              <option v-for="anim in avatarRef.animList" :key="anim" :value="anim">{{ anim }}</option>
            </select>
          </div>
        </div>
      </transition>

       <!-- 移除了 mode="out-in" 以允许快速点击时立即替换 -->
       <transition name="bubble-fade">
        <div 
          v-if="currentText || isThinking" 
          :key="bubbleKey"
          class="bubble" 
          :class="{ expanded: isBubbleExpanded }"
          :style="{ top: bubbleTop, left: bubbleLeft }"
        >
          <div class="bubble-content" :class="{ 'cursor-pointer': isThinking }" @mousedown.stop>
             <template v-if="isThinking">
               <span class="thinking-text">{{ thinkingMessage }}</span>
             </template>
             <template v-else>
               <div class="bubble-scroll-area" ref="bubbleScrollArea">
                 <div v-for="(segment, index) in parsedBubbleContent" :key="index" class="bubble-segment">
                   <span v-if="segment.type === 'text'">{{ segment.content }}</span>
                   <span v-else-if="segment.type === 'action'" class="action-text">*{{ segment.content }}*</span>
                   <div v-else-if="segment.type === 'thinking'" class="thinking-block">
                     <div class="thinking-label">💭 思考过程</div>
                     <div class="thinking-content">{{ segment.content }}</div>
                   </div>
                 </div>
               </div>
               <div v-if="isContentOverflowing" class="bubble-expand-btn" @click.stop="toggleBubbleExpand" @mousedown.stop>
                 {{ isBubbleExpanded ? '收起' : '展开' }}
               </div>
             </template>
          </div>
          <div class="bubble-tail"></div>
        </div>
      </transition>
    </div>

    <!-- 文件搜索模态框 -->
    <FileSearchModal v-model:visible="showFileModal" :files="foundFiles" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import BedrockAvatar from '../components/avatar/BedrockAvatar.vue';
import FileSearchModal from '../components/FileSearchModal.vue';
import { invoke, listen } from '@/utils/ipcAdapter';
import { API_BASE } from '../config';
import { gatewayClient } from '../api/gateway';

const currentText = ref('主人，我在桌面等你很久啦！');
const isBubbleExpanded = ref(false);
const bubbleKey = ref(0);
const bubbleTop = ref('15%');
const bubbleLeft = ref('50%');
const avatarRef = ref(null);
let bubbleTimer = null;

// Debug refs
const debugGlobalX = ref(0);
const debugGlobalY = ref(0);
const showDebug = ref(false);

const isContentOverflowing = ref(false);
const bubbleScrollArea = ref(null);
const thinkingMessage = ref('努力思考中...');

// --- 状态管理 (第一阶段) ---
const currentAgentName = ref('Pero');
const moodText = ref(localStorage.getItem('ppc.mood') || '开心');
const vibeText = ref(localStorage.getItem('ppc.vibe') || '轻松');
const mindText = ref(localStorage.getItem('ppc.mind') || '发呆');
const isWorkMode = ref(false);
const voiceMode = ref(parseInt(localStorage.getItem('ppc.voice_mode') || '0'));
const isThinking = ref(false);
const isPTTRecording = ref(false); // PTT State
const isSpeaking = ref(false); // TTS State
// const voiceWs = ref(null); // Deprecated
const audioContext = ref(null);
const mediaStream = ref(null);
const scriptProcessor = ref(null);
const currentAudioSource = ref(null);
const audioQueue = ref([]);
const isAudioPlaying = ref(false);
const lipSyncFrame = ref(null);
const analyser = ref(null);
let isStartingPTT = false;
let isSpeakingState = false;
let audioBuffer = [];
let lastRmsUpdate = 0;
const VAD_THRESHOLD = 0.01;
let silenceStart = Date.now();

const showInput = ref(false);
const userInput = ref('');
const inputRef = ref(null);
const showFileModal = ref(false);
const foundFiles = ref([]);
const showAppearanceMenu = ref(false);
const localTexts = ref({});

const parsedBubbleContent = computed(() => {
  const text = currentText.value || '';
  if (!text) return [];

  const segments = [];
  const regex = /(?:【(Thinking|Error|Reflection|Monologue)[:：]?\s*([\s\S]*?)】)|(?:\n|^)\s*\*([\s\S]+?)\*|(?:\n|^)\s*(Thought|Action)[:：]\s*([\s\S]+?)(?=\n\s*(?:Thought|Action)[:：]|\n\s*\*|【(?:Thinking|Error|Reflection|Monologue)|$)|(?:<(nit(?:-[a-zA-Z0-9-]+)?)>[\s\S]*?<\/\1>)|(?:\[\[\[NIT_CALL\]\]\][\s\S]*?\[\[\[NIT_END\]\]\])/gi;
  
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const normalText = text.substring(lastIndex, match.index);
      if (normalText.trim()) {
        segments.push({ type: 'text', content: normalText });
      }
    }
    
    if (match[1] !== undefined) {
      const type = match[1].toLowerCase();
      segments.push({ type: type === 'thinking' ? 'thinking' : type, content: match[2].trim() });
    } else if (match[3] !== undefined) {
      segments.push({ type: 'action', content: match[3].trim() });
    } else if (match[4] !== undefined) {
      const type = match[4].toLowerCase() === 'thought' ? 'thinking' : 'action';
      segments.push({ type, content: match[5].trim() });
    }
    
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    const normalText = text.substring(lastIndex);
    if (normalText.trim()) {
      segments.push({ type: 'text', content: normalText });
    }
  }
  
  return segments.filter(s => s.type === 'text' || s.type === 'action');
});

const checkOverflow = () => {
  if (bubbleScrollArea.value) {
    const el = bubbleScrollArea.value;
    isContentOverflowing.value = el.scrollHeight > 210;
    
    if (!isContentOverflowing.value) {
      isBubbleExpanded.value = false;
    }
  }
};

watch(parsedBubbleContent, async () => {
  await nextTick();
  checkOverflow();
}, { deep: true });

// 气泡自动消失逻辑
watch([currentText, isThinking], ([newText, newThinking]) => {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }

  // 只有在非思考状态且有文字时，才启动自动消失定时器
  if (newText && !newThinking) {
    // 根据文字长度调整停留时间，最少 5 秒，最多 15 秒
    const duration = Math.min(Math.max(5000, newText.length * 200), 15000);
    bubbleTimer = setTimeout(() => {
      currentText.value = '';
      isBubbleExpanded.value = false;
      bubbleTimer = null;
    }, duration);
  }
});

const toggleBubbleExpand = () => {
  isBubbleExpanded.value = !isBubbleExpanded.value;
  nextTick(() => {
     checkOverflow();
  });
};

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

// --- 语音和 PTT 逻辑 ---

const cycleVoiceMode = async () => {
  if (isWorkMode.value) {
    currentText.value = '(工作模式下已禁用语音功能)'
    return
  }
  
  const nextMode = (voiceMode.value + 1) % 3
  voiceMode.value = nextMode
  localStorage.setItem('ppc.voice_mode', nextMode.toString())
  
  // Show mode change in bubble
  if (nextMode === 0) {
      currentText.value = '语音对话: 已关闭'
      stopVoiceMode()
  } else if (nextMode === 1) {
      currentText.value = '切换到: 自动感应 (VAD)'
  } else {
      currentText.value = '切换到: 按住说话 (PTT)'
  }
  isBubbleExpanded.value = true;
  bubbleKey.value++;
  
  if (nextMode !== 0) {
    // 如果还没开启麦克风，则开启
    // if (!voiceWs.value) { // WS check removed
      await startVoiceMode()
    // }
  }
}

const startVoiceMode = async () => {
    console.log('[语音] 正在启动语音模式...');
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
            throw new Error('媒体流中未找到音频轨道');
        }
        console.log('[语音] 已获得麦克风权限:', audioTracks[0].label);
        
        // 2. Gateway 连接 (假设已经连接，只需注册监听器)
        // 监听来自 Backend 的 Voice Update Request
        gatewayClient.on('action:voice_update', handleVoiceUpdateRequest);
        
        // 监听来自 Backend 的 Audio Stream (TTS)
        gatewayClient.on('stream', handleAudioStream);
        
        console.log('语音网关监听器已注册');
        // 在气泡中显示连接成功
        currentText.value = `语音连接成功: ${voiceModeTitle.value}`;
        isBubbleExpanded.value = true;
        bubbleKey.value++;
        
        // 3. 开始录音处理
        startRecording();
        
    } catch (err) {
        console.error('启动语音模式失败:', err);
    }
};

const stopVoiceMode = () => {
    // Remove listeners
    gatewayClient.off('action:voice_update', handleVoiceUpdateRequest);
    gatewayClient.off('stream', handleAudioStream);
    
    if (mediaStream.value) {
        mediaStream.value.getTracks().forEach(track => track.stop())
        mediaStream.value = null
    }
    
    if (audioContext.value) {
        audioContext.value.close()
        audioContext.value = null
    }
}

const startRecording = () => {
    audioContext.value = new (window.AudioContext || window.webkitAudioContext)()
    const source = audioContext.value.createMediaStreamSource(mediaStream.value)
    
    // 使用 ScriptProcessorNode 处理音频流 (已废弃但广泛支持)
    scriptProcessor.value = audioContext.value.createScriptProcessor(4096, 1, 1)
    
    source.connect(scriptProcessor.value)
    scriptProcessor.value.connect(audioContext.value.destination)
    
    scriptProcessor.value.onaudioprocess = (e) => {
        if (voiceMode.value === 0) return

        // 如果正在思考或正在说话，直接忽略新的语音输入
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
        
        // 调试日志：每秒输出一次当前音量
        if (Date.now() - lastRmsUpdate > 1000) {
            // console.log('Current Mic Volume (RMS):', rms.toFixed(4), 'Threshold:', VAD_THRESHOLD)
            lastRmsUpdate = Date.now()
        }
        
        // 2. VAD 逻辑
        if (rms > VAD_THRESHOLD) {
            silenceStart = Date.now()
            if (!isSpeakingState) {
                console.log('检测到语音 (音量:', rms.toFixed(4), ')')
                isSpeakingState = true
                audioBuffer = [] // 清空 buffer
            }
            // 收集音频数据
            audioBuffer.push(new Float32Array(inputData))
        } else {
            if (isSpeakingState) {
                // 如果静音超过 1000ms，认为一句话结束
                if (Date.now() - silenceStart > 1000) {
                    console.log('语音结束，正在发送缓冲区...')
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

const startPTT = async () => {
    if (voiceMode.value !== 2) return
    if (isPTTRecording.value || isStartingPTT) return
    
    isStartingPTT = true
    try {
      if (isThinking.value || isSpeaking.value) {
        console.log('PTT 已忽略: Pero 正忙', { isThinking: isThinking.value, isSpeaking: isSpeaking.value })
        return
      }
      
      // 确保 AudioContext 已激活
      if (audioContext.value && audioContext.value.state === 'suspended') {
        await audioContext.value.resume()
      }

      isPTTRecording.value = true
      isSpeakingState = true
      audioBuffer = []
      console.log('PTT 已启动')
    } finally {
      isStartingPTT = false
    }
}

const stopPTT = () => {
  if (!isPTTRecording.value) return
  isPTTRecording.value = false
  isSpeakingState = false
  console.log('PTT 结束，正在发送缓冲区...')
  sendAudioBuffer()
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
    
    // 2. 转换为 WAV
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

// Handler for Voice Update Requests (Status, Text, etc.)
const handleVoiceUpdateRequest = (req) => {
    const type = req.params.type;
    const content = req.params.content;
    const message = req.params.message;
    
    if (type === 'status') {
        if (content === 'listening') {
             stopAudioPlayback(true)
             isThinking.value = true
             thinkingMessage.value = '正在听主人说话...'
             currentText.value = ''
        } else if (content === 'thinking') {
             isThinking.value = true
             thinkingMessage.value = message || '努力思考中...'
             currentText.value = ''
        } else if (content === 'speaking') {
             isThinking.value = false
             thinkingMessage.value = '努力思考中...'
        } else if (content === 'idle') {
             isThinking.value = false
             thinkingMessage.value = '努力思考中...'
        }
    } else if (type === 'transcription') {
        console.log('用户说:', content)
    } else if (type === 'text_response') {
        currentText.value = content
        isThinking.value = false
        thinkingMessage.value = '努力思考中...'
        bubbleKey.value++;
    } else if (type === 'error') {
        console.error('语音错误:', content)
        currentText.value = `(错误: ${content})`
        isThinking.value = false
    }
}

// Handler for Audio Stream (TTS)
const handleAudioStream = (stream) => {
    if (stream.data) {
        playAudio(stream.data)
    }
}

// Removed handleVoiceMessage (Legacy WS)
const handleVoiceMessage = (event) => {}

const stopAudioPlayback = (clearQueue = false) => {
    stopLipSync(); // Stop lip sync immediately
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
}

const playAudio = async (base64Audio) => {
    if (!base64Audio) return
    audioQueue.value.push(base64Audio)
    if (!isAudioPlaying.value) {
        processAudioQueue()
    }
}

const startLipSync = (analyserNode) => {
    if (lipSyncFrame.value) cancelAnimationFrame(lipSyncFrame.value);

    const update = () => {
        if (!isSpeaking.value || !analyserNode) {
            if (avatarRef.value && avatarRef.value.setLipSync) {
                avatarRef.value.setLipSync(0);
            }
            return;
        }

        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(dataArray);

        // Calculate average volume from relevant bins (voice range)
        // 计算相关频段（人声范围）的平均音量
        let sum = 0;
        const startBin = 2; // Skip very low rumble
        const endBin = 32;  // Focus on voice frequencies (approx 0-2.7kHz with 256 FFT/44.1k)
        for (let i = startBin; i < endBin; i++) {
            sum += dataArray[i];
        }
        const average = sum / (endBin - startBin);
        
        // Normalize (0-255 -> 0-1) and apply gain
        // 归一化 (0-255 -> 0-1) 并应用增益
        // Multiply by 3.0 to make the mouth open more for normal speech
        const volume = Math.min(1.0, (average / 255) * 3.0);

        if (avatarRef.value && avatarRef.value.setLipSync) {
            avatarRef.value.setLipSync(volume);
        }

        lipSyncFrame.value = requestAnimationFrame(update);
    };
    update();
};

const stopLipSync = () => {
    if (lipSyncFrame.value) {
        cancelAnimationFrame(lipSyncFrame.value);
        lipSyncFrame.value = null;
    }
    if (avatarRef.value && avatarRef.value.setLipSync) {
        avatarRef.value.setLipSync(0);
    }
};

const processAudioQueue = async () => {
    if (audioQueue.value.length === 0) {
        isAudioPlaying.value = false
        isSpeaking.value = false
        return
    }

    isAudioPlaying.value = true
    const audioData = audioQueue.value.shift()

    isSpeaking.value = true
    
    let ctx = audioContext.value
    
    if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
        audioContext.value = ctx
    }
    
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume()
        } catch (e) {
            console.warn('[Pero] 恢复 AudioContext 失败:', e)
        }
    }
    
    try {
        let arrayBuffer;
        if (typeof audioData === 'string') {
             // Fallback for base64 string if any legacy path remains
             const binaryString = window.atob(audioData)
             const len = binaryString.length
             const bytes = new Uint8Array(len)
             for (let i = 0; i < len; i++) {
                 bytes[i] = binaryString.charCodeAt(i)
             }
             arrayBuffer = bytes.buffer;
        } else if (audioData instanceof Uint8Array) {
             // New path: Uint8Array from Protobuf
             // Need to copy to ArrayBuffer because decodeAudioData detaches it? 
             // Or just use .buffer. 
             // Note: Uint8Array.buffer might be the whole buffer of the message if it's a slice.
             // Safe way: new Uint8Array(audioData).buffer
             arrayBuffer = new Uint8Array(audioData).buffer;
        } else {
             throw new Error("未知音频数据类型");
        }
        
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        currentAudioSource.value = source
        
        // Create Analyser for Lip Sync
        // 创建分析器用于口型同步
        const analyserNode = ctx.createAnalyser()
        analyserNode.fftSize = 256
        analyser.value = analyserNode
        
        source.connect(analyserNode)
        analyserNode.connect(ctx.destination)
        
        source.start(0)
        startLipSync(analyserNode)
        
        source.onended = () => {
            currentAudioSource.value = null
            stopLipSync()
            source.disconnect()
            analyserNode.disconnect()
            processAudioQueue()
        }
        
    } catch (e) {
        console.error('[Pero] 音频解码错误:', e)
        processAudioQueue()
    }
}

// --- Global Key Handlers ---

const handleGlobalKeyDown = (e) => {
  if (isWorkMode.value) return

  // 1. Alt + V 切换语音模式
  if (e.altKey && !e.shiftKey && e.code === 'KeyV') {
    e.preventDefault()
    cycleVoiceMode()
    return
  }

  // 2. Alt + Shift + V PTT
  if (e.altKey && e.shiftKey && e.code === 'KeyV' && voiceMode.value === 2 && !isPTTRecording.value) {
    e.preventDefault()
    startPTT()
  }
}

const handleGlobalKeyUp = (e) => {
  if (isWorkMode.value) return

  if (e.code === 'KeyV' && voiceMode.value === 2 && isPTTRecording.value) {
    stopPTT()
  }
}

// --- Agent Logic ---
const fetchActiveAgent = async () => {
    try {
        const res = await fetch(`${API_BASE}/agents`);
        if (res.ok) {
            const agents = await res.json();
            const active = agents.find(a => a.is_active);
            if (active) {
                currentAgentName.value = active.name;
                // TODO: Trigger model reload if needed
            }
        }
    } catch (e) { console.error('获取活跃 Agent 失败:', e); }
};

// --- Lifecycle & IPC ---
let unlistenFunctions = [];

const setIgnoreMouse = (ignore) => {
  if (window._lastIgnoreState === ignore) return;
  window._lastIgnoreState = ignore;
  invoke('set_ignore_mouse', ignore).catch(e => console.error("set_ignore_mouse 失败", e));
}

const onHoverStart = () => {
  setIgnoreMouse(false);
}

const onHoverEnd = () => {
  if (!isDragging.value) {
    setIgnoreMouse(true);
  }
}

const onUIEnter = () => {
    setIgnoreMouse(false);
}

const onUILeave = () => {
    // Only set to true if not hovering character and not dragging
    if (!isDragging.value) {
        setIgnoreMouse(true);
    }
}

// Dragging State
let startX = 0;
let startY = 0;
const isDragging = ref(false);

const onMouseDown = (e) => {
    // Only start drag logic if left click
    if (e.button !== 0) return;
    
    startX = e.screenX;
    startY = e.screenY;
    
    const onMouseMove = (moveEvent) => {
        const movedX = Math.abs(moveEvent.screenX - startX);
        const movedY = Math.abs(moveEvent.screenY - startY);
        
        if (!isDragging.value && (movedX > 5 || movedY > 5)) {
            isDragging.value = true;
            // Tell main process to start dragging
            const offsetX = e.screenX - window.screenX;
            const offsetY = e.screenY - window.screenY;
            
            if (window.electron && window.electron.send) {
                window.electron.send('window-drag-start', { offsetX, offsetY });
            } else {
                invoke('window-drag-start', { offsetX, offsetY }).catch(() => {});
            }
        }
    }
    
    const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        
        if (isDragging.value) {
            isDragging.value = false;
            
            if (window.electron && window.electron.send) {
                window.electron.send('window-drag-end');
            } else {
                invoke('window-drag-end').catch(() => {});
            }

            // Reset transparency check
            setIgnoreMouse(false); // Keep false for a moment to prevent flicker? Or re-evaluate.
            // Actually if we are over the character, it should stay false.
            // If we dragged off, it might need to go true.
            // But BedrockAvatar will emit hover-end if we move off.
        }
    }
    
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

// Attach drag listener to container (captures events from BedrockAvatar too)
// BedrockAvatar uses Three.js, so we might need to handle mousedown there.
// But we can listen on the window or container 'mousedown.capture'

onMounted(async () => {
  fetchActiveAgent();
  loadLocalTexts();
  
  // 1. Initial Mouse Transparency
  await invoke('set_ignore_mouse', true);

  // Attach Drag Listener
  window.addEventListener('mousedown', onMouseDown);
  
  // Attach Key Listeners
  window.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('keyup', handleGlobalKeyUp);
  
  // ... rest of listeners ...
  // Backend Log -> Thinking Bubble
  const unlistenLog = await listen('backend-log', (event) => {
    console.log('[Backend]', event.payload);
    // Simple logic: if log contains "Thinking", show it
    if (typeof event.payload === 'string' && event.payload.includes('Thinking')) {
        currentText.value = "正在思考...";
        isThinking.value = true;
    }
  });
  unlistenFunctions.push(unlistenLog);

  // Status Updates
  const unlistenMood = await listen('update-mood', (event) => {
    moodText.value = event.payload;
    localStorage.setItem('ppc.mood', event.payload);
  });
  unlistenFunctions.push(unlistenMood);

  const unlistenVibe = await listen('update-vibe', (event) => {
    vibeText.value = event.payload;
    localStorage.setItem('ppc.vibe', event.payload);
  });
  unlistenFunctions.push(unlistenVibe);

  const unlistenMind = await listen('update-mind', (event) => {
    mindText.value = event.payload;
    localStorage.setItem('ppc.mind', event.payload);
  });
  unlistenFunctions.push(unlistenMind);

  // Work Mode
  const unlistenWorkMode = await listen('work-mode-changed', (event) => {
      isWorkMode.value = event.payload.is_work_mode;
      if (isWorkMode.value) {
          currentText.value = '进入工作模式 (Session Isolated)';
      } else {
          currentText.value = '工作辛苦啦！';
      }
  });
  unlistenFunctions.push(unlistenWorkMode);
  
  // Chat Sync (Agent Reply)
  const unlistenChat = await listen('sync-chat-to-pet', (event) => {
      if (isWorkMode.value) return;
      const { role, content } = event.payload;
      if (role === 'assistant') {
          currentText.value = content;
          isThinking.value = false;
          // Trigger bubble expand
          isBubbleExpanded.value = true;
          bubbleKey.value++;
      }
  });
  unlistenFunctions.push(unlistenChat);

  // File Search
  const unlistenSearch = await listen('file-search-result', (event) => {
    foundFiles.value = event.payload;
    showFileModal.value = true;
  });
  unlistenFunctions.push(unlistenSearch);

  // Reminder Trigger (from Gateway)
  gatewayClient.on('action:reminder_trigger', (params) => {
    const content = params.content || '提醒时间到！';
    
    // 1. Show Bubble
    currentText.value = `⏰ ${content}`;
    isBubbleExpanded.value = true;
    bubbleKey.value++;
    
    // 2. Play Sound / TTS
    if (voiceMode.value !== 0) {
        // Use browser native TTS for instant feedback
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(content);
            // Try to find a Chinese voice
            const voices = window.speechSynthesis.getVoices();
            const zhVoice = voices.find(v => v.lang.includes('zh'));
            if (zhVoice) utterance.voice = zhVoice;
            window.speechSynthesis.speak(utterance);
        }
    }
    
    // 3. Desktop Notification (Native)
    if (window.electron && window.electron.send) {
        window.electron.send('show-notification', { title: 'Pero 提醒', body: content });
    }
  });

// Global Mouse Tracking (Fix for character not following mouse when outside window)
if (window.electron && window.electron.on) {
    const cleanupMouse = window.electron.on('global-mouse-move', (_event, { x, y }) => {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        
        // 1. Direct update to avatar (More reliable than event dispatch)
        if (avatarRef.value && avatarRef.value.setGlobalMouse) {
            avatarRef.value.setGlobalMouse(x, y);
        }

    // 2. Dispatch event for other listeners (fallback)
    // Only dispatch if outside window bounds to avoid double events
    if (x < 0 || x > winW || y < 0 || y > winH) {
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            view: window
        });
        window.dispatchEvent(mouseEvent);
    }
            });
            unlistenFunctions.push(cleanupMouse);
        } else {
            console.warn('window.electron not found, global mouse tracking disabled');
        }
});

onUnmounted(() => {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  unlistenFunctions.forEach(fn => fn());
  unlistenFunctions = [];
  window.removeEventListener('mousedown', onMouseDown);
});

const toggleUI = () => {
  showInput.value = !showInput.value;
  if (!showInput.value) {
    showAppearanceMenu.value = false;
  }
};

const toggleAppearanceMenu = () => {
  showAppearanceMenu.value = !showAppearanceMenu.value;
}

const loadLocalTexts = async () => {
  try {
    const response = await fetch('live2d-widget/waifu-texts.json');
    const baseTexts = await response.json();
    const storageKey = `ppc.waifu.texts.${currentAgentName.value || 'default'}`; 
    let dynamicTexts = {};
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) dynamicTexts = JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to parse dynamic texts from localStorage:', e);
    }
    localTexts.value = { ...baseTexts, ...dynamicTexts };
    console.log('Local texts loaded:', Object.keys(localTexts.value).length);
  } catch (err) {
    console.error('Failed to load local texts:', err);
    // Fallback
    localTexts.value = {
        "click_head_01": "嘿嘿，好痒呀~",
        "click_head_02": "是在摸摸头吗？",
        "click_body_01": "不要戳那里啦！",
        "click_messages_01": "要牵手手吗？"
    };
  }
}

const getRandomLocalText = (category) => {
    if (!localTexts.value) return null;
    
    // Find keys starting with category (e.g. 'click_head')
    const keys = Object.keys(localTexts.value).filter(k => k.startsWith(category));
    if (keys.length === 0) return null;
    
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return localTexts.value[randomKey];
}

const onPet = (event) => {
  // console.log('Pet detected:', event);
  
  let text = null;
  
  switch(event.type) {
    case 'head':
      text = getRandomLocalText('click_head');
      if (!text) text = "嘿嘿，好痒呀~";
      break;
    case 'arm':
      text = getRandomLocalText('click_messages'); // Generic interaction
      if (!text) text = "要牵手手吗？";
      break;
    case 'body':
      // Try chest first, then body
      text = getRandomLocalText('click_chest') || getRandomLocalText('click_body');
      if (!text) text = "不要戳那里啦！";
      break;
    case 'leg':
      text = getRandomLocalText('click_body') || getRandomLocalText('click_messages');
      if (!text) text = "裙子不能掀！";
      break;
    default:
      text = getRandomLocalText('click_messages');
  }

  // console.log('Selected text:', text);

  // Fallback
  if (!text) {
      text = "嗯？";
  }

  // Force re-render for immediate visual feedback even if text is same
  currentText.value = text;
  isBubbleExpanded.value = true;
  bubbleKey.value++; 
  
  // Random vertical offset (12% to 18%)
  const randomTop = 12 + Math.random() * 6;
  bubbleTop.value = `${randomTop}%`;

  // Random horizontal offset (-10% to 10%)
  // Since we use translate(-50%, 0), adding margin-left or just changing left is easiest.
  // Let's use calc for left: 50% + offset
  const randomLeftOffset = (Math.random() * 40 - 20); // -20px to 20px approx equivalent in %
  // Actually let's use pixels for horizontal shift to be safe with narrow bubbles
  // Or just percentage: -5% to 5%
  const randomLeftPct = (Math.random() * 10 - 5);
  // We can bind 'left' style
  // Default is left: 50%, transform: translateX(-50%)
  // We can adjust the left percentage directly
  bubbleLeft.value = `${50 + randomLeftPct}%`;
};

const sendMessage = async () => {
    if (!userInput.value.trim()) return;
    if (isThinking.value) return;
    
    const text = userInput.value;
    userInput.value = '';
    isThinking.value = true;
    currentText.value = "思考中...";
    
    try {
        await invoke('chat-message', { message: text });
    } catch (e) {
        console.error('Send message failed:', e);
        isThinking.value = false;
        currentText.value = "发送失败...";
    }
}

// 监听后端回复
onMounted(async () => {
    // 监听 Gateway 消息（通过 IPC 或 WebSocket）
    // 假设后端通过 Gateway 广播 'action:text_response'
    gatewayClient.on('action:text_response', (data) => {
        const content = data.content;
        currentText.value = content;
        isThinking.value = false;
        isBubbleExpanded.value = true;
        bubbleKey.value++;
    });
    
    // 监听状态更新
    gatewayClient.on('action:voice_update', handleVoiceUpdateRequest);
    
    // 监听 TTS 音频流
    gatewayClient.on('stream', handleAudioStream);
    
    // 初始化时连接 Gateway
    // (如果 App.vue 或其他地方已经连接，这里可能需要调整，但 GatewayClient 是单例或共享的吗？)
    // 假设 gatewayClient 是全局导入的单例
});

const windowSizes = [
    { width: 600, height: 600 },
    { width: 800, height: 800 },
    { width: 1000, height: 1000 },
    { width: 1200, height: 1200 }
];
const currentSizeIndex = ref(1); // Default 800x800

const toggleWindowSize = () => {
    currentSizeIndex.value = (currentSizeIndex.value + 1) % windowSizes.length;
    const size = windowSizes[currentSizeIndex.value];
    if (window.electron && window.electron.send) {
        window.electron.send('resize-pet-window', size);
    }
};

const reloadPet = () => {
    window.location.reload();
}


const openChatWindow = () => {
    invoke('open_ide_window').catch(console.error);
}

const openDashboard = () => {
    invoke('open_dashboard').catch(console.error);
}
</script>

<style scoped>
/* Ensure the container takes full window space and supports transparency */
.pet-3d-container {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  background: transparent; /* Crucial for Electron transparent window */
  overflow: hidden;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  /* Use a pixel font if available, or a clean sans-serif */
  font-family: 'Segoe UI', sans-serif; 
}

.ui-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* Let clicks pass through to 3D scene/desktop */
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Minecraft/RPG Style Bubble */
.bubble {
  position: absolute;
  transform: translateX(-50%);
  
  /* Voxel Style */
  /* Voxel 风格 */
  background-color: rgba(20, 20, 20, 0.85);
  border: 2px solid #e0e0e0;
  border-radius: 4px;
  padding: 12px 16px;
  z-index: 100;
  max-width: 280px;
  
  /* Hard shadow */
  /* 硬阴影 */
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5); 
  
  pointer-events: auto;
  animation: bubble-float 3s infinite ease-in-out;
  display: flex;
  flex-direction: column;
  transition: all 0.2s steps(4);
  
  color: #ffffff;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.5;
  text-shadow: 1px 1px 0 #000;
}

.bubble:hover {
  transform: scale(1.02);
  background-color: rgba(30, 30, 30, 0.95);
  border-color: #ffffff;
  z-index: 110;
}

/* Pixel Tail */
/* 像素风格尾巴 */
.bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid #e0e0e0;
}

.bubble-tail::after {
  content: '';
  position: absolute;
  top: -9px; 
  left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid rgba(20, 20, 20, 0.85);
}

.bubble-content {
  cursor: pointer;
}

.bubble.expanded {
  max-height: 500px;
  overflow-y: auto;
}

.bubble.expanded::-webkit-scrollbar {
  width: 6px;
}
.bubble.expanded::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
}
.bubble.expanded::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 0;
  border: 1px solid #444;
}
.bubble.expanded::-webkit-scrollbar-thumb:hover {
  background: #aaa;
}

.bubble-scroll-area {
  max-height: 200px;
  overflow: hidden;
  transition: max-height 0.3s ease;
  position: relative;
}

.bubble.expanded .bubble-scroll-area {
  max-height: 500px;
  overflow-y: auto;
}

.bubble-expand-btn {
  font-size: 12px;
  color: #aaaaaa;
  text-align: center;
  margin-top: 8px;
  cursor: pointer;
  padding-top: 4px;
  border-top: 1px dashed #666;
  user-select: none;
  font-family: 'Consolas', monospace;
}

.bubble-expand-btn:hover {
  color: #ffffff;
  font-weight: bold;
}

.thinking-text {
  color: #aaaaaa;
  font-style: italic;
  display: flex;
  align-items: center;
  font-family: 'Consolas', monospace;
}

.thinking-text::after {
  content: "...";
  display: inline-block;
  width: 12px;
  animation: thinking-dots 1.5s infinite;
}

@keyframes thinking-dots {
  0% { content: "."; }
  33% { content: ".."; }
  66% { content: "..."; }
}

.thinking-block {
  margin: 12px 0;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 1px solid #555;
  overflow: hidden;
}

.thinking-label {
  padding: 4px 8px;
  background: rgba(50, 50, 50, 0.5);
  font-size: 11px;
  font-weight: bold;
  color: #ccc;
  border-bottom: 1px solid #555;
  font-family: 'Consolas', monospace;
}

.thinking-content {
  padding: 8px;
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: #ddd;
  white-space: pre-wrap;
  background: rgba(0, 0, 0, 0.2);
}

.action-text {
  color: #aaddff;
  font-style: italic;
  font-size: 0.95em;
  margin: 0 2px;
}

@keyframes bubble-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

.bubble-fade-enter-active {
  transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.bubble-fade-leave-active {
  transition: opacity 0.1s ease-out;
  position: absolute;
}
.bubble-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(0.8) translateY(10px);
}
.bubble-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(1.1);
}

/* Status Tags (Voxel) */
/* 状态标签 (Voxel) */
.status-tags {
  position: absolute;
  left: 50%; 
  top: 50%;
  transform: translate(-320px, -250px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  perspective: 1000px;
  align-items: flex-end;
  pointer-events: auto;
}

.status-tag {
  background: rgba(20, 20, 20, 0.85);
  padding: 8px 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  color: #ffffff;
  border: 2px solid #e0e0e0;
  white-space: nowrap;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  cursor: default;
  font-family: 'Consolas', monospace;
  text-shadow: 1px 1px 0 #000;
}

.status-tag:hover {
  transform: translateX(-5px);
  background: rgba(40, 40, 40, 0.95);
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  z-index: 110;
  border-color: #ffffff;
}

.status-tag.mood {
  border-color: #ff88aa;
  color: #ffccdd;
}

.status-tag.vibe {
  border-color: #88ccff;
  color: #cceeff;
}

.status-tag.mind {
  border-color: #88ffaa;
  color: #ccffdd;
  white-space: normal;
  max-width: 180px;
  word-break: break-all;
  line-height: 1.4;
  padding: 8px 12px;
  align-items: flex-start;
}

@keyframes float-tag {
  /* Reduced float for voxel style */
  /* 减少 Voxel 风格的浮动 */
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

/* Floating Trigger (Voxel Cube) */
/* 悬浮触发器 (Voxel 立方体) */
.floating-trigger {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(140px, -50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  pointer-events: auto;
}

.trigger-core {
  position: relative;
  width: 24px;
  height: 24px;
  transition: all 0.3s ease;
  animation: core-idle 4s infinite ease-in-out;
}

@keyframes core-idle {
  0% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-3px) rotate(15deg); }
  50% { transform: translateY(0) rotate(0deg); }
  75% { transform: translateY(3px) rotate(-15deg); }
  100% { transform: translateY(0) rotate(0deg); }
}

.core-dot {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px; /* Slightly more rounded */
  transition: all 0.2s ease;
  box-shadow: 
    0 0 15px rgba(255, 255, 255, 0.6),
    2px 2px 0px rgba(0, 0, 0, 0.3);
  border: 2px solid #fff;
}

.pulse-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  opacity: 0;
  animation: pulse-ring-smooth 2s infinite cubic-bezier(0.215, 0.61, 0.355, 1);
  box-sizing: border-box;
}

@keyframes pulse-ring-smooth {
  0% { transform: scale(0.8) rotate(0deg); opacity: 0.8; border-width: 2px; }
  50% { opacity: 0.5; }
  100% { transform: scale(2.4) rotate(90deg); opacity: 0; border-width: 0px; }
}

.floating-trigger:hover .trigger-core {
  animation-play-state: paused;
  transform: scale(1.1) rotate(45deg);
}

.floating-trigger:hover .core-dot {
  background: #ffffff;
  transform: scale(1.0);
  box-shadow: 
    0 0 20px rgba(255, 255, 255, 1),
    0 0 40px rgba(255, 255, 255, 0.6);
}

.floating-trigger.active .trigger-core {
  transform: rotate(45deg);
}

.floating-trigger.active .core-dot {
  background: #ff88aa;
  border-color: #ffccdd;
  box-shadow: 0 0 15px rgba(255, 136, 170, 0.6);
}

.floating-trigger.active .pulse-ring {
  border-color: rgba(255, 136, 170, 0.5);
  animation-duration: 1.5s;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.input-overlay {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
  perspective: 1000px;
  pointer-events: auto;
}

.chat-input {
  background: rgba(20, 20, 20, 0.85);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 2px solid #e0e0e0;
  border-radius: 4px;
  padding: 10px 16px;
  width: 240px;
  outline: none;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  transition: all 0.2s;
  font-family: 'Consolas', monospace;
}

.chat-input::placeholder {
  color: #888;
  font-weight: 400;
}

.chat-input:focus {
  width: 280px;
  background: rgba(30, 30, 30, 0.95);
  border-color: #ffffff;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  transform: translateY(-2px);
  color: #ffffff;
}

.pet-tools {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(200px, -50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(20, 20, 20, 0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  padding: 8px;
  border-radius: 6px;
  -webkit-app-region: no-drag;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  border: 2px solid #666;
  pointer-events: auto;
}

.tool-btn {
  background: rgba(40, 40, 40, 0.8);
  border: 2px solid #888;
  width: 38px;
  height: 38px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.15s;
  box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.5);
  color: #ddd;
}

.tool-btn:hover, .tool-btn.active {
  transform: translate(-1px, -1px);
  background: #555;
  border-color: #fff;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.6);
  color: #fff;
}

.tool-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0px 0px 0px rgba(0, 0, 0, 0.5);
}

.voice-btn.active.mode-vad {
  color: #ff99cc;
  border-color: #ff99cc;
}

.voice-btn.active.mode-ptt {
  color: #5fb878;
  border-color: #5fb878;
}

/* Appearance Menu (Voxel) */
.appearance-menu {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(-320px, -50%);
  background: rgba(20, 20, 20, 0.95);
  border: 2px solid #fff;
  border-radius: 6px;
  padding: 12px;
  width: 200px;
  color: white;
  box-shadow: 6px 6px 0px rgba(0,0,0,0.6);
  pointer-events: auto;
  font-family: 'Consolas', monospace;
  z-index: 101;
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #444;
  font-weight: bold;
}

.close-mini-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.close-mini-btn:hover {
  color: #fff;
}

.menu-section {
  margin-bottom: 12px;
}

.menu-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 6px;
  text-transform: uppercase;
}

.voxel-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}

.voxel-checkbox input {
  display: none;
}

.voxel-checkbox .checkmark {
  width: 16px;
  height: 16px;
  background: #333;
  border: 2px solid #888;
  position: relative;
  display: inline-block;
  transition: all 0.1s;
}

.voxel-checkbox:hover .checkmark {
  border-color: #fff;
}

.voxel-checkbox input:checked + .checkmark {
  background: #ff88aa;
  border-color: #fff;
}

.voxel-checkbox input:checked + .checkmark::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.voxel-select {
  width: 100%;
  padding: 6px;
  background: #333;
  border: 2px solid #888;
  color: white;
  font-family: inherit;
  cursor: pointer;
  outline: none;
}
.voxel-select:hover {
  border-color: #fff;
}

/* PTT Button (Voxel) */
.ptt-voxel-container {
  position: absolute;
  left: 50%;
  bottom: 70px;
  top: auto;
  transform: translateX(-220px);
  z-index: 100;
  pointer-events: auto;
}

.ptt-voxel-btn {
  background: rgba(40, 40, 40, 0.9);
  border: 2px solid #888;
  border-radius: 50%;
  width: 64px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  transition: all 0.1s;
  color: #ddd;
}

.ptt-voxel-btn:hover {
  transform: translate(-1px, -1px);
  background: #555;
  border-color: #fff;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  color: #fff;
}

.ptt-voxel-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0px 0px 0px rgba(0, 0, 0, 0.5);
}

.ptt-voxel-btn.recording {
  background: #ff4444;
  border-color: #ffcccc;
  color: white;
  animation: pulse-recording 1.5s infinite;
}

.ptt-icon {
  font-size: 24px;
  line-height: 1;
}

.ptt-text {
  font-size: 9px;
  margin-top: 4px;
  font-weight: bold;
  font-family: 'Consolas', monospace;
  letter-spacing: 1px;
}

@keyframes pulse-recording {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7); }
  70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
}
</style>