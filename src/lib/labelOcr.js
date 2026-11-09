// 라벨/택 사진 글자 인식 자리: 사진 속 사이즈·품번 글자를 읽는 공급자 인터페이스예요.
// 이번 단계에서는 실제 글자 인식(OCR)을 구현하지 않았어요. 기본 provider가 null이라 비활성이고, 네트워크를 쓰지 않아요.
//
// provider 계약: { textFromImage(source) → Promise<string> }  (source는 사진 주소 또는 Blob. 공급자가 정해요)
// 읽은 글은 판매글 파서(parseListingText)로 사이즈·품번·브랜드만 뽑아요. 원문은 길이를 제한해서 돌려주고 저장하지 않아요.
// 네트워크가 되는 환경에서 tesseract 같은 도구를 검토하는 계획은 docs/중고_라벨인식.md에 있어요.
import { parseListingText } from './usedListing.js'

export const LABEL_OCR_DISABLED_TEXT = '라벨 사진 글자 인식은 아직 연결되지 않아서 쓸 수 없어요. (준비 중)'
export const LABEL_TEXT_MAX = 2000

/** @param {{ textFromImage?: Function }|null} provider 없으면(null) 비활성 */
export function createLabelReader(provider = null) {
  const enabled = !!provider && typeof provider.textFromImage === 'function'
  return {
    enabled,
    async read(source) {
      if (!enabled) return { status: 'disabled', text: '', fields: null, message: LABEL_OCR_DISABLED_TEXT }
      try {
        const text = String((await provider.textFromImage(source)) ?? '').slice(0, LABEL_TEXT_MAX)
        if (!text.trim()) return { status: 'empty', text: '', fields: null, message: '사진에서 글자를 읽지 못했어요.' }
        const p = parseListingText(text)
        return { status: 'ok', text, fields: { sizes: p.sizes.map((s) => s.label), code: p.code, brand: p.brand?.text || '' }, message: '' }
      } catch {
        return { status: 'error', text: '', fields: null, message: '라벨 글자 인식에 실패했어요.' }
      }
    },
  }
}
