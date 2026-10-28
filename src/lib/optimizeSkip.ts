/** Mock 离线补充以「（Mock」开头（旧数据也可能是追问文案）。 */
export function isMockSupplement(content?: string): boolean {
  const text = content?.trim() ?? ''
  return text.startsWith('（Mock') || text.startsWith('(Mock')
}

/**
 * 「跳过已有补充」只跳过真实补充。
 * Mock 占位默认重做；仅在跳过真实补充且同时要求跳过 Mock 时才留下。
 * 取消「跳过已有补充」（整批重跑）时，Mock 一并重做。
 */
export function optimizeSkipReason(
  kp: { aiContent?: string },
  opts: { skipOptimized: boolean; skipMock: boolean },
): 'optimized' | 'mock' | null {
  const content = kp.aiContent?.trim()
  if (!content) return null
  if (isMockSupplement(content)) {
    if (!opts.skipOptimized) return null
    return opts.skipMock ? 'mock' : null
  }
  return opts.skipOptimized ? 'optimized' : null
}
