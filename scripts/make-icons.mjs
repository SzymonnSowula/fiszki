// Generuje ikony PNG (bez zależności) do public/.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c, crc = ~0
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return ~crc >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function inRound(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false
  const cx = Math.min(Math.max(x, rx + r), rx + w - r)
  const cy = Math.min(Math.max(y, ry + r), ry + h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function icon(size, file) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const u = size / 32
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let rgb = [20, 17, 15]
      if (inRound(x, y, 8 * u, 5 * u, 16 * u, 18 * u, 3 * u)) rgb = [244, 239, 230]
      if (inRound(x, y, 5 * u, 9 * u, 16 * u, 18 * u, 3 * u)) rgb = [224, 122, 61]
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]))
}
icon(180, 'public/apple-touch-icon.png')
icon(192, 'public/icon-192.png')
icon(512, 'public/icon-512.png')
icon(1024, 'public/icon-1024.png')
