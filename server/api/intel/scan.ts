import { getAlertItems } from "../../intel/filter"
import { getters } from "#/getters"
import { sendAlerts } from "../../utils/notify"
import type { NewsItem } from "~/shared/types"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sourceId = query.source as string

  if (!sourceId) {
    throw createError({
      statusCode: 400,
      message: "source parameter is required",
    })
  }

  // Get the source getter
  const getter = getters[sourceId]
  if (!getter) {
    throw createError({
      statusCode: 404,
      message: `Source '${sourceId}' not found`,
    })
  }

  try {
    // Fetch news from source
    console.log("[Intel] Fetching source:", sourceId)
    const items: NewsItem[] = await getter()
    console.log("[Intel] Got items:", items.length)

    // Process through AI filter and get high-value items
    console.log("[Intel] Processing through AI filter...")
    const alertItems = await getAlertItems(items)
    console.log("[Intel] Got alert items:", alertItems.length)

    // Send notifications for high-value items
    if (alertItems.length > 0) {
      console.log("[Intel] Sending alerts for", alertItems.length, "items")
      await sendAlerts(alertItems)
    }

    return {
      source: sourceId,
      totalItems: items.length,
      alertItems,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error("[API] Intel scan error:", error)
    throw createError({
      statusCode: 500,
      message: "Failed to process intel",
    })
  }
})
