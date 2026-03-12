import { myFetch } from "../utils/fetch"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "bge-m3"
const OLLAMA_TIMEOUT = 60000 // 60 seconds timeout

export interface EmbeddingResponse {
  embedding: number[]
}

/**
 * Get embedding for a text using Ollama's embedding API
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await myFetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: "POST",
      timeout: OLLAMA_TIMEOUT,
      body: {
        model: OLLAMA_MODEL,
        prompt: text,
      },
    }) as EmbeddingResponse

    return response.embedding
  } catch (error) {
    console.error("[Ollama] Failed to get embedding:", error)
    throw error
  }
}

/**
 * Get embeddings for multiple texts in batch
 */
export async function getBatchEmbeddings(
  texts: string[]
): Promise<number[][]> {
  // Ollama doesn't have batch embedding API, so we parallelize
  const promises = texts.map((text) => getEmbedding(text))
  return Promise.all(promises)
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length")
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
