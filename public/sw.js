/*
 * NLH ヘッズアップ Service Worker
 *
 * 方針（リアルタイム対戦アプリのため）:
 *  - ページ HTML（ナビゲーション）はキャッシュせず常にネットワーク取得 → 古いゲーム画面を出さない
 *  - Supabase / API / 認証など動的通信は一切傍受しない → リアルタイム性・整合性に影響を与えない
 *  - 傍受するのは同一オリジンの静的アセット（ビルド済み JS/CSS、アイコン、フォント等）のみ
 *  - install 時にアイコン等の最小セットをプリキャッシュし、インストール可能化 + オフライン表示を担保
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `nlh-static-${CACHE_VERSION}`

// install 時にプリキャッシュする静的アセット（存在が確実なもののみ）
const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/maskable-512x512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // 一部が失敗してもインストールを止めない
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

// 手動更新トリガ（新しい SW を即時有効化したいとき用）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

// このオリジンで静的アセットとみなすパス
function isStaticAsset(url) {
  if (url.pathname.startsWith('/_nuxt/')) return true // Nuxt/Vite のハッシュ付き build 成果物（不変）
  return /\.(?:js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|json|webmanifest)$/i.test(
    url.pathname,
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // GET 以外（POST 等の API/認証）は一切傍受しない
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 別オリジン（Supabase / フォント CDN など）は傍受しない → ネットワーク直行
  if (url.origin !== self.location.origin) return

  // ナビゲーション（ページ HTML）はキャッシュせず常にネットワーク取得
  if (request.mode === 'navigate') return

  // 同一オリジンの静的アセットのみ Cache First（無ければ取得してキャッシュ）
  if (!isStaticAsset(url)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        // 正常なレスポンスのみキャッシュ（opaque/エラーは保存しない）
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
