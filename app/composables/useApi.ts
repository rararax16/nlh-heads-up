import type { NitroFetchOptions } from 'nitropack'

/**
 * 認証付き $fetch。現在のセッションの access_token を Authorization ヘッダに付与する。
 * （サーバーは Bearer トークンでユーザーを検証する）
 *
 * 401 が返った場合はセッションの持ち主が消えている可能性がある
 * （DB リセット・匿名ユーザーの定期掃除など）ため、匿名サインインを
 * やり直して 1 回だけ再試行する。401 はサーバーが処理前に弾いた応答なので
 * POST でも再試行は安全。
 */
export function useApi() {
  const session = useSupabaseSession()
  const supabase = useSupabaseClient()

  async function currentToken(): Promise<string | undefined> {
    // セッション ref が未反映の初回でも確実にトークンを得るためフォールバック
    let token = session.value?.access_token
    if (!token) {
      const { data } = await supabase.auth.getSession()
      token = data.session?.access_token
    }
    return token
  }

  function doFetch<T>(url: string, opts: NitroFetchOptions<string>, token?: string): Promise<T> {
    return $fetch<T>(url, {
      ...opts,
      headers: {
        ...(opts.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  return async function apiFetch<T>(url: string, opts: NitroFetchOptions<string> = {}): Promise<T> {
    try {
      return await doFetch<T>(url, opts, await currentToken())
    } catch (e: unknown) {
      const status =
        (e as { statusCode?: number; status?: number })?.statusCode ??
        (e as { status?: number })?.status
      if (status !== 401 || !import.meta.client) throw e

      // 死んだセッションを破棄して匿名ユーザーを作り直し、1回だけ再試行
      await supabase.auth.signOut()
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error || !data.session) throw e
      return doFetch<T>(url, opts, data.session.access_token)
    }
  }
}
