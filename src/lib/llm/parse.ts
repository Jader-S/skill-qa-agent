export async function collectStream(
  stream: AsyncIterable<string>,
): Promise<string> {
  let s = ''
  for await (const c of stream) s += c
  return s
}

/** 从模型文本中稳健提取 JSON（容忍前后多余文字）。 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* fallthrough */
  }
  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)) as T
  }
  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    return JSON.parse(trimmed.slice(objStart, objEnd + 1)) as T
  }
  throw new Error('无法将模型输出解析为 JSON')
}
