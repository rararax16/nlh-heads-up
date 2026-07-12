import { createRoom } from '~~/server/utils/gameService'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const displayName = String(body?.displayName ?? '').trim()
  if (!displayName) throw createError({ statusCode: 400, statusMessage: '表示名を入力してください' })

  return runGame(() =>
    createRoom(serviceDb(event), {
      userId: user.id,
      displayName,
      name: body?.name ? String(body.name).trim() : null,
      isPublic: body?.isPublic ?? true,
      initialStack: numberOr(body?.initialStack, 10000),
      blindIntervalSeconds: numberOr(body?.blindIntervalSeconds, 300),
      actionTimeoutSeconds: numberOr(body?.actionTimeoutSeconds, 30),
      anteMode: body?.anteMode === 'none' ? 'none' : 'bb',
      startingBb: numberOr(body?.startingBb, 200),
      chipUnit: numberOr(body?.chipUnit, 100),
    }),
  )
})

function numberOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
