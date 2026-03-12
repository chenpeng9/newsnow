import type { NewsItem } from "~/shared/types"
import { getEmbedding, cosineSimilarity } from "../utils/ollama"

const SIMILARITY_THRESHOLD = 0.85
const TIME_WINDOW_HOURS = 12

export interface DedupeResult {
  item: NewsItem
  isDuplicate: boolean
  originalItem?: NewsItem
  similarity?: number
}

/**
 * Deduplicate news items using semantic similarity
 * Uses Ollama embeddings to compute similarity between titles
 */
export async function deduplicate(items: NewsItem[]): Promise<NewsItem[]> {
  if (items.length <= 1) {
    return items
  }

  // Get embeddings for all items
  const embeddings = await Promise.all(
    items.map((item) => getEmbedding(item.title))
  )

  const kept: NewsItem[] = []
  const processedIndices = new Set<number>()

  for (let i = 0; i < items.length; i++) {
    if (processedIndices.has(i)) {
      continue
    }

    const current = items[i]
    const currentEmbedding = embeddings[i]
    const group: { item: NewsItem; embedding: number[]; index: number }[] = [
      { item: current, embedding: currentEmbedding, index: i },
    ]

    // Find all similar items
    for (let j = i + 1; j < items.length; j++) {
      if (processedIndices.has(j)) {
        continue
      }

      const similarity = cosineSimilarity(currentEmbedding, embeddings[j])

      if (similarity >= SIMILARITY_THRESHOLD) {
        group.push({ item: items[j], embedding: embeddings[j], index: j })
        processedIndices.add(j)
      }
    }

    // Keep the best one (most authoritative source or longest title)
    const best = selectBestItem(group.map((g) => g.item))
    kept.push(best)

    // Mark all group items as processed
    group.forEach((g) => processedIndices.add(g.index))
  }

  return kept
}

/**
 * Select the best item from a group of similar items
 * Criteria:
 * 1. Longer title (more info)
 * 2. Authoritative source (if source info available)
 */
function selectBestItem(items: NewsItem[]): NewsItem {
  if (items.length === 1) {
    return items[0]
  }

  // Sort by title length (longer = more info)
  return items.reduce((best, current) => {
    return current.title.length > best.title.length ? current : best
  })
}

/**
 * Filter items within time window
 * Removes items older than TIME_WINDOW_HOURS
 */
export function filterByTimeWindow(items: NewsItem[]): NewsItem[] {
  const now = Date.now()
  const windowMs = TIME_WINDOW_HOURS * 60 * 60 * 1000

  return items.filter((item) => {
    // If no timestamp, keep it
    if (!item.extra?.time) {
      return true
    }

    // Try to parse timestamp from various formats
    const timestamp = parseTimestamp(item.extra.time as string)
    if (!timestamp) {
      return true
    }

    return now - timestamp < windowMs
  })
}

function parseTimestamp(timeValue: string | number): number | null {
  if (typeof timeValue === "number") {
    return timeValue > 1e12 ? timeValue : timeValue * 1000
  }

  const parsed = new Date(timeValue).getTime()
  return Number.isNaN(parsed) ? null : parsed
}
