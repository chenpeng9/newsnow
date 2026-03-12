import { sendTestBriefing } from "../../utils/scheduler"

export default defineEventHandler(async () => {
  try {
    await sendTestBriefing()
    return { success: true, message: "Test briefing sent" }
  } catch (error) {
    console.error("[API] Test briefing error:", error)
    throw createError({
      statusCode: 500,
      message: "Failed to send test briefing",
    })
  }
})
