import type { Project, SaveResult } from './types'
import { cloneProject, copy } from './model'
import { implementationFromStorage } from './promptState'
// 구현 프롬프트 항목이 생기기 전에 저장한 원고도 그대로 열리게 빈 상태를 채운다.
// 한도를 넘은 칸은 잘라 살리고, 잘린 원고 id를 남겨 화면이 알리게 한다.
const trimmedOnLoad=new Map<string,number>()
export function takeTrimNotice(id:string):number {const n=trimmedOnLoad.get(id)??0;trimmedOnLoad.delete(id);return n}
export const withDefaults=(p:Project):Project=>{const report={trimmed:0};const implementation=implementationFromStorage((p as Partial<Project>).implementation,report);if(report.trimmed)trimmedOnLoad.set(p.id,report.trimmed);return {...p,implementation}}
const DB_NAME='daeryun-assessment:v1'
function openDb():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined') {reject(new Error('이 브라우저에서는 기기에 저장할 수 없습니다. 백업 파일을 내려받아 보관해 주세요.'));return}
    const request=indexedDB.open(DB_NAME,1)
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('projects'))request.result.createObjectStore('projects',{keyPath:'id'})}
    request.onerror=()=>reject(new Error('기기 저장소를 열지 못했습니다. 작성한 내용을 백업 파일로 내려받아 주세요.'))
    request.onblocked=()=>reject(new Error('다른 창의 저장소 연결을 닫고 다시 시도해 주세요.'))
    request.onsuccess=()=>resolve(request.result)
  })
}
export async function listProjects():Promise<Project[]> {
  const db=await openDb()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readonly'),r=tx.objectStore('projects').getAll()
    tx.oncomplete=()=>{db.close();resolve((r.result as Project[]).map(withDefaults).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))}
    tx.onerror=()=>{db.close();reject(new Error('저장한 계획을 읽지 못했습니다.'))}
  })
}
export async function loadProject(id:string):Promise<Project|null> {
  const db=await openDb()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readonly'),r=tx.objectStore('projects').get(id)
    tx.oncomplete=()=>{db.close();resolve(r.result?withDefaults(r.result as Project):null)}
    tx.onerror=()=>{db.close();reject(new Error('계획을 열지 못했습니다.'))}
  })
}
export async function saveProject(input:Project):Promise<SaveResult> {
  const snapshot=copy(input),db=await openDb()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects'),read=store.get(snapshot.id)
    let result:SaveResult
    read.onsuccess=()=>{
      const current=read.result as Project|undefined
      const conflict=!!current&&current.revision!==snapshot.revision
      const project=conflict?cloneProject(snapshot,`${snapshot.title} — 다른 창의 수정 보관`):snapshot
      // A conflict copy preserves both the user's source linkage and revision history.
      if(conflict) {project.linkedPlan=snapshot.linkedPlan;project.reviews=snapshot.reviews}
      project.revision=(conflict?0:snapshot.revision)+1;project.updatedAt=new Date().toISOString()
      result={project,conflict};store.put(project)
    }
    tx.oncomplete=()=>{db.close();resolve(result)}
    tx.onabort=tx.onerror=()=>{db.close();reject(new Error('저장하지 못했습니다. 저장 공간이나 브라우저 설정을 확인하고 백업 파일을 내려받아 주세요.'))}
  })
}
export async function deleteProject(id:string):Promise<void> {
  const db=await openDb()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(id)
    tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(new Error('계획을 삭제하지 못했습니다.'))}
  })
}
