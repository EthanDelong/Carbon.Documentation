// Minimal ZIP writer (STORE method only -- no compression, no dependencies) for the code export's
// "download with images" bundle. Emits a perfectly ordinary zip: one local file header + data per
// entry, then the central directory. Image bytes go in exactly as uploaded (format preserved);
// there is no need to compress data-URL-decoded PNGs/JPEGs that are already compressed formats.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** Entry path inside the archive (forward slashes). */
  name: string
  data: Uint8Array
}

/** Build a store-only zip from the entries. Duplicate names get a numeric suffix. */
export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder()
  const seen = new Set<string>()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    let name = entry.name
    for (let i = 2; seen.has(name); i++) {
      const dot = entry.name.lastIndexOf('.')
      name = dot > 0 ? `${entry.name.slice(0, dot)} (${i})${entry.name.slice(dot)}` : `${entry.name} (${i})`
    }
    seen.add(name)
    const nameBytes = enc.encode(name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // local file header signature
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // flags: UTF-8 names
    local.setUint16(8, 0, true) // method: store
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true) // compressed size (= raw for store)
    local.setUint32(22, size, true) // uncompressed size
    local.setUint16(26, nameBytes.length, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, entry.data)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true) // central directory header signature
    cen.setUint16(4, 20, true) // version made by
    cen.setUint16(6, 20, true) // version needed
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, size, true)
    cen.setUint32(24, size, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint32(42, offset, true) // local header offset
    central.push(new Uint8Array(cen.buffer), nameBytes)

    offset += 30 + nameBytes.length + size
  }

  let cenSize = 0
  for (const c of central) cenSize += c.length
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true) // end of central directory signature
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, cenSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
