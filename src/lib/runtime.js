// dist/fit-check.html을 더블클릭해 열면(file://) /api 서버가 없어요.
export const NO_SERVER = typeof location !== 'undefined' && location.protocol === 'file:'

export const NO_SERVER_TEXT = '파일로 연 화면이라 서버 기능(상품 링크 분석, AI 합성)은 쓸 수 없어요. npm run dev로 실행하면 쓸 수 있어요.'

// API 서버 주소. 웹(dev/serve)은 같은 출처라 비워 두고,
// 모바일 앱(Capacitor)처럼 화면과 서버가 따로일 때만 빌드 시 VITE_API_BASE=https://내-서버 로 지정해요.
export const API_BASE = String(import.meta.env?.VITE_API_BASE || '').replace(/\/+$/, '')

export function apiUrl(path) {
  return `${API_BASE}${path}`
}
