import { startGame } from '~~/server/utils/gameService'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const code = getRouterParam(event, 'code')!
  await runGame(() => startGame(serviceDb(event), { code, userId: user.id }))
  return { ok: true }
})
