import type { ScoredItem } from "../intel/filter"
import { intelCategories } from "@shared/intel-categories"
import { getters } from "../getters"
import { processIntel } from "../intel/filter"
import type { NewsItem } from "@shared/types"

// Daily briefing times: [hour, minute]
const BRIEFING_TIMES = [
  [8, 30],   // 08:30
  [20, 0],   // 20:00
]
const CONCURRENCY_LIMIT = 5 // Max concurrent source fetches

interface DailyBriefing {
  date: string
  aiDynamics: ScoredItem[]
  marketTemperature: string
  globalPerspectives: ScoredItem[]
}

/**
 * Run tasks with concurrency limit
 */
async function parallelFetch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<NewsItem[]>
): Promise<NewsItem[]> {
  const results: NewsItem[][] = []

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          const result = await fn(item)
          return result
        } catch (error) {
          console.error(`[Briefing] Fetch error:`, error)
          return []
        }
      })
    )
    results.push(...batchResults)
  }

  return results.flat()
}

/**
 * Generate daily briefing content
 */
export async function generateDailyBriefing(): Promise<DailyBriefing> {
  const now = new Date()
  const dateStr = now.toISOString().split("T")[0]

  // Get all source IDs from A category only (深度/专业级)
  const categories = [intelCategories.A]
  const sourceIds = categories.flatMap((c) => c.sources)

  console.log(`[Briefing] Fetching from ${sourceIds.length} sources (concurrency: ${CONCURRENCY_LIMIT})...`)

  // Fetch all sources with concurrency limit
  const allItems = await parallelFetch(
    sourceIds,
    CONCURRENCY_LIMIT,
    async (sourceId: string): Promise<NewsItem[]> => {
      const getter = getters[sourceId as keyof typeof getters]
      if (!getter) {
        console.warn(`[Briefing] Unknown source: ${sourceId}`)
        return []
      }
      const items = await getter()
      console.log(`[Briefing] Fetched ${sourceId}: ${Array.isArray(items) ? items.length : 0} items`)
      return Array.isArray(items) ? items : []
    }
  )

  // Process through AI filter
  const scored = await processIntel(allItems)

  // Sort by score
  const sorted = [...scored].sort((a, b) => b.aiScore - a.aiScore)

  // Select top items for each section
  const aiDynamics = sorted.filter((item) => item.aiScore >= 60).slice(0, 3)
  const marketTemperature = generateMarketSummary(sorted)
  const globalPerspectives = sorted
    .filter(
      (item) =>
        item.aiScore >= 50 &&
        (item.title.includes("国际") ||
          item.title.includes("全球") ||
          item.title.includes("美国") ||
          item.title.includes("欧洲"))
    )
    .slice(0, 3)

  return {
    date: dateStr,
    aiDynamics,
    marketTemperature,
    globalPerspectives,
  }
}

function generateMarketSummary(items: ScoredItem[]): string {
  // Simple heuristic based on recent financial news
  const financialItems = items.filter(
    (item) =>
      item.aiScore >= 50 &&
      (item.title.includes("降息") ||
        item.title.includes("加息") ||
        item.title.includes("美联储") ||
        item.title.includes("财报") ||
        item.title.includes("股"))
  )

  if (financialItems.length === 0) {
    return "市场情绪平稳，无重大波动"
  }

  // Could enhance with more sophisticated analysis
  return `近期关注 ${financialItems.slice(0, 2).map((i) => i.title).join("、")} 等动态`
}

/**
 * Build Feishu post message content for daily briefing
 */
function getSourceInfo(item: any): string {
  // Get source name from extra.info
  const source = item.extra?.info || ""
  // Get date from pubDate or extra.date
  const date = item.pubDate || item.extra?.date || ""
  // Format date if it's a timestamp
  let dateStr = ""
  if (date) {
    if (typeof date === "number") {
      dateStr = new Date(date).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } else {
      dateStr = String(date)
    }
  }
  if (source && dateStr) {
    return `(${source} · ${dateStr})`
  } else if (source) {
    return `(${source})`
  } else if (dateStr) {
    return `(${dateStr})`
  }
  return ""
}

/**
 * Build Feishu interactive card for daily briefing
 */
function buildFeishuCard(briefing: DailyBriefing): object {
  const elements: any[] = []

  // Add each news item as card elements
  briefing.aiDynamics.forEach((item) => {
    const sourceInfo = getSourceInfo(item)

    // Title with score
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${item.title}** [${item.aiScore}分] ${sourceInfo}`,
      },
    })

    // Summary (core content)
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `💡 ${item.aiSummary || "暂无摘要"}`,
      },
    })

    // Comment
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `💬 ${item.aiComment || "暂无点评"}`,
      },
    })

    // Button with link
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "查看原文",
          },
          type: "primary",
          url: item.url,
        },
      ],
    })

    // HR separator
    elements.push({
      tag: "hr",
    })
  })

  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `📰 今日新闻简报 (${briefing.date})`,
        },
        template: "blue",
      },
      elements,
    },
  }
}

/**
 * Build Discord embeds for daily briefing
 */
function buildDiscordEmbeds(briefing: DailyBriefing): object[] {
  const embeds: object[] = []

  // AI 动态
  const aiDynDesc = briefing.aiDynamics.length > 0
    ? briefing.aiDynamics.map((item, idx) => {
        const sourceInfo = getSourceInfo(item)
        return `**${idx + 1}.** [${item.title}](${item.url}) [${item.aiScore}分] ${sourceInfo}\n💡 ${item.aiSummary || "暂无摘要"}\n💬 ${item.aiComment || "无点评"}`
      }).join("\n\n")
    : "暂无"
  embeds.push({
    title: "🤖 AI 动态",
    description: aiDynDesc,
    color: 0x0099FF,
  })

  // 市场温度
  embeds.push({
    title: "📈 市场温度",
    description: briefing.marketTemperature,
    color: 0x66CC66,
  })

  // 全球视点
  const globalDesc = briefing.globalPerspectives.length > 0
    ? briefing.globalPerspectives.map((item, idx) => {
        const sourceInfo = getSourceInfo(item)
        return `**${idx + 1}.** [${item.title}](${item.url}) ${sourceInfo}\n💡 ${item.aiSummary || "暂无摘要"}\n💬 ${item.aiComment || "无点评"}`
      }).join("\n\n")
    : "暂无"
  embeds.push({
    title: "🌍 全球视点",
    description: globalDesc,
    color: 0xFFAA00,
  })

  // Footer embed
  embeds.push({
    title: "📰 新闻早知道",
    description: briefing.date,
    color: 0x666666,
  })

  return embeds
}

/**
 * Build WeCom markdown_v2 content for briefing
 */
function buildWeComContent(briefing: DailyBriefing): string {
  const lines: string[] = []

  // Header
  lines.push(`📰 新闻早知道 - ${briefing.date}`)
  lines.push("")

  // AI 动态
  lines.push("📊 AI 动态")
  const aiDynamics = briefing.aiDynamics as any[]
  if (aiDynamics.length > 0) {
    aiDynamics.forEach((item, idx) => {
      const sourceInfo = getSourceInfo(item)
      lines.push(`${idx + 1}. ${item.title} [${item.aiScore}分] ${sourceInfo}`)
      lines.push(`   💡 ${item.aiSummary || "暂无摘要"}`)
      lines.push(`   💬 ${item.aiComment || "无点评"}`)
      lines.push(`   <a href=\"${item.url}\">查看原文</a>`)
      lines.push("")
    })
  } else {
    lines.push("   暂无")
    lines.push("")
  }

  // 市场温度
  lines.push("📈 市场温度")
  lines.push(`   ${briefing.marketTemperature}`)
  lines.push("")

  // 全球视点
  lines.push("🌍 全球视点")
  const globalPerspectives = briefing.globalPerspectives as any[]
  if (globalPerspectives.length > 0) {
    globalPerspectives.forEach((item, idx) => {
      const sourceInfo = getSourceInfo(item)
      lines.push(`${idx + 1}. ${item.title} ${sourceInfo}`)
      lines.push(`   💡 ${item.aiSummary || "暂无摘要"}`)
      lines.push(`   💬 ${item.aiComment || "无点评"}`)
      lines.push(`   <a href=\"${item.url}\">查看原文</a>`)
      lines.push("")
    })
  } else {
    lines.push("   暂无")
    lines.push("")
  }

  // Footer
  lines.push("---")
  lines.push("由 早8🌞晚8🌛 Ai推送")

  return lines.join("\n")
}

/**
 * Send daily briefing to webhooks
 */
export async function sendDailyBriefing(): Promise<void> {
  const briefing = await generateDailyBriefing()

  // Send to Feishu (card format)
  const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK
  if (FEISHU_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const card = buildFeishuCard(briefing)

    await myFetch(FEISHU_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    })
    console.log("[Briefing] Feishu card sent")
  }

  // Send to Discord (embed format)
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK
  if (DISCORD_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const embeds = buildDiscordEmbeds(briefing)

    await myFetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds,
      }),
    })
    console.log("[Briefing] Discord embed sent")
  }

  // Send to WeCom (markdown_v2 format)
  const WECOM_WEBHOOK = process.env.WECOM_WEBHOOK
  if (WECOM_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const wecomContent = buildWeComContent(briefing)

    try {
      await myFetch(WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown_v2",
          markdown_v2: { content: wecomContent },
        }),
      })
      console.log("[Briefing] WeCom message sent")
    } catch (error: any) {
      console.error("[Briefing] WeCom error:", error?.message || error)
    }
  }

  console.log("[Briefing] Daily briefing sent")
}

/**
 * Send test briefing with mock data
 */
export async function sendTestBriefing(): Promise<void> {
  const mockBriefing: DailyBriefing = {
    date: new Date().toISOString().split("T")[0],
    aiDynamics: [
      {
        id: "1",
        title: "OpenAI 发布 GPT-5，AGI 迎来里程碑突破",
        url: "https://openai.com",
        pubDate: Date.now() - 3600000, // 1 hour ago
        extra: { info: "华尔街见闻" },
        aiScore: 95,
        aiSummary: "GPT-5 在推理能力和多模态理解上实现质的飞跃，被视为通向 AGI 的关键一步",
        aiComment: "关注算力赛道",
      },
      {
        id: "2",
        title: "英伟达 Q4 财报超预期，AI 芯片需求持续爆发",
        url: "https://nvidia.com",
        pubDate: Date.now() - 7200000, // 2 hours ago
        extra: { info: "金十数据" },
        aiScore: 88,
        aiSummary: "数据中心业务同比增长 400%，AI 芯片供不应求局面将持续至 2027 年",
        aiComment: "持续看好芯片股",
      },
      {
        id: "3",
        title: "美联储暗示最快 4 月降息，市场情绪转为乐观",
        url: "https://fed.gov",
        pubDate: Date.now() - 1800000, // 30 min ago
        extra: { info: "财联社" },
        aiScore: 82,
        aiSummary: "通胀数据持续降温，鲍威尔释放鸽派信号，风险资产全线上涨",
        aiComment: "关注成长股机会",
      },
    ] as any,
    marketTemperature: "市场情绪高涨，AI 赛道持续领涨，关注算力和应用层机会",
    globalPerspectives: [
      {
        id: "4",
        title: "中美科技战升级：半导体领域再加码管制",
        url: "https://reuters.com",
        pubDate: Date.now() - 10800000, // 3 hours ago
        extra: { info: "参考消息" },
        aiScore: 75,
        aiSummary: "美国拟对华实施更严格芯片出口限制，国产替代进程加速",
        aiComment: "关注国产替代",
      },
      {
        id: "5",
        title: "欧洲通过 AI 监管法案，科技巨头面临合规压力",
        url: "https://eu.gov",
        pubDate: Date.now() - 14400000, // 4 hours ago
        extra: { info: "澎湃新闻" },
        aiScore: 70,
        aiSummary: "全球首个全面 AI 监管框架落地，对大模型训练数据提出更高透明度要求",
        aiComment: "合规成本上升",
      },
    ] as any,
  }

  // Send to Feishu (card format)
  const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK
  console.log("[Test] FEISHU_WEBHOOK:", FEISHU_WEBHOOK ? "configured" : "NOT configured")
  if (FEISHU_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const card = buildFeishuCard(mockBriefing)

    try {
      const response = await myFetch(FEISHU_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
      })
      console.log("[Test] Feishu response:", response)
    } catch (error: any) {
      console.error("[Test] Feishu error:", error?.message || error)
    }
  } else {
    console.log("[Test] FEISHU_WEBHOOK not configured, skipping")
  }

  // Send to Discord
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK
  if (DISCORD_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const embeds = buildDiscordEmbeds(mockBriefing)

    await myFetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds,
      }),
    })
    console.log("[Test] Discord embed sent")
  }

  // Send to WeCom
  const WECOM_WEBHOOK = process.env.WECOM_WEBHOOK
  console.log("[Test] WECOM_WEBHOOK:", WECOM_WEBHOOK ? "configured" : "NOT configured")
  if (WECOM_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const wecomContent = buildWeComContent(mockBriefing)

    try {
      await myFetch(WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown_v2",
          markdown_v2: { content: wecomContent },
        }),
      })
      console.log("[Test] WeCom message sent")
    } catch (error: any) {
      console.error("[Test] WeCom error:", error?.message || error)
    }
  } else {
    console.log("[Test] WECOM_WEBHOOK not configured, skipping")
  }

  console.log("[Test] Test briefing sent")
}

/**
 * Start the scheduler (for local/Node.js deployment)
 * Uses simple interval checking
 */
let schedulerInterval: NodeJS.Timeout | null = null

export function startScheduler(): void {
  if (schedulerInterval) {
    return
  }

  console.log("[Scheduler] Starting daily briefing scheduler...")

  // Check every minute if it's time for briefing
  schedulerInterval = setInterval(() => {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    const isBriefingTime = BRIEFING_TIMES.some(
      ([hour, minute]) => hour === currentHour && minute === currentMinute
    )

    if (isBriefingTime) {
      console.log("[Scheduler] Triggering daily briefing...")
      sendDailyBriefing().catch(console.error)
    }
  }, 60 * 1000)
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log("[Scheduler] Stopped")
  }
}
