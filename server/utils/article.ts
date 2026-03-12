import * as cheerio from "cheerio"
import { myFetch } from "./fetch"

const FETCH_TIMEOUT = 10000 // 10 seconds

/**
 * Fetch article content from URL
 * Uses cheerio to extract main content from various news sites
 */
export async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const html = await myFetch(url, {
      timeout: FETCH_TIMEOUT,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    })

    const $ = cheerio.load(html)

    // Try to extract main content using common selectors
    const content = extractContent($)

    return content || null
  } catch (error) {
    console.error("[Content] Failed to fetch:", url, error)
    return null
  }
}

/**
 * Extract main content from HTML using common selectors
 */
function extractContent($: cheerio.CheerioAPI): string {
  // Try common article content selectors in order
  const selectors = [
    "article",
    "[role='main']",
    ".article-content",
    ".article-body",
    ".post-content",
    ".post-body",
    ".entry-content",
    ".content",
    "main",
    "#article",
    ".article",
  ]

  for (const selector of selectors) {
    const element = $(selector)
    if (element.length > 0) {
      const text = cleanText(element.text())
      if (text.length > 100) {
        return text.slice(0, 5000) // Limit to 5000 chars
      }
    }
  }

  // Fallback: get body text
  const bodyText = cleanText($("body").text())
  return bodyText.slice(0, 5000)
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/[\n\r\t]/g, " ") // Remove newlines and tabs
    .trim()
}

/**
 * Fetch content for multiple URLs in parallel
 */
export async function batchFetchContent(
  urls: string[],
  concurrency = 5
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>()

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const promises = batch.map(async (url) => {
      const content = await fetchArticleContent(url)
      return { url, content }
    })

    const batchResults = await Promise.all(promises)
    batchResults.forEach(({ url, content }) => {
      results.set(url, content)
    })
  }

  return results
}
