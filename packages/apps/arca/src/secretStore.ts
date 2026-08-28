/**
 * secretStore — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface EncryptedSecret {
  credentialRef: string
  iv: string
  authTag: string
  ciphertext: string
  createdAt: string
  updatedAt: string
}

interface SecretFile {
  version: 1
  secrets: EncryptedSecret[]
}

/**
 * Arca独立Secret Store。
 * 密文使用AES-256-GCM；主密钥与密文分离保存，并限制为当前用户读写。
 * 桌面打包层可通过INFOS_ARCA_SECRET_KEY注入由系统Keychain保护的主密钥。
 */
export class ArcaSecretStore {
  private readonly key: Buffer
  private readonly secretFile: string

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.secretFile = path.join(directory, 'credentials.json')
    this.key = this.loadMasterKey()
  }

  put(secret: string, credentialRef = `arca-credential:${randomUUID()}`): string {
    if (!secret.trim()) throw new Error('ARCA_CREDENTIAL_EMPTY: API Key不能为空')
    const file = this.readFile()
    const existing = file.secrets.find((item) => item.credentialRef === credentialRef)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    const now = new Date().toISOString()
    const record: EncryptedSecret = {
      credentialRef,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    file.secrets = file.secrets.filter((item) => item.credentialRef !== credentialRef)
    file.secrets.push(record)
    this.writeFile(file)
    return credentialRef
  }

  resolve(credentialRef: string): string {
    const record = this.readFile().secrets.find((item) => item.credentialRef === credentialRef)
    if (!record) throw new Error('ARCA_CREDENTIAL_NOT_FOUND: 本地凭据不存在')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }

  remove(credentialRef: string): boolean {
    const file = this.readFile()
    const next = file.secrets.filter((item) => item.credentialRef !== credentialRef)
    if (next.length === file.secrets.length) return false
    file.secrets = next
    this.writeFile(file)
    return true
  }

  has(credentialRef: string | undefined): boolean {
    return Boolean(
      credentialRef && this.readFile().secrets.some((item) => item.credentialRef === credentialRef),
    )
  }

  private loadMasterKey(): Buffer {
    const injected = process.env.INFOS_ARCA_SECRET_KEY
    if (injected) {
      const key = Buffer.from(injected, 'base64')
      if (key.length !== 32) throw new Error('INFOS_ARCA_SECRET_KEY必须是32字节Base64密钥')
      return key
    }
    const keyFile = path.join(this.directory, 'master.key')
    if (existsSync(keyFile)) {
      const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
      if (key.length !== 32) throw new Error('ARCA_SECRET_KEY_INVALID: 本地主密钥损坏')
      return key
    }
    const key = randomBytes(32)
    writeFileSync(keyFile, key.toString('base64'), { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(keyFile, 0o600)
    } catch {
      // Windows权限由当前用户Profile目录ACL提供；桌面版应优先注入系统Keychain密钥。
    }
    return key
  }

  private readFile(): SecretFile {
    if (!existsSync(this.secretFile)) return { version: 1, secrets: [] }
    const value = JSON.parse(readFileSync(this.secretFile, 'utf8')) as SecretFile
    if (value.version !== 1 || !Array.isArray(value.secrets)) {
      throw new Error('ARCA_SECRET_STORE_INVALID: 凭据仓库格式不受支持')
    }
    return value
  }

  private writeFile(value: SecretFile): void {
    const temporary = `${this.secretFile}.tmp`
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.secretFile)
    try {
      chmodSync(this.secretFile, 0o600)
    } catch {
      // 参见loadMasterKey中的Windows ACL说明。
    }
  }
}
