import { testWebhooks } from "../../utils/notify"

export default defineEventHandler(async () => {
  const results = await testWebhooks()

  return {
    feishu: results.feishu ? "✅ Connected" : "❌ Not configured or failed",
    discord: results.discord ? "✅ Connected" : "❌ Not configured or failed",
  }
})
