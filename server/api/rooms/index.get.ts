import type { LobbyRoom } from '~~/shared/types'
import type { BlindLevel } from '~~/shared/types'

// ロビー: 参加募集中（waiting）の公開部屋一覧
export default defineEventHandler(async (event): Promise<LobbyRoom[]> => {
  await requireUser(event)
  const db = serviceDb(event)

  const { data, error } = await db
    .from('rooms')
    .select('id, code, name, status, initial_stack, blind_interval_seconds, blind_structure, created_at, room_players(count)')
    .eq('is_public', true)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return (data ?? []).map((r) => {
    const structure = r.blind_structure as BlindLevel[]
    const first = structure[0]!
    const count = Array.isArray(r.room_players) ? (r.room_players[0]?.count ?? 0) : 0
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      playerCount: count,
      config: {
        initialStack: r.initial_stack,
        blindIntervalSeconds: r.blind_interval_seconds,
        startingBlinds: { sb: first.sb, bb: first.bb },
      },
      createdAt: r.created_at,
    }
  })
})
