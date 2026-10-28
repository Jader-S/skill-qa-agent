import type { KnowledgePoint, Question, InterviewRound } from '../types'
import { SCORE_JSON } from './analysis'

export function buildGenerateMessages(
  kps: KnowledgePoint[],
  count = 2,
): { system: string; user: string } {
  const system = `你是一位严格的前端 / 全栈 / AI 应用方向面试官与讲师。只能依据下面提供的知识点内容出题，不要编造知识点之外的信息。请输出 JSON 数组，每个元素格式：{"kp":"该题来源知识点的标题（须与提供的一致）","type":"choice|short_answer|code","stem":"题目","options":["A...","B..."]（仅 choice 需要）,"modelAnswer":"参考答案","difficulty":"easy|medium|hard","explanation":"解析"}。只输出 JSON，不要任何额外文字。`
  const user =
    `知识点列表（标题 + 内容）：\n` +
    kps.map((k) => `【${k.title}】\n${k.content}`).join('\n\n') +
    `\n\n请基于上述知识点，总共生成约 ${count * kps.length} 道题，覆盖不同题型与难度。`
  return { system, user }
}

export function buildScoreMessages(
  q: Question,
  kp: KnowledgePoint,
  userAnswer: string,
): { system: string; user: string } {
  const system = `你是评分官。只能依据以下知识点与标准答案评分，不确定要明确说明。${SCORE_JSON}`
  const user = `知识点：【${kp.title}】\n${kp.content}\n\n题目：${q.stem}\n标准答案：${q.modelAnswer}\n\n考生作答：${userAnswer}\n\n请给出评分 JSON。`
  return { system, user }
}

export function buildFollowupMessages(
  q: Question,
  kp: KnowledgePoint,
  userAnswer: string,
  feedback: string,
): { system: string; user: string } {
  const system = `你是循循善诱的导师。基于已作答的题目与反馈，提出一个围绕该知识点的深入追问（可换角度、挖原理或联系实际）。用简洁中文直接给出追问本身，不要解释。`
  const user = `知识点：【${kp.title}】\n${kp.content}\n题目：${q.stem}\n考生作答：${userAnswer}\n评分反馈：${feedback}\n\n请提出一个深入追问。`
  return { system, user }
}

const INTERVIEW_INTENTS = ['基础概念', '原理深挖', '实战编码', '调试排错', '系统设计']

/**
 * 模拟面试：生成一道面试题。
 * @param role 目标岗位
 * @param context 检索到的相关知识点（grounding）
 * @param roundIndex 当前轮次（用于轮换考察意图，避免重复）
 * @param askedQuestions 已问过的题目，避免重复
 */
export function buildInterviewQuestionMessages(
  role: string,
  context: string,
  roundIndex: number,
  askedQuestions: string[],
): { system: string; user: string } {
  const intent = INTERVIEW_INTENTS[roundIndex % INTERVIEW_INTENTS.length]
  const system = `你是一位资深的「${role}」方向面试官。只能依据下面的知识点出题，不要编造超纲内容。请结合本轮考察意图「${intent}」出一道有区分度的面试题。输出 JSON：{"question":"题目","intent":"${intent}","reference":"参考答案要点"}。只输出 JSON。`
  const user =
    `相关知识点（grounding）：\n${context}\n\n` +
    `本轮考察意图：${intent}\n` +
    (askedQuestions.length ? `已问过的题目（请勿重复）：\n${askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n` : '') +
    `\n请输出本道面试题的 JSON。`
  return { system, user }
}

/** 模拟面试：对单轮作答评分。 */
export function buildInterviewScoreMessages(
  role: string,
  context: string,
  round: { question: string; reference: string; userAnswer: string },
): { system: string; user: string } {
  const system = `你是「${role}」面试官，负责评分。只能依据以下知识点与参考答案要点评分，不确定要明确说明。${SCORE_JSON}`
  const user = `相关知识点：\n${context}\n\n题目：${round.question}\n参考答案要点：${round.reference}\n考生作答：${round.userAnswer}\n\n请给出评分 JSON。`
  return { system, user }
}

/** 模拟面试：末轮整体评估。 */
export function buildInterviewEvalMessages(
  role: string,
  history: InterviewRound[],
): { system: string; user: string } {
  const system = `你是「${role}」方向资深面试官，请给出整体评估。输出 JSON：{"overall":0-100,"level":"初级/中级/高级/待提升","strengths":["优势"],"weaknesses":["不足"],"recommendation":"针对性提升建议"}。只输出 JSON。`
  const user =
    `本轮面试共 ${history.length} 题，逐轮记录：\n` +
    history
      .map(
        (h, i) =>
          `第${i + 1}题（${h.intent}）得分${h.score}：\n题：${h.question}\n作答：${h.userAnswer}\n反馈：${h.feedback}`,
      )
      .join('\n\n') +
    `\n\n请给出整体评估 JSON。`
  return { system, user }
}

/**
 * AI 优化补充：以用户的笔记原文为主体（不改动、不重述），仅产出「补充与拓展」段落，
 * 用于填补遗漏、补充易错点 / 关联概念 / 实战例子 / 面试要点。返回 Markdown。
 */
export function buildOptimizeMessages(kp: KnowledgePoint): { system: string; user: string } {
  const system = `你是一位资深的前端 / 全栈 / AI 应用方向导师。用户会给你一段「笔记原文」。请严格遵循：
1. 不得改写、不得重复笔记原文，原文保持不变由系统单独展示；
2. 只产出「补充与拓展」内容，使用 Markdown，可包含：易错点 / 常见陷阱、与其它知识点的关联、一个简短实战示例、面试常考点、进阶方向；
3. 若原文已很完整，也请给出 1-2 条有价值的补充或提示，不要空白；
4. 直接输出 Markdown，不要任何额外解释或包裹符号。`
  const user = `笔记标题：${kp.title}\n\n笔记原文：\n${kp.content}\n\n请基于上述原文，产出「补充与拓展」（Markdown）。`
  return { system, user }
}

export function buildOutlineMessages(input: {
  name: string
  goal: string
  depth: '入门' | '进阶'
  interests: string[]
}): { system: string; user: string } {
  const system = `你是课程设计师。根据主题生成最多 3 层的章节目录，不要写知识点正文。输出 JSON：{"chapters":[{"title":"章名","blurb":"一句话简介","children":[]}]}。children 结构相同，叶子的 children 为空数组。只输出 JSON。`
  const user = `课程名：${input.name}\n深度：${input.depth}\n目标：${input.goal || '未指定'}\n感兴趣的点：${input.interests.join('、') || '无'}\n请生成目录。`
  return { system, user }
}

export function buildChapterKpMessages(chapter: string, blurb: string, course: string): { system: string; user: string } {
  const system = `你是讲师。只为这一节写 2 到 4 个知识点，每个有标题和 Markdown 正文。输出 JSON：{"points":[{"title":"标题","content":"正文"}]}。不要输出目录。只输出 JSON。`
  const user = `课程：${course}\n章节：${chapter}\n简介：${blurb || '无'}\n请写这一节的知识点。`
  return { system, user }
}

export function buildInterestMessages(input: {
  course: string
  chapters: string[]
  interest: string
}): { system: string; user: string } {
  const system = `你是讲师。用户想补充一个感兴趣的点。输出 JSON：{"action":"points|chapter","chapterTitle":"若 action 为 chapter 则是新章节名，否则空字符串","points":[{"title":"标题","content":"Markdown 正文"}]}。能放进现有章节就用 points，需要新开一节才用 chapter。只输出 JSON。`
  const user = `课程：${input.course}\n已有章节：${input.chapters.join('、') || '无'}\n感兴趣的点：${input.interest}`
  return { system, user }
}
