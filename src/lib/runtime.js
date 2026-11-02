// dist/fit-check.html을 더블클릭해 열면(file://) /api 서버가 없어요.
export const NO_SERVER = typeof location !== 'undefined' && location.protocol === 'file:'

export const NO_SERVER_TEXT = '파일로 연 화면이라 서버 기능(상품 링크 분석, AI 합성)은 쓸 수 없어요. npm run dev로 실행하면 쓸 수 있어요.'
