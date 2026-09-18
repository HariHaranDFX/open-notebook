// Search types
export interface SearchRequest {
  query: string
  type: 'text' | 'vector'
  limit: number
  search_sources: boolean
  search_notes: boolean
  minimum_score: number
  // Notebook scope: omit or [] = whole knowledge base. Validated server-side
  // (see api/routers/search.py); a bad id returns 400/404 before the search
  // runs, so silent empty results are impossible. Cap 50 per api/models.py.
  notebook_ids?: string[]
}

export interface SearchResult {
  id: string
  title: string
  parent_id: string
  final_score: number
  matches?: string[]
  relevance?: number
  similarity?: number
  score?: number
  type?: string
  source_type?: string
  created: string
  updated: string
}

export interface SearchResponse {
  results: SearchResult[]
  total_count: number
  search_type: string
}

// Ask types
export interface AskRequest {
  question: string
  strategy_model: string
  answer_model: string
  final_answer_model: string
  // Notebook scope: omit or [] = whole knowledge base. Server validates and
  // threads through the ask graph state into every fan-out vector_search.
  notebook_ids?: string[]
}

export interface AskResponse {
  answer: string
  question: string
}

// SSE Streaming types
export interface StrategyData {
  reasoning: string
  searches: Array<{
    term: string
    instructions: string
  }>
}

export interface AskStreamEvent {
  type: 'strategy' | 'answer' | 'final_answer' | 'complete' | 'error'
  reasoning?: string
  searches?: Array<{ term: string; instructions: string }>
  content?: string
  final_answer?: string
  message?: string
}
