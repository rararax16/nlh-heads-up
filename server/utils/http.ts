import type { H3Event } from 'h3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { GameError } from '../game/engine'

// サーバー（Nitro）専用の Supabase クライアントを、クライアント URL とは独立に構築する。
// これにより Docker では browser=127.0.0.1 / server=host.docker.internal の分離が可能。

let _service: SupabaseClient | null = null

/** service_role クライアント（RLS を越えてサーバー権威で書き込む） */
export function serviceDb(_event?: H3Event): SupabaseClient {
  if (_service) return _service
  const cfg = useRuntimeConfig()
  _service = createClient(cfg.supabaseServerUrl as string, cfg.supabaseServiceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _service
}

/**
 * ログイン中ユーザーを必須にする。
 * クライアントは Authorization: Bearer <access_token> を送る（useApi 経由）。
 * トークンはサーバー側 URL の Supabase に対して検証する。
 */
export async function requireUser(event: H3Event) {
  const auth = getHeader(event, 'authorization')
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7)
    const cfg = useRuntimeConfig()
    const client = createClient(cfg.supabaseServerUrl as string, cfg.supabaseAnonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await client.auth.getUser(token)
    if (data.user) return data.user
  }
  throw createError({ statusCode: 401, statusMessage: '認証が必要です' })
}

/** GameError を 400 に変換して実行するラッパー */
export async function runGame<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof GameError) {
      throw createError({ statusCode: 400, statusMessage: e.message })
    }
    throw e
  }
}
