import { myFetch } from "./fetch"
import { fetchArticleContent } from "./article"

const IFLOW_API_KEY = process.env.IFLOW_API_KEY
const IFLOW_BASE_URL = process.env.IFLOW_BASE_URL || "https://apis.iflow.cn/v1"
const IFLOW_MODEL = process.env.IFLOW_MODEL || "kimi-k2-0905"

interface LLMMessage {
  role: "system" | "user"
  content: string
}

interface LLMResponse {
  id: string
  choices: Array<{
    message: {
      content: string
    }
  }>
}

/**
 * Call iFlow API (Kimi) to score a news item
 */
export async function callLLM(
  messages: LLMMessage[]
): Promise<string> {
  if (!IFLOW_API_KEY) {
    throw new Error("IFLOW_API_KEY is not set")
  }

  const response = await myFetch(`${IFLOW_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${IFLOW_API_KEY}`,
    },
    body: {
      model: IFLOW_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 1000,
    },
  })

  const data = response as LLMResponse

  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from iFlow API")
  }

  return data.choices[0].message.content
}

/**
 * Generate AI score and summary for a single news item
 * Fetches article content first, then scores using both title and content
 * Returns score (0-100), summary (100 chars), comment (20 chars), and category
 */
export async function scoreWithAI(
  title: string,
  url: string,
  options: { fetchContent?: boolean } = {}
): Promise<{ score: number; summary: string; comment: string; category?: "AI动态" | "财经市场" | "全球视点" }> {
  const fetchContent = options.fetchContent !== false // default to true

  // Fetch article content for better scoring
  let content = ""
  if (fetchContent) {
    try {
      content = (await fetchArticleContent(url)) || ""
    } catch (error) {
      console.error("[LLM] Failed to fetch content:", error)
    }
  }

  const systemPrompt = `你是一位拥有深厚科技背景、宏观经济视野和敏锐投资嗅觉的"私人情报专家"。你的任务是为一名关注 AI 行业的爱好者、全球新闻观察者及业余投资者筛选海量新闻，并提供深度的价值评估。

评分标准（总分100分）：

1. AI 认知增长 (权重 40%)：
- 是否涉及 AI 产业链重大变动（如芯片、模型更新、算力、应用落地）？
- 是否能帮助初学者理解核心概念（如 AGI、RAG、Scaling Laws）？
- 评分：单纯的营销软文 0-10 分；行业里程碑事件（如 GPT-5 发布、Nvidia 财报） 35-40 分。

2. 市场温度感知 (权重 30%)：
- 是否包含宏观指标（降息、非农、通胀数据）？
- 是否涉及行业板块轮动或具有投资参考价值的财务信号？
- 评分：常规市场波动 5-10 分；足以影响理财决策或改变市场预期的重要转折点 25-30 分。

3. 世界格局观测 (权重 30%)：
- 是否揭示了国际局势（地缘冲突、大国博弈）或重大政策调整？
- 是否影响社会生产力结构或全球供应链？
- 评分：区域性小新闻 0-10 分；影响全球政经大势的节点性事件 25-30 分。

分类标准：
- AI动态：涉及 AI 产业链、模型更新、芯片、算力、应用落地、AGI、大模型等
- 财经市场：涉及宏观经济、降息/加息、美联储、财报、股市、通胀、投资建议等
- 全球视点：涉及国际局势、地缘冲突、大国博弈、全球政策、国际关系等

返回格式要求：
请严格按照以下JSON格式返回，不要有任何额外文字：
{"score": 85, "summary": "150字左右的摘要，说明这条信息的核心价值和意义", "comment": "30字以内的简短点评或行动建议", "category": "AI动态"}`

  // Build user prompt with or without content
  let userPrompt = `标题：${title}\n链接：${url}`
  if (content) {
    userPrompt += `\n\n正文内容：\n${content.slice(0, 3000)}` // Limit content to 3000 chars
  }
  userPrompt += "\n\n请给出评分、摘要和点评："

  try {
    const result = await callLLM([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ])

    // Parse JSON response
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error("[LLM] Invalid JSON response:", result)
      return { score: 0, summary: "无法生成摘要", comment: "无点评" }
    }

    const parsed = JSON.parse(jsonMatch[0])
    const score = parseInt(String(parsed.score), 10)
    const summary = (parsed.summary || "").slice(0, 200)
    const comment = (parsed.comment || "").slice(0, 30)
    const category = parsed.category as "AI动态" | "财经市场" | "全球视点" | undefined

    if (Number.isNaN(score) || score < 0 || score > 100) {
      console.error("[LLM] Invalid score response:", result)
      return { score: 0, summary: "无法生成摘要", comment: "无点评" }
    }

    return { score, summary, comment, category }
  } catch (error) {
    console.error("[LLM] Failed to score item:", error)
    return { score: 0, summary: "无法生成摘要", comment: "无点评" }
  }
}

/**
 * Batch score multiple items
 * Note: LLM doesn't have batch scoring, so we parallelize
 */
export async function batchScoreWithAI(
  items: Array<{ title: string; url: string }>,
  options: { fetchContent?: boolean } = {}
): Promise<Array<{ score: number; summary: string; comment: string }>> {
  const promises = items.map((item) =>
    scoreWithAI(item.title, item.url, options)
  )
  return Promise.all(promises)
}
