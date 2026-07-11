// 表示名を localStorage に保持する簡易ストア
export function useDisplayName() {
  const name = useState<string>('displayName', () => '')

  onMounted(() => {
    if (!name.value) {
      name.value = localStorage.getItem('displayName') || ''
    }
  })

  watch(name, (v) => {
    if (import.meta.client) localStorage.setItem('displayName', v)
  })

  return name
}
