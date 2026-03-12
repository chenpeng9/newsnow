import { myFetch } from "./fetch"
import type { ScoredItem } from "../intel/filter"

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK

interface WebhookMessage {
  content?: string
  embeds?: DiscordEmbed[]
}

interface DiscordEmbed {
  title: string
  description: string
  color: number
  url?: string
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

/**
 * Send high value alert to Feishu with rich card format
 */
export async function sendFeishuAlert(item: ScoredItem): Promise<void> {
  if (!FEISHU_WEBHOOK) {
    console.warn("[Notify] FEISHU_WEBHOOK not configured")
    return
  }

  const card = {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `🔥 AI情报高能预警 [${item.aiScore}分]`,
        },
        template: "red",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**${item.title}**`,
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `💡 **价值摘要**: ${item.aiSummary || "暂无摘要"}`,
          },
        },
        {
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
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `来源: ${item.extra?.info || "金十数据"} | 发布时间: ${item.pubDate || "未知"}`,
          },
        },
      ],
    },
  }

  try {
    const response = await myFetch(FEISHU_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    })
    console.log("[Feishu] Alert sent:", item.title, "Response:", response)
  } catch (error: any) {
    console.error("[Feishu] Failed to send alert:", item.title, error?.message || error)
  }
}

/**
 * Send high value alert to Discord
 */
export async function sendDiscordAlert(item: ScoredItem): Promise<void> {
  if (!DISCORD_WEBHOOK) {
    console.warn("[Notify] DISCORD_WEBHOOK not configured")
    return
  }

  const message: WebhookMessage = {
    embeds: [
      {
        title: `🔥 AI情报高能预警 [${item.aiScore}分]`,
        description: item.title,
        color: 0xff6600, // Orange
        url: item.url,
        fields: [
          {
            name: "💡 价值摘要",
            value: item.aiSummary || "暂无摘要",
          },
        ],
        footer: {
          text: "AI 情报管家",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  }

  try {
    await myFetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
    console.log("[Discord] Alert sent:", item.title)
  } catch (error) {
    console.error("[Discord] Failed to send alert:", error)
  }
}

/**
 * Send alert to all configured webhooks
 */
export async function sendAlert(item: ScoredItem): Promise<void> {
  await Promise.all([sendFeishuAlert(item), sendDiscordAlert(item)])
}

/**
 * Send batch alerts
 */
export async function sendAlerts(items: ScoredItem[]): Promise<void> {
  await Promise.all(items.map((item) => sendAlert(item)))
}

/**
 * Test webhook connectivity
 */
export async function testWebhooks(): Promise<{
  feishu: boolean
  discord: boolean
}> {
  const results = { feishu: false, discord: false }

  if (FEISHU_WEBHOOK) {
    try {
      await myFetch(FEISHU_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: "🔔 AI 情报管家测试消息" },
        }),
      })
      results.feishu = true
    } catch {
      results.feishu = false
    }
  }

  if (DISCORD_WEBHOOK) {
    try {
      await myFetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "🔔 AI 情报管家测试消息",
        }),
      })
      results.discord = true
    } catch {
      results.discord = false
    }
  }

  return results
}
