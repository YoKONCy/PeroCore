import { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import AdmZip from 'adm-zip'
import axios from 'axios'
import { join } from 'path'

const ES_URL = "https://www.voidtools.com/ES-1.1.0.27.x64.zip"

function getWorkspaceRoot() {
    return process.cwd()
}

export function getEsDir() {
    // 1. Dev
    // 1. 开发环境
    const devRoot = getWorkspaceRoot()
    const devPath = join(devRoot, 'backend/nit_core/tools/core/FileSearch')
    if (fs.existsSync(devPath)) return devPath
    
    // 2. Prod (resources)
    // 2. 生产环境 (resources)
    const resourcePath = process.resourcesPath
    const pkgPath = join(resourcePath, 'backend/nit_core/tools/core/FileSearch')
    if (fs.existsSync(pkgPath)) return pkgPath
    
    // Fallback
    // 后备方案
    return devPath
}

export function checkEsInstalled() {
    const dir = getEsDir()
    const exe = join(dir, 'es.exe')
    return fs.existsSync(exe)
}

export async function installEs(window: BrowserWindow) {
    const dir = getEsDir()
    const emit = (msg: string) => window.webContents.send('es-log', msg)
    
    emit(`正在检查 ES 工具: ${dir}`)
    
    if (checkEsInstalled()) {
        emit("ES 工具已安装。")
        return true
    }
    
    emit("未找到 ES 工具。正在开始下载...")
    await fs.ensureDir(dir)
    
    try {
        const response = await axios({
            method: 'get',
            url: ES_URL,
            responseType: 'arraybuffer'
        })
        
        const zipBuffer = Buffer.from(response.data)
        const zip = new AdmZip(zipBuffer)
        const zipEntries = zip.getEntries()
        
        let found = false
        for (const entry of zipEntries) {
            if (entry.entryName === 'es.exe') {
                zip.extractEntryTo(entry, dir, false, true)
                found = true
                break
            }
        }
        
        if (!found) {
            throw new Error("下载的 zip 中未找到 es.exe")
        }
        
        emit("ES 工具安装完成。")
        return true
    } catch (e: any) {
        emit(`下载/安装失败: ${e.message}`)
        return false
    }
}
