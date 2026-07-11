import type { NitroFetchOptions } from 'nitropack'

/**
 * 認証付き $fetch。現在のセッションの access_token を Authorization ヘッダに付与する。
 * （サーバーは Bearer トークンでユーザーを検証する）
 */
export function useApi() {
  const session = useSupabaseSession()
  const supabase = useSupabaseClient()

  return async function apiFetch<T>(url: string, opts: NitroFetchOptions<string> = {}): Promise<T> {
    // セッション ref が未反映の初回でも確実にトークンを得るためフォールバック
    let token = session.value?.access_token
    if (!token) {
      const { data } = await supabase.auth.getSession()
      token = data.session?.access_token
    }
    return $fetch<T>(url, {
      ...opts,
      headers: {
        ...(opts.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
}
