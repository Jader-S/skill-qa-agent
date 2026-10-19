// 语音抽象层（Phase 3 客户端模态层）
// 仅保留「语音 → 文字」（STT，用来自测/面试作答），刻意不提供 TTS 朗读：
// 题目与评语直接看文字即可，朗读没有价值。
// 默认实现基于浏览器原生 Web Speech API：SpeechRecognition。零依赖、免 Key、中文稳。
// 后续可新增 WhisperProvider（本地 wasm/worker）实现同一接口，主流程无需改动——只换 `speech` 这一个导出。

declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
    SpeechRecognitionErrorEvent?: any
  }
}

export type SpeechProvider = {
  readonly name: string
  /** 当前环境是否支持语音识别（需浏览器 + 麦克风权限）。 */
  isSupported(): boolean
  /** 语音转文字：点击开始，说完后自动结束（无结果也可超时结束）。onPartial 实时回传临时文本。 */
  listen(opts?: {
    lang?: string
    maxMs?: number
    onPartial?: (t: string) => void
  }): Promise<string>
  /** 中止正在进行的识别；已识别到的文字仍会正常返回（没有进行中的识别则无操作）。 */
  stopListening(): void
}

// 浏览器不支持时的占位（便于测试 / 报错清晰）。
class MockSpeechProvider implements SpeechProvider {
  readonly name = 'mock'
  isSupported() {
    return false
  }
  async listen(): Promise<string> {
    throw new Error('当前环境不支持语音识别（需 Chrome/Edge 且授予麦克风权限）')
  }
  stopListening(): void {}
}

// 基于 Web Speech API 的实现。
class WebSpeechProvider implements SpeechProvider {
  readonly name = 'web-speech'
  private Ctor: any
  private active: any = null

  constructor() {
    this.Ctor =
      typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined
  }

  isSupported(): boolean {
    return !!this.Ctor
  }

  listen({
    lang = 'zh-CN',
    maxMs = 15000,
    onPartial,
  }: { lang?: string; maxMs?: number; onPartial?: (t: string) => void } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.Ctor) {
        reject(new Error('当前环境不支持语音识别'))
        return
      }
      const rec: any = new this.Ctor()
      rec.lang = lang
      rec.interimResults = true
      rec.continuous = false
      rec.maxAlternatives = 1

      let finalText = ''
      let lastInterim = ''
      let settled = false
      const timer = setTimeout(() => {
        try {
          rec.stop()
        } catch {
          /* noop */
        }
      }, maxMs)

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.active = null
        fn()
      }

      rec.onresult = (e: any) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        lastInterim = interim
        if (onPartial) onPartial(interim)
      }
      rec.onerror = (e: any) => settle(() => reject(new Error(e?.error || 'speech-recognition-error')))
      // 结束（自然结束 / 超时 / 手动停止）时，把尚未定稿的尾句也带回去，避免丢字。
      rec.onend = () => settle(() => resolve((finalText + lastInterim).trim()))
      try {
        rec.start()
        this.active = rec
      } catch (err: any) {
        settle(() => reject(new Error(err?.message || '无法启动语音识别')))
      }
    })
  }

  stopListening(): void {
    try {
      this.active?.stop()
    } catch {
      /* noop */
    }
  }
}

export const speech: SpeechProvider =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    ? new WebSpeechProvider()
    : new MockSpeechProvider()
