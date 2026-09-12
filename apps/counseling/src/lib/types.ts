import type {AdminAction,AdminData} from './admin'
export type Mode = 'local' | 'online'
export type Student = { student_id: string; student_number: string; academic_year: number; school_stage: 'middle' | 'high'; grade: number; name?: string }
export type Actor = { id: string; display_name: string; approved: boolean; role?: 'teacher' | 'student' | 'manager'; can_manage?: boolean; student_id?: string }
export type Health = { version?: string; mode: Mode; demo: boolean; csrf_token?: string; teacher: Actor | null; user?: Actor; storage_path?: string; students?: Student[]; ai?: {server:boolean}; ollama: {available:boolean;models:{name:string;vision?:boolean}[];message?:string} }
export type Action = { id:string;text:string;due_date:string;status:'planned'|'in_progress'|'done'|'deferred' }
export type RecordSection = {id:string;category:string;label:string;school_stage:string;academic_year:number|null;grade:number|null;semester:number|null;pages:number[];text:string;status:'present'|'empty'|'not_applicable'|'uncertain'}
export type SchoolRecord = {id:string;filename:string;sha256:string;page_count:number;school_stage:string;sections:RecordSection[];warnings:string[];readable_pages:number[];unreadable_pages:number[]}
export type Finding = {text:string;evidence_ids:string[];guidance:string}
export type Analysis = {summary:string;strengths:Finding[];improvements:Finding[];questions:string[];actions:{text:string;reason:string;evidence_ids:string[]}[];limitations:string[];model:string;created_at:string}
export type Review = {state:'passed'|'needs_revision'|'pending';method:'manual'|'ollama';content_hash:string;notes:string[];created_at:string}
export type Strategy = {target_major:string;target_path:string;strengths:string;gaps:string;subject_plan:string;inquiry_plan:string;activity_plan:string;semester_plan:string;student_message:string}
export type Guidance = {published_at:string;published_by:string}
export type GradeRecord = {id:string;subject:string;academic_year:number;semester:1|2;grade_scale:'5'|'9'|'achievement'|'unknown';rank_grade:number|null;score:number|null;achievement:string}
export type StudentProfile = {target_major:string;interests:string;learning_concerns:string;study_habits:string;activities:string;reading:string;attendance_notes:string;teacher_observations:string;selected_subjects:string[];weekly_minutes:number|null;grades:GradeRecord[]}
export type Session = {id:string;date:string;topic:string;student_question:string;context:string;evidence_notes:string;teacher_opinion:string;profile?:StudentProfile;strategy?:Strategy;guidance?:Guidance|null;actions:Action[];next_date:string;record:SchoolRecord|null;analysis:Analysis|null;review:Review|null;confirmed:Record<string,unknown>|null}
export type CounselingCase = {schema_version:1;id:string;revision:number;privacy:'local_only'|'standard';created_at:string;updated_at:string;origin:string;student:Student;teacher:{display_name:string};current_session_id:string;sessions:Session[]}
export type Backup = {format:'daeryun-counseling';version:1;case:CounselingCase}
export type Job = {id:string;state:'queued'|'running'|'succeeded'|'needs_revision'|'failed'|'cancelled';stage?:string;message?:string;case_id?:string}
export type Fixture = {id:string;title:string;description:string}
export type AiSettings = {provider:'server'|'gemini'|'ollama';model:string;apiKey:string;ollamaUrl:string}
export interface Transport {
  admin?():Promise<AdminData>;administer?(input:AdminAction):Promise<{ok?:boolean;student_id?:string}>;
  mode:Mode;health(signal?:AbortSignal):Promise<Health>;authenticate(token:string):Promise<Health>
  list(signal?:AbortSignal):Promise<CounselingCase[]>;get(id:string):Promise<CounselingCase>
  create(student:Student,teacher:string):Promise<CounselingCase>;save(value:CounselingCase):Promise<CounselingCase>
  next(value:CounselingCase):Promise<CounselingCase>;importBackup(bundle:Backup):Promise<CounselingCase>
  exportBackup(id:string):Promise<Blob>;report(id:string,sessionId:string,audience?:'student'|'teacher'):Promise<Blob>
  upload(value:CounselingCase,sessionId:string,file:File,password:string,signal?:AbortSignal):Promise<CounselingCase>
  analyze(value:CounselingCase,sessionId:string,model:string,goal:string,budget:number):Promise<Job>
  review(value:CounselingCase,sessionId:string,model?:string):Promise<Job|CounselingCase>
  confirm(value:CounselingCase,sessionId:string):Promise<CounselingCase>
  publish?(value:CounselingCase,sessionId:string):Promise<CounselingCase>
  job(id:string,signal?:AbortSignal):Promise<Job>;cancel(id:string):Promise<Job>
  fixtures():Promise<Fixture[]>;fixture(id:string):Promise<Blob>
  generalAi?(value:CounselingCase,sessionId:string,settings:AiSettings,signal?:AbortSignal):Promise<string>
}
