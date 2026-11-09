// 학습 샘플·학습값 묶음의 브라우저 저장. 웹(localStorage)과 확장(chrome.storage.local)이 같은 함수를 쓰고,
// 저장소 차이는 어댑터({ get, set, remove }, 모두 Promise)가 감춰요. 서버로는 아무것도 보내지 않아요.
//
// 저장 위치: 키 'fitcheck.learn.v1' 하나에 { schemaVersion, samples, model }을 JSON으로 넣어요.
// 상한: 샘플 LEARN.maxSamples건, 저장 글자 수 LEARN.maxBytes. 넘으면 오래된 샘플부터 버리고 학습값은 남은 샘플로 다시 계산해요.
// 스키마 버전이 다르면 저장된 샘플과 학습값을 모두 폐기하고 빈 상태로 시작해요(마이그레이션하지 않아요: 원본 후기가 없어 변환할 수 없어서).
import { EASE_RULES } from './fitEngine.js'
import { LEARN, LEARN_SCHEMA_VERSION, trainModel, validateModel, learningStatus, brandKeyOf } from './learnedModel.js'
import { toSamples, mergeSamples, dayNumber } from './learnSamples.js'

export const LEARN_KEY = 'fitcheck.learn.v1'

/** localStorage 어댑터 (웹). storage는 테스트에서 가짜를 넣을 수 있어요. */
export function localAdapter(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  return {
    async get(key) {
      try {
        const raw = storage?.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value))
        return true
      } catch {
        return false // 용량 초과 등
      }
    },
    async remove(key) {
      try {
        storage.removeItem(key)
      } catch {
        /* 무시 */
      }
    },
  }
}

/** chrome.storage.local 어댑터 (확장). 콜백 API를 Promise로 감싸요. */
export function chromeAdapter(area, runtime) {
  return {
    get: (key) => new Promise((resolve) => area.get(key, (v) => resolve(v?.[key] ?? null))),
    set: (key, value) => new Promise((resolve) => area.set({ [key]: value }, () => resolve(!runtime?.lastError))),
    remove: (key) => new Promise((resolve) => area.remove(key, () => resolve())),
  }
}

const emptyState = () => ({ schemaVersion: LEARN_SCHEMA_VERSION, samples: [], model: null })

/** 저장된 상태를 읽어요. 버전이 다르거나 모양이 틀리면 폐기하고(저장소에서도 지움) 빈 상태를 돌려줘요. */
export async function loadLearning(adapter) {
  const raw = await adapter.get(LEARN_KEY)
  if (!raw) return emptyState()
  if (raw.schemaVersion !== LEARN_SCHEMA_VERSION || !Array.isArray(raw.samples)) {
    await adapter.remove(LEARN_KEY)
    return emptyState()
  }
  // 학습값 묶음만 버전이 어긋난 경우: 샘플로 다시 계산해요.
  const model = validateModel(raw.model) || (raw.samples.length ? trainModel(raw.samples, EASE_RULES, dayNumber()) : null)
  return { schemaVersion: LEARN_SCHEMA_VERSION, samples: raw.samples, model }
}

/** 새 샘플을 합쳐 저장해요(중복 id는 무시, 상한 초과 시 오래된 것부터 정리). */
export async function addSamples(adapter, incoming, now = Date.now()) {
  const cur = await loadLearning(adapter)
  let { samples, dropped } = mergeSamples(cur.samples, incoming, LEARN.maxSamples)
  const added = samples.filter((s) => !cur.samples.some((c) => c.id === s.id)).length
  const build = (list) => ({ schemaVersion: LEARN_SCHEMA_VERSION, samples: list, model: trainModel(list, EASE_RULES, dayNumber(now)) })
  let state = build(samples)
  // 용량 상한(글자 수)을 넘으면 오래된 샘플을 10%씩 더 버려요.
  while (state.samples.length > 0 && JSON.stringify(state).length > LEARN.maxBytes) {
    const cut = Math.max(1, Math.floor(state.samples.length * 0.1))
    const r = mergeSamples(state.samples, [], state.samples.length - cut)
    dropped += r.dropped
    state = build(r.samples)
  }
  let saved = state.samples.length === 0 ? true : await adapter.set(LEARN_KEY, state)
  // 저장소 용량이 모자라 쓰기에 실패하면 절반으로 줄여 한 번 더 시도해요.
  if (!saved && state.samples.length > 1) {
    const r = mergeSamples(state.samples, [], Math.floor(state.samples.length / 2))
    dropped += r.dropped
    state = build(r.samples)
    saved = await adapter.set(LEARN_KEY, state)
  }
  return { ...state, added: saved ? added : 0, dropped, saved }
}

/** 초기화: 샘플과 학습값을 모두 지워요. */
export async function resetLearning(adapter) {
  await adapter.remove(LEARN_KEY)
}

/**
 * 상품 하나를 분석할 때 부르는 한 번에 처리: 후기에서 샘플을 만들어 쌓고 학습값을 돌려줘요.
 * 쌓을 샘플이 없어도 저장된 학습값은 읽어서 돌려줘요.
 * @returns {{ model: object|null, added: number, total: number }}
 */
export async function learnFromProduct(adapter, product, opts = {}) {
  const samples = toSamples(product, opts)
  if (samples.length === 0) {
    const cur = await loadLearning(adapter)
    return { model: cur.model, added: 0, total: cur.samples.length }
  }
  const r = await addSamples(adapter, samples, opts.now)
  return { model: r.model, added: r.added, total: r.samples.length }
}

export { learningStatus, brandKeyOf }
