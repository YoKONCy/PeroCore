const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, session } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

// 强制单例模式：如果已有实例运行，则退出
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

// ----------------------------------------------------------------------
// 1. 启动 Python FastAPI 后端
// ----------------------------------------------------------------------
let pythonProcess = null
// 存储最近的日志，以便新打开的 Dashboard 能看到历史
const logHistory = []
const MAX_LOG_HISTORY = 1000

// 保存原始 console 方法
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn
}

function appendLog(type, data) {
  const message = data.toString().trim()
  if (!message) return
  
  const timestamp = new Date().toLocaleTimeString()
  const logEntry = { type, message, timestamp }
  
  logHistory.push(logEntry)
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift()
  }
  
  // 实时发送给 Dashboard
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('terminal-log', logEntry)
  }
  
  // 使用原始 console 输出到终端，避免无限递归
  if (type === 'stderr' || type === 'error') {
    originalConsole.error(`[${type}]`, message)
  } else {
    originalConsole.log(`[${type}]`, message)
  }
}

// Hook console methods to capture Electron main process logs
console.log = (...args) => {
  const msg = args.map(a => String(a)).join(' ')
  appendLog('main-info', msg)
}
console.error = (...args) => {
  const msg = args.map(a => String(a)).join(' ')
  appendLog('main-error', msg)
}
console.warn = (...args) => {
  const msg = args.map(a => String(a)).join(' ')
  appendLog('main-warn', msg)
}

function startPythonBackend() {
  const backendPath = path.join(__dirname, '../backend/main.py')
  
  // 智能探测 Python 路径
  let pythonExec = 'python' // 默认回退到 PATH
  let useShell = true       // 如果用 PATH，通常需要 shell: true

  const knownPaths = [
    'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    'C:\\Python310\\python.exe',
    process.env.PYTHON_PATH // 允许环境变量覆盖
  ]
  
  for (const p of knownPaths) {
    if (p && fs.existsSync(p)) {
      pythonExec = p
      useShell = false // 使用绝对路径时，不需要 shell，更稳定
      appendLog('main-info', `Found Python at: ${p}`)
      break
    }
  }

  // 直接使用绝对路径启动，避免 cwd 切换带来的潜在问题
  try {
    pythonProcess = spawn(pythonExec, ['-u', backendPath], {
      cwd: path.join(__dirname, '../backend'),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell, 
      env: { 
        ...process.env, 
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PORT: '3000'
      }
    })
  } catch (e) {
    appendLog('main-error', `Failed to spawn python: ${e.message}`)
    return
  }

  // 增加启动超时检查
  setTimeout(() => {
    if (pythonProcess && pythonProcess.exitCode !== null) {
      appendLog('main-error', `Python backend failed to start (Exit Code: ${pythonProcess.exitCode})`)
    }
  }, 5000)

  pythonProcess.stdout.on('data', (data) => {
    appendLog('stdout', data)
  })

  pythonProcess.stderr.on('data', (data) => {
    appendLog('stderr', data)
  })

  pythonProcess.on('error', (err) => {
    appendLog('error', err.message)
  })
  
  pythonProcess.on('close', (code) => {
    appendLog('system', `Python backend exited with code ${code}`)
  })

  // 使用原始 console.log 避免重复触发 hook (或者直接调用 console.log 也可以，反正我们 hook 了)
  // 这里直接调用 appendLog 更明确
  appendLog('system', 'Python backend starting...')
}

// ----------------------------------------------------------------------
// 2. Electron 窗口管理
// ----------------------------------------------------------------------
let petWindow // 桌宠窗口
let dashboardWindow // 管理后台窗口
let tray

function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 1000,
    height: 1000,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // 强化置顶显示：在 Windows 上使用 screen-saver 级别，确保在全屏应用上方显示
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  
  // 允许在所有工作区显示
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 根据环境加载页面
  if (process.env.VITE_DEV_SERVER_URL) {
    petWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/pet`)
  } else {
    petWindow.loadURL(`file://${path.join(__dirname, '../dist/index.html')}#/pet`)
  }
  
  // 默认开启鼠标穿透，但转发事件，这样网页依然能收到 mousemove 来处理眼睛跟随
  petWindow.setIgnoreMouseEvents(true, { forward: true })
}

function createDashboardWindow() {
  if (dashboardWindow) {
    dashboardWindow.focus()
    return
  }

  dashboardWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: 'PeroCore 管理面板',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    dashboardWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/dashboard`)
  } else {
    dashboardWindow.loadURL(`file://${path.join(__dirname, '../dist/index.html')}#/dashboard`)
  }
  
  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })
}

function createTray() {
  tray = new Tray(path.join(__dirname, '../public/icon.png'))
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏 Pero', click: () => {
      if (petWindow.isVisible()) {
        petWindow.hide()
      } else {
        petWindow.show()
        // 重新显示时确保置顶级别
        petWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }},
    { label: '打开管理面板', click: () => createDashboardWindow() },
    { type: 'separator' },
    { label: '退出 PeroCore', click: () => app.quit() }
  ])
  tray.setToolTip('PeroCore')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    createDashboardWindow()
  })
}

// ----------------------------------------------------------------------
// 3. IPC 通讯
// ----------------------------------------------------------------------
ipcMain.on('window-drag', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    // 这种方式不需要传递坐标，由 Electron 内部处理
    // 注意：需要 electron 较新版本支持，或者手动计算位移
    // 另一种更通用的方式是传递位移坐标
  }
})

// 处理手动拖拽
ipcMain.on('move-window', (event, { x, y }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    const [currentX, currentY] = win.getPosition()
    win.setPosition(currentX + x, currentY + y)
  }
})

// 处理鼠标穿透切换
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.setIgnoreMouseEvents(ignore, options)
  }
})

// 打开管理面板
ipcMain.on('open-dashboard', () => {
  createDashboardWindow()
})

// 打开管理面板并跳转到监控页 (New)
ipcMain.on('open-dashboard-monitor', () => {
  createDashboardWindow()
  if (dashboardWindow) {
    dashboardWindow.show()
    dashboardWindow.focus()
    // 通知 Dashboard 切换到 Monitor tab
    dashboardWindow.webContents.send('open-dashboard-monitor')
  }
})

// 任务监控窗口控制 (Deprecated)
ipcMain.on('open-task-monitor', () => {
  // createTaskMonitorWindow() // Old behavior
  // New behavior: Redirect to dashboard
  createDashboardWindow()
  if (dashboardWindow) {
    dashboardWindow.show()
    dashboardWindow.focus()
    dashboardWindow.webContents.send('open-dashboard-monitor')
  }
})

// 数据中转：从 PetWindow 接收数据，转发给 DashboardWindow
ipcMain.on('monitor-data-update', (event, data) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('monitor-data-update', data)
  }
})

// 旧的数据更新接口 (兼容)
ipcMain.on('update-task-monitor-data', (event, data) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('monitor-data-update', data)
  }
})

// 获取历史终端日志
ipcMain.on('get-terminal-logs', (event) => {
  event.reply('terminal-logs-history', logHistory)
})

// 退出程序并清理后端
ipcMain.on('quit-app', () => {
  app.quit()
})

app.whenReady().then(() => {
  // 设置媒体权限自动授权
  if (session.defaultSession) {
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media') return true
      return true
    })
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') return callback(true)
      callback(true)
    })
  }

  startPythonBackend()
  createPetWindow()
  createTray()

  // 注册全局快捷键：Alt+Shift+V
  globalShortcut.register('Alt+Shift+V', () => {
    if (petWindow) {
      petWindow.webContents.send('toggle-voice-mode')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 保持程序在后台运行（托盘），不退出
  }
})

app.on('quit', () => {
  if (pythonProcess) {
    // Windows 上需要强制清理整个进程树
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pythonProcess.pid, '/f', '/t'])
    } else {
      pythonProcess.kill()
    }
  }
})
