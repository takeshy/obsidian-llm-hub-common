/** Token and cost accounting reported by a streaming provider. Every field is optional because
 * providers report different subsets. */
export interface StreamChunkUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
  totalCost?: number;       // USD
  webSearchRequests?: number;
}
