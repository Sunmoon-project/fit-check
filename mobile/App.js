// 핏체크 모바일: 쇼핑몰을 앱 안 브라우저로 열고, 화면 옆 동그란 '핏' 버튼(확장의 content.js)으로 그 페이지를 분석해요.
// 체형 정보와 학습값은 이 기기(AsyncStorage)에만 저장하고 어디로도 보내지 않아요.
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CONTENT_JS, PROFILE_HTML } from './injected'

const STORE_KEY = 'fitcheck.store.v1'
// 저장소 통로를 쓸 수 있는 쇼핑몰 (확장 manifest의 content_scripts matches와 같아요).
// 앱 안 브라우저로 다른 사이트에 가도, 그 페이지는 체형 정보를 읽거나 쓸 수 없어요.
const BRIDGE_HOSTS = ['musinsa.com', '29cm.co.kr', 'wconcept.co.kr', 'bunjang.co.kr', 'fruitsfamily.com', 'arcteryx.co.kr', 'arcteryx.com']
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
  ['무신사', 'https://www.musinsa.com'],
  ['29CM', 'https://www.29cm.co.kr'],
  ['W컨셉', 'https://www.wconcept.co.kr'],
]
const STEPS = [
  ['내 체형 저장하기', '키와 몸무게만 있어도 돼요.'],
  ['쇼핑몰에서 옷 고르기', '아래 쇼핑몰을 열거나 상품 주소를 붙여넣으세요.'],
  ['화면 옆 ‘핏’ 버튼 누르기', '상품 페이지에서 누르면 내 사이즈를 알려드려요.'],
]

// 확장의 chrome.storage.local 대용. 값 전체를 한 덩어리로 저장해요.
// ponytail: 저장할 때마다 전체를 다시 써요. 학습 샘플이 수 MB로 커지면 키별 저장으로 바꾸세요.
function useStore() {
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
  }
  return { profile, onMessage }
}

function toUrl(text) {
  const t = text.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

export default function App() {
  const store = useStore()
  const [url, setUrl] = useState(null) // null이면 홈 화면
  const [address, setAddress] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const web = useRef(null)
  const profileWeb = useRef(null)

  function open(next) {
    const u = toUrl(next)
    if (!u) return
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

  const profileLabel = store.profile ? `${store.profile.height}cm ${store.profile.weight}kg` : '내 체형 입력'

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.bar}>
          <Text style={s.logo}>핏체크</Text>
          <TextInput
            style={s.address}
            value={address}
            onChangeText={setAddress}
            onSubmitEditing={() => open(address)}
            placeholder="상품 주소 붙여넣기"
            placeholderTextColor="#8b95a1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
            accessibilityLabel="상품 주소"
          />
        </View>

        {url ? (
          <WebView
            ref={web}
            style={s.web}
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
        ) : (
          <View style={s.home}>
            <Text style={s.title}>옷 사기 전에,{'\n'}내 사이즈부터 확인하세요</Text>
            <View style={s.card}>
              {STEPS.map(([title, desc], i) => (
                <View key={title} style={[s.step, i > 0 && s.stepLine]}>
                  <Text style={s.stepNum}>{i + 1}</Text>
                  <View style={s.stepText}>
                    <Text style={s.stepTitle}>{title}</Text>
                    <Text style={s.muted}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Pressable style={[s.btn, store.profile ? s.btnGhost : s.btnPrimary]} onPress={() => setShowProfile(true)}>
              <Text style={store.profile ? s.btnGhostText : s.btnPrimaryText}>{store.profile ? `내 체형 ${profileLabel} 수정` : '내 체형 입력하기'}</Text>
            </Pressable>
            <Text style={s.section}>쇼핑몰 열기</Text>
            <View style={s.malls}>
              {MALLS.map(([name, link]) => (
                <Pressable key={name} style={s.mall} onPress={() => open(link)}>
                  <Text style={s.mallText}>{name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.muted}>사이즈표, 후기, 옷 사진이 없는 페이지에서는 분석할 수 없어요. 체형 정보는 이 기기에만 저장돼요.</Text>
          </View>
        )}

        {url && (
          <View style={s.tools}>
            <Pressable style={s.tool} disabled={!canGoBack} onPress={() => web.current?.goBack()} accessibilityLabel="뒤로">
              <Text style={[s.toolText, !canGoBack && s.off]}>뒤로</Text>
            </Pressable>
            <Pressable style={s.tool} onPress={() => web.current?.reload()}>
              <Text style={s.toolText}>새로고침</Text>
            </Pressable>
            <Pressable style={s.tool} onPress={() => setUrl(null)}>
              <Text style={s.toolText}>홈</Text>
            </Pressable>
            <Pressable style={s.tool} onPress={() => setShowProfile(true)}>
              <Text style={s.toolText}>{store.profile ? '내 체형' : '내 체형 입력'}</Text>
            </Pressable>
          </View>
        )}

        <Modal visible={showProfile} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProfile(false)}>
          <SafeAreaProvider>
            <SafeAreaView style={s.sheet}>
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle}>내 체형</Text>
                <Pressable onPress={() => setShowProfile(false)} hitSlop={12}>
                  <Text style={s.toolText}>닫기</Text>
                </Pressable>
              </View>
              <WebView
                ref={profileWeb}
                style={s.web}
                originWhitelist={['*']}
                source={{ html: PROFILE_HTML }}
                onMessage={(e) => store.onMessage(profileWeb.current, e, true)}
              />
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const INK = '#191f28'
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e8eb' },
  logo: { fontSize: 19, fontWeight: '800', color: INK, letterSpacing: -0.8 },
  address: { flex: 1, height: 40, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#f2f4f6', fontSize: 15, color: INK },
  web: { flex: 1 },
  home: { flex: 1, padding: 20, gap: 14, backgroundColor: '#f2f4f6' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700', color: INK, letterSpacing: -0.9, marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 6 },
  step: { flexDirection: 'row', gap: 14, paddingVertical: 14 },
  stepLine: { borderTopWidth: 1, borderTopColor: '#e5e8eb' },
  stepNum: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: INK, color: '#fff', textAlign: 'center', lineHeight: 28, fontSize: 13, fontWeight: '700' },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 16, fontWeight: '600', color: INK },
  muted: { fontSize: 13, lineHeight: 19, color: '#5f6b7a' },
  btn: { height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: INK },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8eb' },
  btnGhostText: { color: '#4e5968', fontSize: 16, fontWeight: '600' },
  section: { fontSize: 16, fontWeight: '700', color: INK, marginTop: 10 },
  malls: { flexDirection: 'row', gap: 8 },
  mall: { flex: 1, height: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  mallText: { fontSize: 15, fontWeight: '600', color: INK },
  tools: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e5e8eb', backgroundColor: '#fff' },
  tool: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 14, fontWeight: '600', color: '#4e5968' },
  off: { opacity: 0.35 },
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  sheetTitle: { fontSize: 19, fontWeight: '700', color: INK },
})
