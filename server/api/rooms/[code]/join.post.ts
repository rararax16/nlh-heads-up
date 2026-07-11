import { joinRoom } from '~~/server/utils/gameService'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const code = getRouterParam(event, 'code')!
  const body = await readBody(event)
  const displayName = String(body?.displayName ?? '').trim()
  if (!displayName) throw createError({ statusCode: 400, statusMessage: '表示名を入力してください' })

  return runGame(() =>
    joinRoom(serviceDb(event), { code, userId: user.id, displayName }),
  )
})
