// PWA 아이콘(public/icons/*.png)을 만들어요. 외부 패키지 없이 PNG를 직접 써요.
//   node scripts/makePwaIcons.mjs
// 꽉 찬 배경 + 가운데 체크 표시라서 maskable(둥근/원형 마스크)에도 그대로 쓸 수 있어요.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const BG = [17, 17, 17]
const FG = [255, 255, 255]

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8비트
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0 // 필터 없음
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function drawIcon(size) {
  // 체크 표시 좌표(0~1). 안전 영역(가운데 약 60%) 안에 둬요.
  const pts = [[0.3, 0.52], [0.45, 0.67], [0.71, 0.36]]
  const half = size * 0.055
  const buf = Buffer.alloc(size * size * 3)
  const SS = 3 // 3x3 슈퍼샘플링으로 가장자리를 부드럽게
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const d = Math.min(
            distToSegment(px, py, pts[0][0] * size, pts[0][1] * size, pts[1][0] * size, pts[1][1] * size),
            distToSegment(px, py, pts[1][0] * size, pts[1][1] * size, pts[2][0] * size, pts[2][1] * size),
          )
          if (d <= half) cover++
        }
      }
      const a = cover / (SS * SS)
      const i = (y * size + x) * 3
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] * (1 - a) + FG[c] * a)
    }
  }
  return encodePng(size, buf)
}

fs.mkdirSync(OUT, { recursive: true })
for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`)
  fs.writeFileSync(file, drawIcon(size))
  console.log('만들었어요:', path.relative(process.cwd(), file))
}
