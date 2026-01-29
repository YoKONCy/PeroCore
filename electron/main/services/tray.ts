import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { windowManager } from '../windows/manager.js'
import { stopBackend } from './python.js'

let tray: Tray | null = null

export function createTray() {
    // Determine icon based on platform
    // 根据平台确定图标
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    
    // Icon search paths
    // 图标搜索路径
    const paths = [
        join(process.cwd(), 'public', iconName), // Dev
        join(process.cwd(), 'resources', iconName), // Prod
        join(process.resourcesPath, iconName), // Prod resources
        join(__dirname, '../../../public', iconName), // Relative dev
        join(__dirname, '../../../dist', iconName), // Relative prod
        join(__dirname, '../../', iconName) // Fallback
    ]

    let iconPath = ''
    for (const p of paths) {
        if (existsSync(p)) {
            iconPath = p
            break
        }
    }

    console.log('Tray icon candidate paths:', paths)
    console.log('Selected tray icon path:', iconPath)

    if (!iconPath) {
        console.error('Tray icon not found')
        return
    }
    
    try {
        const icon = nativeImage.createFromPath(iconPath)
        // Resize if needed
        // 如需调整大小
        // icon.resize({ width: 16, height: 16 }) 
        
        tray = new Tray(icon)
        
        const contextMenu = Menu.buildFromTemplate([
            { 
                label: '打开启动器', 
                click: () => {
                    windowManager.createLauncherWindow()
                }
            },
            { 
                label: '召唤桌宠', 
                click: () => {
                    windowManager.createPetWindow()
                }
            },
            { 
                label: '控制面板', 
                click: () => {
                    windowManager.createDashboardWindow()
                }
            },
            { type: 'separator' },
            { 
                label: '彻底退出', 
                click: () => {
                    stopBackend()
                    app.quit()
                }
            }
        ])
        
        tray.setToolTip('PeroCore')
        tray.setContextMenu(contextMenu)
        
        tray.on('click', () => {
            windowManager.createLauncherWindow()
        })
        
    } catch (e) {
        console.error('Failed to create tray:', e)
    }
}

export function destroyTray() {
    tray?.destroy()
    tray = null
}
