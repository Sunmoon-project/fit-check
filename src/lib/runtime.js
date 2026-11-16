// dist/fit-check.html을 더블클릭해 열면(file://) /api 서버가 없어요.
export const NO_SERVER = typeof location !== 'undefined' && location.protocol === 'file:'

export const NO_SERVER_TEXT = '지금은 이 기능을 쓸 수 없어요. 잠시 후 다시 시도해 주세요.'
