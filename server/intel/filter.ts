import type { NewsItem } from "~/shared/types"
import { heuristicFilter } from "./filter-l1"
import { deduplicate, filterByTimeWindow } from "./filter-l2"
import { scoreItems, getHighValueItems, type ScoredItem } from "./filter-l3"

export { type ScoredItem }

/**
 * Process items through filter layers
 * L1: Heuristic filtering (keyword blocking/boosting)
 * L2: Time window filter + Semantic deduplication (using Ollama embeddings)
 * L3: AI scoring (using DeepSeek)
 */
export async function processIntel(items: NewsItem[]): Promise<ScoredItem[]> {
  console.log(`[Filter] ========== Start processing ==========`)
  console.log(`[Filter] Input: ${items.length} items`)

  // L1: Heuristic filter
  console.log(`[Filter] L1: Running heuristic filter...`)
  const l1Results = heuristicFilter(items)
  const l1Filtered = l1Results
    .filter((r) => !r.blocked)
    .map((r) => r.item)
  const blocked = l1Results.length - l1Filtered.length
  console.log(`[Filter] L1: Done. Blocked: ${blocked}, Passed: ${l1Filtered.length}`)

  // L2: Time window filter + Deduplication
  console.log(`[Filter] L2: Running time window filter...`)
  let l2Filtered = filterByTimeWindow(l1Filtered)
  console.log(`[Filter] L2: After time window: ${l2Filtered.length} items`)

  console.log(`[Filter] L2: Running semantic deduplication (Ollama)...`)
  try {
    l2Filtered = await deduplicate(l2Filtered)
    console.log(`[Filter] L2: After deduplication: ${l2Filtered.length} items`)
  } catch (error) {
    console.error("[Filter] L2 deduplication failed, skipping:", error)
  }

  // L3: AI scoring
  console.log(`[Filter] L3: Running AI scoring (DeepSeek)... ${l2Filtered.length} items`)
  const l3Scored = await scoreItems(l2Filtered)
  console.log(`[Filter] L3: Done. Scored: ${l3Scored.length} items`)

  // Summary
  const highValue = l3Scored.filter((i) => i.aiScore >= 80).length
  console.log(`[Filter] ========== Done! High-value (>=80): ${highValue} ==========`)

  return l3Scored
}

/**
 * Get high value items that should trigger alerts (score >= 80)
 */
export async function getAlertItems(
  items: NewsItem[]
): Promise<ScoredItem[]> {
  const scored = await processIntel(items)
  return getHighValueItems(scored)
}

/**
 * Quick filter - L1 only (for real-time processing)
 */
export function quickFilter(items: NewsItem[]): NewsItem[] {
  const results = heuristicFilter(items)
  return results.filter((r) => !r.blocked).map((r) => r.item)
}
