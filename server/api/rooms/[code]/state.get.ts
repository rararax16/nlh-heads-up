import { buildRoomView } from '~~/server/utils/gameService'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const code = getRouterParam(event, 'code')!
  return runGame(() => buildRoomView(serviceDb(event), { code, userId: user.id }))
})
