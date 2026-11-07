// extension/icons/*.png 를 만듭니다 (의존성 없음). 아이콘을 바꿀 때만 실행: node scripts/makeIcons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

// 먹색 둥근 사각형 안에 흰 체크 표시
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const r = size * 0.22
  const inside = (x, y) => {
    const dx = Math.max(r - x, 0, x - (size - 1 - r))
    const dy = Math.max(r - y, 0, y - (size - 1 - r))
    return dx * dx + dy * dy <= r * r
  }
  const seg = (x, y, x1, y1, x2, y2, w) => {
    const vx = x2 - x1, vy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy)))
    return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) <= w
  }
  const s = size
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4
      const check = seg(x, y, s * 0.27, s * 0.52, s * 0.44, s * 0.7, s * 0.07) || seg(x, y, s * 0.44, s * 0.7, s * 0.74, s * 0.32, s * 0.07)
      const [cr, cg, cb] = check ? [255, 255, 255] : [17, 17, 17]
      raw[i] = cr; raw[i + 1] = cg; raw[i + 2] = cb; raw[i + 3] = inside(x, y) ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(new URL('../extension/icons/', import.meta.url), { recursive: true })
for (const n of [16, 48, 128]) writeFileSync(new URL(`../extension/icons/icon${n}.png`, import.meta.url), icon(n))
console.log('icons written')
