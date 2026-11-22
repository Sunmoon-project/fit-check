// 핏체크 모바일: 쇼핑몰을 앱 안 브라우저로 열고, 화면 옆 동그란 '핏' 버튼(확장의 content.js)으로 그 페이지를 분석해요.
// 체형 정보와 학습값은 이 기기(AsyncStorage)에만 저장하고 어디로도 보내지 않아요.
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SymbolView } from 'expo-symbols'
import { CONTENT_JS, PROFILE_HTML } from './injected'

const STORE_KEY = 'fitcheck.store.v1'
// 저장소 통로를 쓸 수 있는 쇼핑몰 (확장 manifest의 content_scripts matches와 같아요).
// 앱 안 브라우저로 다른 사이트에 가도, 그 페이지는 체형 정보를 읽거나 쓸 수 없어요.
const BRIDGE_HOSTS = ['musinsa.com', '29cm.co.kr', 'wconcept.co.kr', 'bunjang.co.kr', 'fruitsfamily.com', 'arcteryx.co.kr', 'arcteryx.com', 'kream.co.kr']
function isBridgeHost(url) {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && BRIDGE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}
const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype'])
const PROFILE_KEY = 'fitcheckProfile' // src/lib/extProfile.js의 EXT_PROFILE_KEY와 같아야 해요
const MALLS = [
  ['무신사', 'musinsa.com', 'https://www.musinsa.com'],
  ['29CM', '29cm.co.kr', 'https://www.29cm.co.kr'],
  ['W컨셉', 'wconcept.co.kr', 'https://www.wconcept.co.kr'],
  ['KREAM', 'kream.co.kr', 'https://kream.co.kr'],
]
const FIT_LABEL = { slim: '슬림', regular: '레귤러', relaxed: '오버핏' }

// 확장의 chrome.storage.local 대용. 값 전체를 한 덩어리로 저장해요.
// ponytail: 저장할 때마다 전체를 다시 써요. 학습 샘플이 수 MB로 커지면 키별 저장으로 바꾸세요.
function useStore(onSaved) {
  const ref = useRef(null) // null이면 아직 읽는 중
  const [profile, setProfile] = useState(null)
  const ready = useRef(
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => JSON.parse(raw || '{}'))
      .catch(() => ({}))
      .then((data) => {
        ref.current = data
        setProfile(data[PROFILE_KEY] || null)
      }),
  )

  // WebView가 보낸 저장 요청을 처리하고 같은 WebView에 답을 돌려줘요.
  // trusted: 앱이 직접 만든 화면(내 체형 입력)만 true. 쇼핑몰 WebView는 주소가 허용 목록일 때만 받아요.
  async function onMessage(webview, event, trusted = false) {
    if (!trusted && !isBridgeHost(event.nativeEvent.url)) return
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (!msg || msg.fc !== 1 || !Number.isInteger(msg.id)) return
    await ready.current
    const data = ref.current
    let result = null
    if (msg.op === 'get') {
      const keys = msg.payload == null ? Object.keys(data) : [].concat(typeof msg.payload === 'object' && !Array.isArray(msg.payload) ? Object.keys(msg.payload) : msg.payload)
      result = {}
      for (const k of keys) if (typeof k === 'string' && Object.hasOwn(data, k)) result[k] = data[k]
    } else if (msg.op === 'set' || msg.op === 'remove') {
      if (msg.op === 'set') {
        if (!msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload)) return
        for (const [k, v] of Object.entries(msg.payload)) if (!BAD_KEY.has(k)) data[k] = v
      } else for (const k of [].concat(msg.payload)) if (typeof k === 'string' && !BAD_KEY.has(k)) delete data[k]
      setProfile(data[PROFILE_KEY] || null)
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(data)).catch(() => {})
    } else return
    webview?.injectJavaScript(`window.__fcReply&&window.__fcReply(${msg.id},${JSON.stringify(result)});true;`)
    // 내 체형 시트에서 저장하면 잠깐 '저장했어요'를 보여 준 뒤 시트를 닫아요.
    if (trusted && msg.op === 'set' && msg.payload[PROFILE_KEY]) setTimeout(() => onSaved?.(), 450)
  }
  return { profile, onMessage }
}

function toUrl(text) {
  const t = text.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

// SF Symbols 아이콘 (iOS 전용 앱이에요)
const Icon = ({ name, size = 20, color = C.sub }) => <SymbolView name={name} size={size} tintColor={color} weight="semibold" />

function Btn({ onPress, style, children, label, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [style, pressed && s.pressed, disabled && s.off]}>
      {children}
    </Pressable>
  )
}

function Home({ profile, onProfile, onOpen }) {
  const [address, setAddress] = useState('')
  return (
    <View style={s.home}>
      <Text style={s.title}>사기 전에{'\n'}내 사이즈부터</Text>

      {profile ? (
        <Btn style={[s.card, s.me]} onPress={onProfile} label="내 체형 수정">
          <View style={s.meIcon}><Icon name="figure.stand" size={22} color={C.accent} /></View>
          <View style={s.flex}>
            <Text style={s.caption}>내 체형</Text>
            <Text style={s.meValue}>{profile.height}cm · {profile.weight}kg · {FIT_LABEL[profile.preferredFit] || '레귤러'}</Text>
          </View>
          <Text style={s.link}>수정</Text>
        </Btn>
      ) : (
        <View style={[s.card, s.start]}>
          <Text style={s.startTitle}>먼저 키와 몸무게를 알려주세요</Text>
          <Text style={s.body}>이 기기에만 저장되고, 어디로도 보내지 않아요.</Text>
          <Btn style={s.primary} onPress={onProfile} label="내 체형 입력하기">
            <Text style={s.primaryText}>내 체형 입력하기</Text>
          </Btn>
        </View>
      )}

      <View style={s.search}>
        <Icon name="link" size={17} color={C.mute} />
        <TextInput
          style={s.searchInput}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={() => onOpen(address)}
          placeholder="상품 주소 붙여넣기"
          placeholderTextColor={C.mute}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          accessibilityLabel="상품 주소"
        />
      </View>

      <View style={s.group}>
        <Text style={s.groupTitle}>쇼핑몰에서 고르기</Text>
        <View style={s.card}>
          {MALLS.map(([name, host, link], i) => (
            <Btn key={name} style={[s.mall, i > 0 && s.sep]} onPress={() => onOpen(link)} label={`${name} 열기`}>
              <View style={s.flex}>
                <Text style={s.mallName}>{name}</Text>
                <Text style={s.caption}>{host}</Text>
              </View>
              <Icon name="chevron.right" size={14} color={C.mute} />
            </Btn>
          ))}
        </View>
      </View>

      <View style={s.tip}>
        <View style={s.fabDot}><Text style={s.fabDotText}>핏</Text></View>
        <Text style={[s.body, s.flex]}>상품 페이지에서 화면 옆 <Text style={s.strong}>핏</Text> 버튼을 누르면 내 사이즈를 알려드려요.</Text>
      </View>
    </View>
  )
}

export default function App() {
  const [showProfile, setShowProfile] = useState(false)
  const store = useStore(() => setShowProfile(false))
  const [url, setUrl] = useState(null) // null이면 홈 화면
  const [address, setAddress] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const web = useRef(null)
  const profileWeb = useRef(null)

  function open(next) {
    const u = toUrl(next)
    if (!u) return
    Keyboard.dismiss()
    setAddress(u)
    setUrl(u)
  }

  // 안드로이드 뒤로 버튼: 페이지 뒤로 → 홈 순서
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!url) return false
      if (canGoBack) web.current?.goBack()
      else setUrl(null)
      return true
    })
    return () => sub.remove()
  }, [url, canGoBack])

  let host = ''
  try {
    host = new URL(address).hostname.replace(/^www\./, '')
  } catch {}

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[s.screen, url && s.white]} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="dark" />

        {url ? (
          <>
            <View style={s.bar}>
              <Btn style={s.iconBtn} onPress={() => setUrl(null)} label="홈으로">
                <Icon name="xmark" size={17} color={C.ink} />
              </Btn>
              <View style={s.addr}>
                <Icon name="lock.fill" size={11} color={C.mute} />
                <Text style={s.addrText} numberOfLines={1}>{host || address}</Text>
              </View>
              <Btn style={s.iconBtn} onPress={() => web.current?.reload()} label="새로고침">
                <Icon name="arrow.clockwise" size={17} color={C.ink} />
              </Btn>
            </View>
            <WebView
              ref={web}
              style={s.flex}
              source={{ uri: url }}
              injectedJavaScript={CONTENT_JS}
              onMessage={(e) => store.onMessage(web.current, e)}
              onNavigationStateChange={(nav) => {
                setCanGoBack(nav.canGoBack)
                if (nav.url) setAddress(nav.url)
              }}
              allowsBackForwardNavigationGestures
              setSupportMultipleWindows={false}
            />
            <View style={s.tools}>
              <Btn style={s.tool} disabled={!canGoBack} onPress={() => web.current?.goBack()} label="뒤로">
                <Icon name="chevron.left" size={20} color={C.ink} />
              </Btn>
              <Btn style={s.tool} onPress={() => setUrl(null)} label="홈">
                <Icon name="house" size={20} color={C.ink} />
              </Btn>
              <Btn style={s.tool} onPress={() => setShowProfile(true)} label="내 체형">
                <Icon name="person.crop.circle" size={21} color={store.profile ? C.ink : C.accent} />
              </Btn>
            </View>
          </>
        ) : (
          <Home profile={store.profile} onProfile={() => setShowProfile(true)} onOpen={open} />
        )}

        <Modal visible={showProfile} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProfile(false)}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>내 체형</Text>
              <Btn style={s.close} onPress={() => setShowProfile(false)} label="닫기">
                <Icon name="xmark" size={14} color={C.sub} />
              </Btn>
            </View>
            <WebView
              ref={profileWeb}
              style={s.flex}
              originWhitelist={['*']}
              source={{ html: PROFILE_HTML }}
              onMessage={(e) => store.onMessage(profileWeb.current, e, true)}
              keyboardDisplayRequiresUserAction={false}
            />
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

// 색: 밝은 회색 바탕 + 흰 카드 + 파란 포인트 하나. popup·결과 카드(content.js .wrap.m)와 같은 값을 써요.
const C = { bg: '#f2f4f6', card: '#fff', ink: '#191f28', sub: '#4e5968', mute: '#8b95a1', line: '#e5e8eb', accent: '#3182f6', accentSoft: '#e8f3ff' }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  white: { backgroundColor: C.card },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  off: { opacity: 0.3 },
  home: { flex: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12, gap: 20 },
  title: { fontSize: 30, lineHeight: 39, fontWeight: '700', color: C.ink, letterSpacing: -0.8, paddingHorizontal: 4 },
  card: { backgroundColor: C.card, borderRadius: 20 },
  me: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20 },
  meIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  meValue: { fontSize: 18, fontWeight: '700', color: C.ink, marginTop: 2, letterSpacing: -0.3 },
  link: { fontSize: 15, fontWeight: '600', color: C.accent },
  start: { padding: 22, gap: 6 },
  startTitle: { fontSize: 19, fontWeight: '700', color: C.ink, letterSpacing: -0.4 },
  primary: { height: 54, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  primaryText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, paddingHorizontal: 18, borderRadius: 16, backgroundColor: C.card },
  searchInput: { flex: 1, height: '100%', fontSize: 17, color: C.ink },
  group: { gap: 10 },
  groupTitle: { fontSize: 15, fontWeight: '600', color: C.sub, paddingHorizontal: 4 },
  mall: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingHorizontal: 20 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  mallName: { fontSize: 17, fontWeight: '600', color: C.ink },
  caption: { fontSize: 13, color: C.mute, marginTop: 1 },
  body: { fontSize: 15, lineHeight: 22, color: C.sub },
  strong: { fontWeight: '700', color: C.ink },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, marginTop: 'auto' },
  fabDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  fabDotText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addr: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: 12, backgroundColor: C.bg, paddingHorizontal: 12 },
  addrText: { fontSize: 15, fontWeight: '500', color: C.ink, flexShrink: 1 },
  tools: { flexDirection: 'row', height: 50, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.card },
  tool: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: C.card },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 4 },
  sheetTitle: { fontSize: 26, fontWeight: '700', color: C.ink, letterSpacing: -0.6 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
})
