// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'NLH ヘッズアップ',
      meta: [
        // スマートフォン前提: ノッチ領域まで描画し、キーボード表示時は表示領域を縮める
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
        { name: 'theme-color', content: '#070b09' },
        // チップ額の数字列が電話番号としてリンク化されるのを防ぐ（iOS Safari）
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'NLH' },
        { name: 'mobile-web-app-capable', content: 'yes' },
      ],
      link: [
        // Favicon / アプリアイコン
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        // PWA マニフェスト
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap' },
      ],
    },
  },

  modules: ['@nuxtjs/supabase'],

  supabase: {
    // 匿名認証を使うため、未ログインでもページを開けるようリダイレクトは無効化
    redirect: false,
    // クライアント（ブラウザ）が使う URL。SUPABASE_URL はブラウザから到達可能な値にする
    // （ローカル: http://127.0.0.1:54321 / 本番: https://xxx.supabase.co）
  },

  runtimeConfig: {
    // サーバー（Nitro）が Supabase へ到達する URL。
    // Docker では host.docker.internal を使うため、クライアント URL とは分離できる。
    // 未設定ならクライアント URL（SUPABASE_URL）にフォールバック。
    supabaseServerUrl: process.env.SUPABASE_SERVER_URL || process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
    supabaseAnonKey: process.env.SUPABASE_KEY,
  },

  nitro: {
    preset: 'vercel',
  },

  typescript: {
    strict: true,
  },
})
