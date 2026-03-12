import { sendDailyBriefing } from "../../utils/scheduler"

export default defineEventHandler(async () => {
  try {
    await sendDailyBriefing()
    return { success: true, message: "Daily briefing triggered" }
  } catch (error) {
    console.error("[API] Briefing error:", error)
    throw createError({
      statusCode: 500,
      message: "Failed to send briefing",
    })
  }
})
