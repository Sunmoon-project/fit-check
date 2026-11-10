// 아우터 세부 종류: 상품명으로 자켓·코트·패딩 등을 나누고, 종류마다 '표준 총장'(키 대비 비율)을 다르게 잡아요.
// 롱코트를 자켓 기준 길이와 비교해 "매우 긺"으로 판정하던 문제를 막기 위한 휴리스틱이에요 (실측으로 검증하지 않음).
const KINDS = [
  // 길이 수식어가 붙은 것을 먼저 봐요
  { kind: 'longPadding', label: '롱패딩', re: /롱\s?패딩|롱\s?다운|long\s?(?:padding|down)|벤치\s?파카/i, ratio: 0.62 },
  { kind: 'longCoat', label: '롱코트', re: /롱\s?코트|맥시\s?코트|long\s?coat/i, ratio: 0.65 },
  { kind: 'halfCoat', label: '하프코트', re: /하프\s?코트|숏\s?코트|half\s?coat|피\s?코트|pea\s?coat/i, ratio: 0.5 },
  { kind: 'padding', label: '패딩', re: /패딩|다운|푸퍼|파카|puffer|down|parka|padding/i, ratio: 0.41 },
  { kind: 'coat', label: '코트', re: /코트|트렌치|발마칸|체스터필드|coat|trench/i, ratio: 0.58 },
  { kind: 'vest', label: '베스트', re: /베스트|조끼|vest|gilet/i, ratio: 0.38 },
  { kind: 'cardigan', label: '가디건', re: /가디건|cardigan/i, ratio: 0.39 },
  { kind: 'jacket', label: '자켓', re: /자켓|재킷|블레이저|블루종|점퍼|바람막이|아노락|무스탕|플리스|jacket|blazer|blouson|anorak|windbreaker|fleece/i, ratio: 0.41 },
]
export const OUTER_DEFAULT_RATIO = 0.41

/** 상품명 → { kind, label, ratio } | null (아우터가 아니거나 알 수 없음) */
export function outerKindOf(name, category = 'outer') {
  if (category !== 'outer') return null
  const t = String(name || '')
  const hit = KINDS.find((k) => k.re.test(t))
  return hit ? { kind: hit.kind, label: hit.label, ratio: hit.ratio } : null
}
