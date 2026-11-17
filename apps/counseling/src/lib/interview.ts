import {checked} from './transport'

export interface EvidenceRef {id:string;quote:string}
export interface InterviewQuestion {id:string;question:string;purpose:string;refs:EvidenceRef[];status:'proposed'|'accepted'|'excluded'}
export interface Utterance {id:string;original_text:string;text:string;speaker:'unknown'|'student'|'interviewer'|'other';timecode:string;line:number;status:'pending'|'confirmed'|'excluded';reason:string}
export interface InterviewReport {id:string;created_at:string;model:string;current:boolean;draft_sections:Record<string,string>;edited_sections:Record<string,string>;teacher_opinion:string;statements:{section:string;text:string;refs:EvidenceRef[]}[];confirmed:null|{by:string;at:string};source_snapshot:{utterances:Utterance[];transcript_filename:string}}
export interface InterviewWorkspace {revision:number;notes:string;selected_records:string[];record_current:boolean;questions_current:boolean;precheck_current:boolean;questions:InterviewQuestion[];findings:{text:string;refs:EvidenceRef[]}[];transcript:null|{id:string;filename:string;original_text:string;utterances:Utterance[]};precheck:null|{issues:{kind:string;message:string;refs:EvidenceRef[]}[]};reports:InterviewReport[]}
export const interviewTopics:Record<string,string>={summary:'종합 의견',strengths:'확인된 강점',improvements:'우선 보완점',career:'진로·학업 계획',reflection:'성찰과 변화',guidance:'후속 질문·지도 계획'}
export async function interviewRequest<T>(path:string,token:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw new Error('면접 분석은 교사 PC의 로컬 앱에서 사용합니다.')
 const response=await checked(await fetch('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(body===undefined?{}:{'X-Counseling-Token':token})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal}))
 return response.json() as Promise<T>
}
export async function interviewDownload(path:string){return (await checked(await fetch('/api'+path,{credentials:'same-origin',cache:'no-store'}))).blob()}
export async function transcriptBase64(file:File){
 if(file.size>2*1024*1024||!file.size)throw new Error('전사본은 비어 있지 않은 2MB 이하 파일이어야 합니다.')
 if(!/\.(txt|docx|srt|vtt)$/i.test(file.name))throw new Error('TXT·DOCX·SRT·VTT 전사본을 선택해 주세요.')
 const bytes=new Uint8Array(await file.arrayBuffer());let binary=''
 for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
 return btoa(binary)
}
