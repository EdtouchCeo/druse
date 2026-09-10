import test from 'node:test'
import assert from 'node:assert/strict'
import {createProject,copy,reviewField,setField,setReviewChecked,validateProject} from '../src/lib/model'
import {readViewState,writeViewState} from '../src/lib/viewState'
import {importBackup} from '../src/lib/exportProject'

function memoryStorage(){const entries=new Map<string,string>();return {entries,getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value)}}}
test('cursor keeps project, tool and technique question positions separate',()=>{
 const storage=memoryStorage(),p=createProject('path'),other=createProject('path')
 writeViewState(p,'social',3,6,storage);writeViewState(p,'business',7,2,storage)
 assert.deepEqual(readViewState(p,'social',storage),{step:3,question:6});assert.deepEqual(readViewState(p,'business',storage),{step:7,question:2})
 assert.deepEqual(readViewState(other,'social',storage),{step:0,question:0})
 p.technique='expert';writeViewState(p,'social',3,9,storage);p.technique='path';assert.equal(readViewState(p,'social',storage).question,6)
 p.technique='expert';assert.equal(readViewState(p,'social',storage).question,9)
})
test('invalid persisted cursor shapes and indices recover to the first position',()=>{
 const p=createProject(),storage=memoryStorage();writeViewState(p,'social',3,6,storage);const key=[...storage.entries.keys()][0]!
 for(const text of ['{','null','[]','"wrong"','{"step":-1,"questions":{"path":-1}}','{"step":6,"questions":{"path":8}}','{"step":1.2,"questions":{"path":"6"}}','{"step":null,"questions":null}']){storage.setItem(key,text);assert.deepEqual(readViewState(p,'social',storage),{step:0,question:0},text)}
 writeViewState(p,'social',99,-1,storage);assert.deepEqual(readViewState(p,'social',storage),{step:0,question:0})
})
test('unavailable cursor storage never prevents draft use or mutates student data',()=>{
 const p=createProject(),before=copy(p),blocked={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')}}
 assert.doesNotThrow(()=>writeViewState(p,'social',3,6,blocked));assert.deepEqual(readViewState(p,'social',blocked),{step:0,question:0})
 assert.doesNotThrow(()=>writeViewState(p,'social',3,6,null));assert.deepEqual(readViewState(p,'social',null),{step:0,question:0});assert.deepEqual(p,before)
})
test('review check selections persist independently of edited prose and survive backup',()=>{
 const p=createProject();setField(p,'social:empathy','이동이 어려운 이용자의 요구');reviewField(p,'social:empathy',['대상을 확인했나요?','요구를 확인했나요?'])
 setReviewChecked(p,'social:empathy',2,true);setReviewChecked(p,'social:empathy',1,true);setReviewChecked(p,'social:empathy',1,true)
 assert.deepEqual(p.reviews['social:empathy']!.checked,[1,2]);setReviewChecked(p,'social:empathy',1,false);assert.deepEqual(p.reviews['social:empathy']!.checked,[2])
 setField(p,'social:empathy','수정한 학생 문장');const restored=importBackup(JSON.stringify({format:'daeryun-assessment',version:1,project:p}))
 assert.deepEqual(restored.reviews['social:empathy']!.checked,[2]);assert.equal(restored.reviews['social:empathy']!.original,'이동이 어려운 이용자의 요구');assert.equal(restored.social.empathy,'수정한 학생 문장')
})
test('legacy reviews gain empty check selections and malformed indices are rejected',()=>{
 const p=createProject();reviewField(p,'social:empathy',[]);delete p.reviews['social:empathy']!.checked
 assert.deepEqual(validateProject(p).reviews['social:empathy']!.checked,[])
 for(const invalid of [[-1],[1],[0.5],['0'],null]){const forged=copy(p) as any;forged.reviews['social:empathy'].checked=invalid;assert.throws(()=>validateProject(forged))}
 const before=copy(p);setReviewChecked(p,'social:empathy',99,true);setReviewChecked(p,'social:not-valid',0,true);assert.deepEqual(p,before)
})
