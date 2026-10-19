import type { Course } from '../types'

/** 返回以 rootId 为根的课程子树（含自身）的所有 id。 */
export function subtreeIds(courses: Course[], rootId: string): string[] {
  const ids: string[] = []
  const collect = (id: string) => {
    ids.push(id)
    courses.filter((c) => c.parentId === id).forEach((c) => collect(c.id))
  }
  collect(rootId)
  return ids
}

/** 返回从根到目标课程的路径（含自身），用于面包屑。 */
export function coursePath(courses: Course[], id: string): Course[] {
  const byId = new Map(courses.map((c) => [c.id, c]))
  const path: Course[] = []
  let cur: Course | undefined = byId.get(id)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path
}

/** 统计某课程子树下的知识点数量。 */
export function countKPsInSubtree(
  courses: Course[],
  kps: { courseId: string }[],
  rootId: string,
): number {
  const ids = new Set(subtreeIds(courses, rootId))
  return kps.filter((k) => ids.has(k.courseId)).length
}
