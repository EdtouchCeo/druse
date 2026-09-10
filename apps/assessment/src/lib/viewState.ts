import type { Project, Technique } from './types'
import { TECHNIQUES } from '../data/questionBank'
import { CANVAS_GUIDES, SOCIAL_GUIDES } from '../data/writingGuides'

type Kind = 'social' | 'business'
type CursorProject = Pick<Project, 'id' | 'technique'>
type CursorStorage = Pick<Storage, 'getItem' | 'setItem'>
type SavedView = { step?: unknown; questions?: Partial<Record<Technique, unknown>> }
const key = (project: CursorProject, kind: Kind) => `daeryun-assessment:view:v1:${project.id}:${kind}`
function browserStorage(): CursorStorage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}
function read(project: CursorProject, kind: Kind, storage: CursorStorage | null): SavedView {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key(project, kind)) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as SavedView
  } catch { /* A damaged cursor must not prevent opening the student's draft. */ }
  return {}
}
function index(value: unknown, count: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : 0
}
export function readViewState(project: CursorProject, kind: Kind, storage: CursorStorage | null = browserStorage()): { step: number; question: number } {
  const saved = read(project, kind, storage)
  return {
    step: index(saved.step, kind === 'social' ? SOCIAL_GUIDES.length : CANVAS_GUIDES.length),
    question: index(saved.questions?.[project.technique], TECHNIQUES[project.technique].questions.length),
  }
}
export function writeViewState(project: CursorProject, kind: Kind, step: number, question: number, storage: CursorStorage | null = browserStorage()): void {
  if (!storage) return
  const saved = read(project, kind, storage)
  const questions = Object.fromEntries(Object.values(TECHNIQUES).map(t => [t.key, index(saved.questions?.[t.key], t.questions.length)]))
  questions[project.technique] = index(question, TECHNIQUES[project.technique].questions.length)
  try {
    storage.setItem(key(project, kind), JSON.stringify({ step: index(step, kind === 'social' ? SOCIAL_GUIDES.length : CANVAS_GUIDES.length), questions }))
  } catch { /* Optional navigation state never blocks writing, saving, or backups. */ }
}
