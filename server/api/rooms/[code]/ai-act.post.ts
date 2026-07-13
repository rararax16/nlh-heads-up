import { applyAiAction } from '~~/server/utils/gameService'

// AI の手番を進める（クライアントが AI の手番を検知してポークする・冪等）
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const code = getRouterParam(event, 'code')!
  await runGame(() => applyAiAction(serviceDb(event), { code }))
  return { ok: true }
})
