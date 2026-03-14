import type { ScoredItem } from "../intel/filter"
import { intelCategories } from "@shared/intel-categories"
import { getters } from "../getters"
import { processIntel } from "../intel/filter"
import type { NewsItem } from "@shared/types"
import process from "node:process"

// Daily briefing times: [hour, minute]
const BRIEFING_TIMES = [
  [8, 30],   // 08:30
  [20, 0],   // 20:00
]
const CONCURRENCY_LIMIT = 5 // Max concurrent source fetches

// Freshness filter: only push news published within last 12 hours
const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000 // 12 hours in milliseconds

interface DailyBriefing {
  date: string
  aiDynamics: ScoredItem[]
  financeMarket: ScoredItem[]
  marketTemperature: string
  globalPerspectives: ScoredItem[]
  sourceIds: string[]
  allItems: NewsItem[]
  scored: ScoredItem[]
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
  const currentTime = new Date()
  const dateStr = currentTime.toISOString().split("T")[0]

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

  // Filter by freshness (within last 12 hours) before AI category filter
  const freshItems = sorted.filter((item) => {
    const publishTime = item.pubDate || item.extra?.date
    if (!publishTime) return false
    // Try to parse date from various formats
    const publishDate = typeof publishTime === 'string'
      ? new Date(publishTime).getTime()
      : (publishTime as number) || 0

    return currentTime.getTime() as number - publishDate <= FRESHNESS_WINDOW_MS
  })

  console.log(`[Briefing] Freshness filter: ${sorted.length} → ${freshItems.length} items (removed ${sorted.length - freshItems.length} old news)`)

  // Select items by AI category with score >= 85 (from fresh items only)
  const aiDynamics = freshItems.filter((item) => item.aiScore >= 85 && item.aiCategory === "AI动态")
  const financeMarket = freshItems.filter((item) => item.aiScore >= 85 && item.aiCategory === "财经市场")
  const globalPerspectives = freshItems.filter((item) => item.aiScore >= 85 && item.aiCategory === "全球视点")
  const marketTemperature = generateMarketSummary(sorted)

  return {
    date: dateStr,
    aiDynamics,
    financeMarket,
    marketTemperature,
    globalPerspectives,
    sourceIds,
    allItems,
    scored,
  }
}

function generateMarketSummary(items: ScoredItem[]): string {
  // Use AI category for financial market
  const financialItems = items.filter(
    (item) => item.aiScore >= 85 && item.aiCategory === "财经市场"
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

  // AI 动态
  if (briefing.aiDynamics.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**🤖 AI 动态**",
      },
    })
    briefing.aiDynamics.forEach((item) => {
      const sourceInfo = getSourceInfo(item)

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${item.title}** [${item.aiScore}分] ${sourceInfo}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💡 ${item.aiSummary || "暂无摘要"}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💬 ${item.aiComment || "暂无点评"}`,
        },
      })

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

      elements.push({
        tag: "hr",
      })
    })
  }

  // 财经市场
  if (briefing.financeMarket.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**💰 财经市场**",
      },
    })
    briefing.financeMarket.forEach((item) => {
      const sourceInfo = getSourceInfo(item)

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${item.title}** [${item.aiScore}分] ${sourceInfo}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💡 ${item.aiSummary || "暂无摘要"}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💬 ${item.aiComment || "暂无点评"}`,
        },
      })

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

      elements.push({
        tag: "hr",
      })
    })
  }

  // 市场温度
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**📈 市场温度**\n${briefing.marketTemperature}`,
    },
  })

  // 全球视点
  if (briefing.globalPerspectives.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**🌍 全球视点**",
      },
    })
    briefing.globalPerspectives.forEach((item) => {
      const sourceInfo = getSourceInfo(item)

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${item.title}** [${item.aiScore}分] ${sourceInfo}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💡 ${item.aiSummary || "暂无摘要"}`,
        },
      })

      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💬 ${item.aiComment || "暂无点评"}`,
        },
      })

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

      elements.push({
        tag: "hr",
      })
    })
  }

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
 * Build WeCom markdown_v2 content for a single category
 */
function buildWeComCategoryContent(
  title: string,
  items: ScoredItem[],
  date: string,
  withFooter: boolean = true
): string {
  const lines: string[] = []

  // Header
  lines.push(`${title} - ${date}`)
  lines.push("")

  // Items
  if (items.length > 0) {
    items.forEach((item, idx) => {
      const sourceInfo = getSourceInfo(item)
      lines.push(`${idx + 1}. ${item.title} [${item.aiScore}分] ${sourceInfo}`)
      lines.push(`   💡 ${item.aiSummary || "暂无摘要"}`)
      lines.push(`   💬 ${item.aiComment || "无点评"}`)
      lines.push(`   <a href="${item.url}">查看原文</a>`)
      lines.push("")
    })
  } else {
    lines.push("   暂无")
    lines.push("")
  }

  // Market temperature (only in first message)
  if (withFooter) {
    lines.push("---")
    lines.push("由 早8🌞晚8🌛 AI推送")
  }

  return lines.join("\n")
}

/**
 * Send daily briefing to webhooks
 */
export async function sendDailyBriefing(): Promise<void> {
  const briefing = await generateDailyBriefing()

  console.log("[Briefing] Generated briefing:", {
    date: briefing.date,
    aiDynamics: briefing.aiDynamics.length,
    financeMarket: briefing.financeMarket.length,
    globalPerspectives: briefing.globalPerspectives.length,
    marketTemperature: briefing.marketTemperature,
  })

  // Send to Feishu (card format)
  const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK
  if (FEISHU_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")
    const card = buildFeishuCard(briefing)

    try {
      const response = await myFetch(FEISHU_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
      })
      console.log("[Briefing] Feishu card sent, response:", response)
    } catch (error: any) {
      console.error("[Briefing] Feishu error:", error?.message || error)
    }
  }

  // Send to WeCom (markdown_v2 format) - split by category to avoid length limit
  const WECOM_WEBHOOK = process.env.WECOM_WEBHOOK
  if (WECOM_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")

    // Send AI Dynamics (no limit)
    if (briefing.aiDynamics.length > 0) {
      const aiItems = briefing.aiDynamics
      const aiContent = buildWeComCategoryContent("🤖 AI 动态", aiItems, briefing.date, false)
      console.log("[Briefing] WeCom AI Dynamics:", aiItems.length, "items, content length:", aiContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: aiContent },
          }),
        })
        console.log("[Briefing] WeCom AI Dynamics sent, response:", response)
      } catch (error: any) {
        console.error("[Briefing] WeCom AI Dynamics error:", error?.message || error)
      }
    }

    // Send Finance Market (no limit)
    if (briefing.financeMarket.length > 0) {
      const financeItems = briefing.financeMarket
      const financeContent = buildWeComCategoryContent("💰 财经市场", financeItems, briefing.date, false)
      console.log("[Briefing] WeCom Finance Market:", financeItems.length, "items, content length:", financeContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: financeContent },
          }),
        })
        console.log("[Briefing] WeCom Finance Market sent, response:", response)
      } catch (error: any) {
        console.error("[Briefing] WeCom Finance Market error:", error?.message || error)
      }
    }

    // Send Global Perspectives (no limit)
    if (briefing.globalPerspectives.length > 0) {
      const globalItems = briefing.globalPerspectives
      const globalContent = buildWeComCategoryContent("🌍 全球视点", globalItems, briefing.date, true)
      console.log("[Briefing] WeCom Global Perspectives:", globalItems.length, "items, content length:", globalContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: globalContent },
          }),
        })
        console.log("[Briefing] WeCom Global Perspectives sent, response:", response)
      } catch (error: any) {
        console.error("[Briefing] WeCom Global Perspectives error:", error?.message || error)
      }
    }

    // Send summary text reminder
    const aiPushed = aiItems.length || 0
    const financePushed = financeItems.length || 0
    const globalPushed = globalItems.length || 0
    const totalPushed = aiPushed + financePushed + globalPushed

    const summaryContent = `📰 本次新闻来自${briefing.sourceIds.length}个渠道，${briefing.allItems.length}条信息，过滤推送：
AI动态: ${aiPushed}条
财经市场: ${financePushed}条
全球视点: ${globalPushed}条

由 早8晚8💰 AI推送`
    console.log("[Briefing] WeCom summary content length:", summaryContent.length)

    try {
      await myFetch(WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: summaryContent },
        }),
      })
      console.log("[Briefing] WeCom summary sent")
    } catch (error: any) {
      console.error("[Briefing] WeCom summary error:", error?.message || error)
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
        aiCategory: "AI动态",
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
        aiCategory: "AI动态",
      },
      {
        id: "3",
        title: "GPT-5 推理能力提升 300%，多模态理解达到新高度",
        url: "https://openai.com",
        pubDate: Date.now() - 1800000, // 30 min ago
        extra: { info: "科技日报" },
        aiScore: 85,
        aiSummary: "GPT-5 在复杂推理任务中表现卓越，图像和文本理解能力显著增强",
        aiComment: "技术突破值得期待",
        aiCategory: "AI动态",
      },
    ] as any,
    financeMarket: [
      {
        id: "6",
        title: "美联储暗示最快 4 月降息，市场情绪转为乐观",
        url: "https://fed.gov",
        pubDate: Date.now() - 1800000, // 30 min ago
        extra: { info: "财联社" },
        aiScore: 85,
        aiSummary: "通胀数据持续降温，鲍威尔释放鸽派信号，风险资产全线上涨",
        aiComment: "关注成长股机会",
        aiCategory: "财经市场",
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
        aiScore: 85,
        aiSummary: "美国拟对华实施更严格芯片出口限制，国产替代进程加速",
        aiComment: "关注国产替代",
        aiCategory: "全球视点",
      },
      {
        id: "5",
        title: "欧洲通过 AI 监管法案，科技巨头面临合规压力",
        url: "https://eu.gov",
        pubDate: Date.now() - 14400000, // 4 hours ago
        extra: { info: "澎湃新闻" },
        aiScore: 82,
        aiSummary: "全球首个全面 AI 监管框架落地，对大模型训练数据提出更高透明度要求",
        aiComment: "合规成本上升",
        aiCategory: "全球视点",
      },
    ] as any,
  }

  console.log("[Test] Generated test briefing:", {
    date: mockBriefing.date,
    aiDynamics: mockBriefing.aiDynamics.length,
    financeMarket: mockBriefing.financeMarket.length,
    globalPerspectives: mockBriefing.globalPerspectives.length,
    marketTemperature: mockBriefing.marketTemperature,
  })

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

  // Send to WeCom (markdown_v2 format) - split by category to avoid length limit
  const WECOM_WEBHOOK = process.env.WECOM_WEBHOOK
  console.log("[Test] WECOM_WEBHOOK:", WECOM_WEBHOOK ? "configured" : "NOT configured")
  if (WECOM_WEBHOOK) {
    const { myFetch } = await import("../utils/fetch")

    // Send AI Dynamics (no limit)
    if (mockBriefing.aiDynamics.length > 0) {
      const aiItems = mockBriefing.aiDynamics
      const aiContent = buildWeComCategoryContent("🤖 AI 动态", aiItems, mockBriefing.date, false)
      console.log("[Test] WeCom AI Dynamics:", aiItems.length, "items, content length:", aiContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: aiContent },
          }),
        })
        console.log("[Test] WeCom AI Dynamics response:", response)
      } catch (error: any) {
        console.error("[Test] WeCom AI Dynamics error:", error?.message || error)
      }
    }

    // Send Finance Market (no limit)
    if (mockBriefing.financeMarket.length > 0) {
      const financeItems = mockBriefing.financeMarket
      const financeContent = buildWeComCategoryContent("💰 财经市场", financeItems, mockBriefing.date, false)
      console.log("[Test] WeCom Finance Market:", financeItems.length, "items, content length:", financeContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: financeContent },
          }),
        })
        console.log("[Test] WeCom Finance Market response:", response)
      } catch (error: any) {
        console.error("[Test] WeCom Finance Market error:", error?.message || error)
      }
    }

    // Send Global Perspectives (no limit)
    if (mockBriefing.globalPerspectives.length > 0) {
      const globalItems = mockBriefing.globalPerspectives
      const globalContent = buildWeComCategoryContent("🌍 全球视点", globalItems, mockBriefing.date, true)
      console.log("[Test] WeCom Global Perspectives:", globalItems.length, "items, content length:", globalContent.length)

      try {
        const response = await myFetch(WECOM_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown_v2",
            markdown_v2: { content: globalContent },
          }),
        })
        console.log("[Test] WeCom Global Perspectives response:", response)
      } catch (error: any) {
        console.error("[Test] WeCom Global Perspectives error:", error?.message || error)
      }
    }

    // Send summary text reminder
    const aiPushed = mockBriefing.aiDynamics.length > 0 ? Math.min(5, mockBriefing.aiDynamics.length) : 0
    const financePushed = mockBriefing.financeMarket.length > 0 ? Math.min(5, mockBriefing.financeMarket.length) : 0
    const globalPushed = mockBriefing.globalPerspectives.length > 0 ? Math.min(5, mockBriefing.globalPerspectives.length) : 0
    const totalPushed = aiPushed + financePushed + globalPushed

    const summaryContent = `📰 本次新闻来自5个渠道，12条信息，过滤推送：
AI动态: ${aiPushed}条
财经市场: ${financePushed}条
全球视点: ${globalPushed}条

由 早8晚8💰 AI推送`
    console.log("[Test] WeCom summary content length:", summaryContent.length)

    try {
      await myFetch(WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: summaryContent },
        }),
      })
      console.log("[Test] WeCom summary sent")
    } catch (error: any) {
      console.error("[Test] WeCom summary error:", error?.message || error)
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
