export type Technique = 'path' | 'local' | 'game' | 'expert'
export type Mode = 'example' | 'guided' | 'solo'
export type SocialKey = 'situation' | 'empathy' | 'definition' | 'ideas' | 'prototype' | 'test'
export type CanvasKey = 'problem' | 'customerSegments' | 'uvp' | 'solution' | 'channels' | 'revenue' | 'costs' | 'keyMetrics' | 'unfairAdvantage'
export interface Guide { key: string; label: string; question: string; clue: string; starter: string; checks: string[] }
export interface Question { id: string; question: string; example: string; clue: string; starter: string; checks: string[] }
export interface TechniqueContent { key: Technique; label: string; summary: string; flow: string; questions: Question[]; caution: string }
export interface Example { technique: Technique; title: string; source: string; social: Record<SocialKey,string>; canvas: Record<CanvasKey,string> }
export interface Practice { id: string; technique: Technique; title: string; situation: string; source: string; change: string }
export interface Review { field: string; original: string; revision: number; createdAt: string; prompts: string[]; reason: string; checked?: number[] }
export interface PlanSnapshot { revision: number; at: string; title: string; technique: Technique; social: Record<SocialKey,string>; answers: Record<Technique,Record<string,string>> }
export interface Project {
  schemaVersion: 1; id: string; revision: number; socialRevision: number; title: string; createdAt: string; updatedAt: string;
  technique: Technique; mode: Mode; source: string; practiceId: string; same: string; different: string; choiceReason: string;
  social: Record<SocialKey,string>; answers: Record<Technique,Record<string,string>>; canvas: Record<CanvasKey,string>;
  sources: string; author: string; reviews: Record<string,Review>; linkedPlan: PlanSnapshot | null;
  sketch: string; variation: string;
}
export interface SaveResult { project: Project; conflict: boolean }
