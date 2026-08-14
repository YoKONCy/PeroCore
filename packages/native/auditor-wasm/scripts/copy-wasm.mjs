import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'target/wasm32-unknown-unknown/release/infos_auditor_wasm.wasm')
const destination = resolve(root, 'dist/auditor.wasm')
mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
console.log(`Rust/WASM 审计模块已复制到 ${destination}`)
