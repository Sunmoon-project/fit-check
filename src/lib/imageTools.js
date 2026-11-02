// 브라우저 전용 이미지 도구 (canvas 사용). 사진은 서버로 보내기 전에 여기서 줄입니다.

export function loadImage(src, { crossOrigin = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // 원격 상품 이미지는 CORS 허용일 때만 canvas로 픽셀을 읽을 수 있어요.
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 불러오지 못했어요.'))
    img.src = src
  })
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('파일을 읽지 못했어요.'))
    r.readAsDataURL(file)
  })
}

// 업로드 파일을 긴 변 maxSide 이하로 줄여 data URL로. (/api/tryon 요청 15MB 제한 대비)
export async function fileToDataUrl(file, maxSide = 1024) {
  if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    throw new Error('PNG, JPG, WEBP 사진만 올릴 수 있어요.')
  }
  const raw = await readAsDataUrl(file)
  const img = await loadImage(raw)
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  // PNG는 투명 배경을 살리고, 나머지는 용량이 작은 JPEG로
  return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88)
}

// 네 모서리 색과 비슷한 픽셀을 테두리에서부터 flood fill로 투명하게 만듭니다 (프로토타입 방식).
function floodRemove(ctx, w, h, tolerance) {
  const imgData = ctx.getImageData(0, 0, w, h)
  const data = imgData.data
  const visited = new Uint8Array(w * h)
  const stack = []
  const colorAt = (id) => [data[id * 4], data[id * 4 + 1], data[id * 4 + 2]]
  const corners = [colorAt(0), colorAt(w - 1), colorAt((h - 1) * w), colorAt(h * w - 1)]
  const tol2 = tolerance * tolerance
  const isBg = (id) => {
    const i = id * 4
    for (const c of corners) {
      const dr = data[i] - c[0]
      const dg = data[i + 1] - c[1]
      const db = data[i + 2] - c[2]
      if (dr * dr + dg * dg + db * db < tol2) return true
    }
    return false
  }
  const tryPush = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const id = y * w + x
    if (visited[id] || !isBg(id)) return
    visited[id] = 1
    stack.push(id)
  }
  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1) }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y) }
  while (stack.length) {
    const id = stack.pop()
    data[id * 4 + 3] = 0
    const x = id % w
    const y = (id - x) / w
    tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1)
  }
  ctx.putImageData(imgData, 0, 0)
}

// 남은 옷 영역만 잘라내기
function cropToContent(canvas) {
  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas
  const data = ctx.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return canvas
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch)
  return out
}

// 인물 사진 위에 옷 이미지를 얹은 합성 미리보기를 작은 JPEG로 (옷장 저장용).
// layout: { leftPct, topPct, widthPct } — 사진 크기 대비 %. 옷이 원격 이미지면 canvas가 오염돼 실패할 수 있어요.
export async function composePreview(personSrc, garmentSrc, layout, maxSide = 480) {
  const [person, garment] = await Promise.all([loadImage(personSrc), loadImage(garmentSrc)])
  const scale = Math.min(1, maxSide / Math.max(person.naturalWidth, person.naturalHeight))
  const W = Math.round(person.naturalWidth * scale)
  const H = Math.round(person.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.drawImage(person, 0, 0, W, H)
  const gw = (W * layout.widthPct) / 100
  const gh = gw * (garment.naturalHeight / garment.naturalWidth)
  ctx.drawImage(garment, (W * layout.leftPct) / 100, (H * layout.topPct) / 100, gw, gh)
  return canvas.toDataURL('image/jpeg', 0.82)
}

// 반환: { dataUrl, removed } — removed=false면 배경 제거 없이 원본을 그대로 씁니다.
export async function removeBackground(src, tolerance = 34, maxSide = 720) {
  const isRemote = /^https?:/i.test(src)
  let img
  try {
    img = await loadImage(src, { crossOrigin: isRemote })
  } catch {
    // CORS 헤더가 없는 쇼핑몰 이미지는 crossOrigin 로드가 실패해요. 원본만 표시합니다.
    return { dataUrl: src, removed: false, reason: 'CORS' }
  }
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  try {
    floodRemove(ctx, w, h, tolerance)
    return { dataUrl: cropToContent(canvas).toDataURL('image/png'), removed: true }
  } catch {
    // canvas가 오염(tainted)되면 픽셀을 읽을 수 없어요.
    return { dataUrl: src, removed: false, reason: 'CORS' }
  }
}
