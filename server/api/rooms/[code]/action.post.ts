import { applyPlayerAction } from '~~/server/utils/gameService'

const VALID = ['fold', 'check', 'call', 'bet', 'raise'] as const

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const code = getRouterParam(event, 'code')!
  const body = await readBody(event)
  const type = body?.type
  if (!VALID.includes(type)) {
    throw createError({ statusCode: 400, statusMessage: '不正なアクションです' })
  }
  const amount = body?.amount !== undefined ? Number(body.amount) : undefined

  await runGame(() =>
    applyPlayerAction(serviceDb(event), { code, userId: user.id, type, amount }),
  )
  return { ok: true }
})
