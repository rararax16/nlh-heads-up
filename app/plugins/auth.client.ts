// 起動時に匿名サインイン（未ログインなら）。async プラグインは mount 前に await される。
// セッションが残っていても、DB リセットや匿名ユーザーの定期掃除で
// 持ち主が消えていることがある（その場合すべての API が 401 になる）。
// 実在確認して、死んだセッションは破棄して作り直す。
export default defineNuxtPlugin(async () => {
  const supabase = useSupabaseClient()

  const { data } = await supabase.auth.getSession()
  if (data.session) {
    const { error } = await supabase.auth.getUser()
    if (!error) return // 生きているセッション
    await supabase.auth.signOut()
  }

  const { error } = await supabase.auth.signInAnonymously()
  if (error) console.error('匿名サインインに失敗:', error.message)
})
