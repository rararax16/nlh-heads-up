// 着席中の部屋コードを localStorage に保持する簡易ストア。
// 誤ってブラウザバック等で離脱しても、ロビーから対局に戻れるようにする。
export function useActiveRoom() {
  const code = useState<string | null>('activeRoomCode', () => null)

  onMounted(() => {
    if (!code.value) code.value = localStorage.getItem('activeRoomCode')
  })

  watch(code, (v) => {
    if (!import.meta.client) return
    if (v) localStorage.setItem('activeRoomCode', v)
    else localStorage.removeItem('activeRoomCode')
  })

  return code
}
