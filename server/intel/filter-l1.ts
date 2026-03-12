import type { NewsItem } from "~/shared/types"

// Hard blocked keywords - news containing these will be filtered out
// unless they also contain an AI-related keyword
const BLOCKED_KEYWORDS = [
  // Entertainment
  "八卦", "娱乐", "明星", "演唱会", "综艺节目", "电影", "电视剧",
  "演员", "歌手", "网红", "带货", "直播带货",
  // Sports
  "足球", "篮球", "NBA", "世界杯", "进球", "比分", "赛事",
  "球员", "俱乐部", "冠军", "联赛",
  // Gaming
  "游戏", "电竞", "steam", "switch", "ps5", "xbox", "王者荣耀",
  "和平精英", "原神", "游戏攻略", "游戏评测",
  // Local weather
  "天气", "气温", "降雨", "降雪", "台风", "预警", "气象",
  // Other low-value
  "征婚", "相亲", "交友", "抽奖", "优惠券", "促销",
]

// Keywords that boost news to "high value"
const BOOST_KEYWORDS = [
  // AI Core
  "AI", "人工智能", "大模型", "LLM", "AGI", "AIGC", "ChatGPT",
  "OpenAI", "GPT", "Claude", "Gemini", "DeepSeek", "文心一言",
  "通义千问", "智谱AI", "月之暗面", "MiniMax",
  // Hardware
  "芯片", "GPU", "Nvidia", "NVIDIA", "AMD", "英特尔", "华为",
  "H100", "A100", "H200", "B200", "算力", "半导体",
  // Finance/Tech
  "降息", "加息", "美联储", "非农", "CPI", "GDP", "财报",
  " IPO", "上市", "融资", "投资", "估值",
  // Market
  "BTC", "比特币", "以太坊", "加密货币", "美股", "A股",
  "纳斯达克", "道琼斯", "标普", "涨幅", "跌幅",
  // Policy
  "芯片限制", "出口管制", "制裁", "政策", "监管", "美国",
  "中国", "欧盟", "日本", "韩国", "国际",
]

// Keywords for category C activation
const ACTIVATION_KEYWORDS = [
  "AI", "人工智能", "大模型", "LLM", "AGI",
  "OpenAI", "Nvidia", "芯片", "特斯拉", "苹果", "谷歌",
  "微软", "亚马逊", "Meta", "英伟达",
]

export interface FilterResult {
  item: NewsItem
  blocked: boolean
  boosted: boolean
  activationMatched?: boolean
}

export function heuristicFilter(items: NewsItem[]): FilterResult[] {
  return items.map((item) => {
    const title = item.title.toLowerCase()
    const blockedKeywordsFound = BLOCKED_KEYWORDS.filter(
      (kw) => title.includes(kw.toLowerCase())
    )
    const boostKeywordsFound = BOOST_KEYWORDS.filter(
      (kw) => title.includes(kw.toLowerCase())
    )
    const activationKeywordsFound = ACTIVATION_KEYWORDS.filter(
      (kw) => title.includes(kw.toLowerCase())
    )

    // Block if has blocked keywords AND no boost keywords
    const blocked =
      blockedKeywordsFound.length > 0 && boostKeywordsFound.length === 0

    // Boost if has any boost keywords
    const boosted = boostKeywordsFound.length > 0

    // For category C sources, check if activation keyword matched
    const activationMatched = activationKeywordsFound.length > 0

    return {
      item,
      blocked,
      boosted,
      activationMatched,
    }
  })
}

export function getFilteredItems(items: NewsItem[]): NewsItem[] {
  return heuristicFilter(items)
    .filter((r) => !r.blocked)
    .map((r) => r.item)
}

export function getBoostedItems(items: NewsItem[]): NewsItem[] {
  return heuristicFilter(items)
    .filter((r) => r.boosted && !r.blocked)
    .map((r) => r.item)
}
