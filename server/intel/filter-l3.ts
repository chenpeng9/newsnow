import type { NewsItem } from "~/shared/types"
import { scoreWithAI } from "../utils/llm"

const HIGH_VALUE_THRESHOLD = 80

export interface ScoredItem extends NewsItem {
  aiScore: number
  aiSummary?: string
  aiComment?: string
}

/**
 * Score news items using AI (L3 layer)
 * Returns items with their AI scores, summaries and comments
 */
export async function scoreItems(items: NewsItem[]): Promise<ScoredItem[]> {
  const results: ScoredItem[] = []
  const total = items.length

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      const { score, summary, comment } = await scoreWithAI(item.title, item.url)
      results.push({
        ...item,
        aiScore: score,
        aiSummary: summary,
        aiComment: comment,
      })

      // Log progress every 10 items
      if ((i + 1) % 10 === 0 || i + 1 === total) {
        console.log(`[L3] Progress: ${i + 1}/${total} (${Math.round((i + 1) / total * 100)}%)`)
      }
    } catch (error) {
      console.error("[L3] Failed to score item:", item.title, error)
      results.push({
        ...item,
        aiScore: 0,
        aiSummary: "无法生成摘要",
        aiComment: "无点评",
      })
    }
  }

  return results
}

/**
 * Get high value items (score > 80)
 */
export function getHighValueItems(items: ScoredItem[]): ScoredItem[] {
  return items.filter((item) => item.aiScore >= HIGH_VALUE_THRESHOLD)
}

/**
 * Sort items by AI score descending
 */
export function sortByScore(items: ScoredItem[]): ScoredItem[] {
  return [...items].sort((a, b) => b.aiScore - a.aiScore)
}
