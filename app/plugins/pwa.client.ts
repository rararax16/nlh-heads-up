// PWA: 本番のみ Service Worker を登録する。
// dev では登録しない（HMR/キャッシュ干渉を避けるため）。
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return
  if (import.meta.dev) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service Worker の登録に失敗:', err)
    })
  })
})
