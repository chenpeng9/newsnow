// Nitro plugin to start the scheduler when server starts
export default defineNitroPlugin((_nitroApp) => {
  // Only start scheduler in development and node-server mode
  if (process.env.VERCEL || process.env.CF_PAGES) {
    console.log("[Plugin] Skipping scheduler in serverless mode")
    return
  }

  import("../utils/scheduler").then(({ startScheduler }) => {
    console.log("[Plugin] Starting AI Intel Hub scheduler...")
    startScheduler()
  })
})
