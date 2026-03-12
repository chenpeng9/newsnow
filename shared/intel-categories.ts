// Intel categories configuration - optimized for AI/finance/investment
// A: Deep/Professional - 30-60min interval - Core financial/tech sources
// B: Macro/Global - 2hr interval - World news sources
// C: Real-time/Hot - 2hr interval - Hot search (optional, may have issues)
// D: Tech Community - 4hr/daily interval - Developer/Tech sources

export const intelCategories = {
  A: {
    name: "深度/专业级",
    weight: 1.0,
    interval: 30 * 60 * 1000, // 30 min
    sources: [
      // Financial - Core
      "jin10",           // 金十数据 - 金融快讯
      "wallstreetcn-hot", // 华尔街见闻 - 热门
      "cls-depth",       // 财联社 - 深度
      "fastbull-express", // 法布财经 - 快讯
    ],
  },
  B: {
    name: "宏观/全球视野",
    weight: 0.8,
    interval: 2 * 60 * 60 * 1000, // 2 hr
    sources: [
      "cls-hot",         // 财联社 - 热门
      "36kr-quick",     // 36氪 - 快讯
      "cankaoxiaoxi",   // 参考消息
      "sputniknewscn",  // 卫星通讯社
      "ifeng",          // 凤凰网
      "thepaper",       // 澎湃新闻
      "wallstreetcn-quick", // 华尔街见闻 - 快讯
    ],
  },
  C: {
    name: "实时热度/情绪",
    weight: 0.5,
    interval: 2 * 60 * 60 * 1000, // 2 hr
    keywordActivated: true,
    sources: [
      // 注意：这些源可能有反爬虫机制
      "baidu",           // 百度热搜
      "weibo",          // 微博热搜
      "zhihu",          // 知乎热榜
      "36kr-renqi",      // 36氪 - 人气榜
    ],
  },
  D: {
    name: "科技社区/生产力",
    weight: 0.7,
    interval: 4 * 60 * 60 * 1000, // 4 hr
    sources: [
      "ithome",         // IT之家
      "sspai",         // 少数派
      "juejin",        // 稀土掘金
      "solidot",       // Solidot
    ],
  },
} as const

export type IntelCategory = keyof typeof intelCategories
