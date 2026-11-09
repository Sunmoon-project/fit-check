// `npm run build:extension`: extension/ → dist-extension/ (content.js, bridge.js, popup.js는 IIFE 단일 파일)
import { build } from 'vite'
import { cpSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// 참고: manifest.json의 content_scripts matches에 있는 번개장터(bunjang.co.kr)·후르츠패밀리(fruitsfamily.com) 주소는 추정이에요.
// 실제 사이트에서 확인하지 못했어요. JSON에는 주석을 쓸 수 없어 여기에 적어 둡니다. 자세한 내용은 src/lib/usedListing.js와 README를 보세요.
const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'dist-extension')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const name of ['content', 'bridge', 'popup']) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: false,
      target: 'es2020',
      lib: { entry: resolve(root, `extension/${name}.js`), formats: ['iife'], name: `fitcheck_${name}`, fileName: () => `${name}.js` },
    },
  })
}
for (const f of ['manifest.json', 'popup.html', 'popup.css', 'icons']) cpSync(resolve(root, 'extension', f), resolve(out, f), { recursive: true })
console.log('dist-extension/ 생성 완료')
