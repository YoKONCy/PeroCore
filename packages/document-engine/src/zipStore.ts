import { createHash } from 'node:crypto'

export interface ZipEntry {
  path: string
  content: Buffer
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1) >>> 0
  return crc
})

export function crc32(content: Buffer): number {
  let crc = 0xffffffff
  for (const byte of content) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export function createStoreZip(entries: ZipEntry[]): Buffer {
  const ordered = [...entries].sort((left, right) => left.path.localeCompare(right.path))
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of ordered) {
    assertSafePath(entry.path)
    const name = Buffer.from(entry.path, 'utf8')
    const crc = crc32(entry.content)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.content.length, 18)
    local.writeUInt32LE(entry.content.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    localParts.push(local, entry.content)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.content.length, 20)
    central.writeUInt32LE(entry.content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + entry.content.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(ordered.length, 8)
  end.writeUInt16LE(ordered.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, end])
}

export function readStoreZip(
  buffer: Buffer,
  limits = { entries: 10_000, bytes: 512 * 1024 * 1024 },
): Map<string, Buffer> {
  if (buffer.length > limits.bytes) throw new Error('ARCA_PACKAGE_TOO_LARGE')
  const entries = new Map<string, Buffer>()
  let offset = 0
  let total = 0
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    if (entries.size >= limits.entries) throw new Error('ARCA_PACKAGE_ENTRY_LIMIT')
    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    const expectedCrc = buffer.readUInt32LE(offset + 14)
    const compressed = buffer.readUInt32LE(offset + 18)
    const uncompressed = buffer.readUInt32LE(offset + 22)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    if ((flags & 0x08) !== 0 || method !== 0 || compressed !== uncompressed)
      throw new Error('ARCA_PACKAGE_ZIP_UNSUPPORTED')
    const nameStart = offset + 30
    const contentStart = nameStart + nameLength + extraLength
    const contentEnd = contentStart + uncompressed
    if (contentEnd > buffer.length) throw new Error('ARCA_PACKAGE_ZIP_CORRUPT')
    const path = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')
    assertSafePath(path)
    if (entries.has(path)) throw new Error('ARCA_PACKAGE_DUPLICATE_ENTRY')
    const content = Buffer.from(buffer.subarray(contentStart, contentEnd))
    if (crc32(content) !== expectedCrc) throw new Error('ARCA_PACKAGE_CRC_MISMATCH')
    total += content.length
    if (total > limits.bytes) throw new Error('ARCA_PACKAGE_TOO_LARGE')
    entries.set(path, content)
    offset = contentEnd
  }
  if (!entries.size) throw new Error('ARCA_PACKAGE_ZIP_CORRUPT')
  return entries
}

function assertSafePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-z]:/i.test(path) ||
    path.includes('\\')
  )
    throw new Error('ARCA_PACKAGE_PATH_UNSAFE')
  if (path.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error('ARCA_PACKAGE_PATH_UNSAFE')
}
