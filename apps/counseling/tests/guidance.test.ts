import test from 'node:test'
import assert from 'node:assert/strict'
import {guidanceIssues,finalizationIssues} from '../src/lib/workflow'
import {emptyStrategy} from '../src/lib/model'
import type {Session} from '../src/lib/types'

test('incomplete final drafts remain editable but cannot pass the guidance content gate',()=>{
 const session={topic:'합성 최종 전략',strategy:{...emptyStrategy(),subject_plan:'수업 자료를 비교한다.'},actions:[],teacher_opinion:'교사 검토 메모'} as unknown as Session
 assert.deepEqual(finalizationIssues(session),[])
 assert.deepEqual(guidanceIssues(session),['학생 안내 메시지를 입력해 주세요.'])
 session.strategy!.student_message='비교표와 근거 설명을 준비해 주세요.'
 assert.deepEqual(guidanceIssues(session),[])
 session.actions=[{id:'synthetic',text:'  ',due_date:'',status:'planned'}]
 assert.deepEqual(guidanceIssues(session),[])
 session.actions[0]!.text='비교표를 작성하고 선택한 근거를 교사와 점검한다.'
 assert.deepEqual(guidanceIssues(session),[])
})

test('legacy notes still use teacher opinion without requiring tracked actions',()=>{
 const session={topic:'합성 이전 기록',strategy:emptyStrategy(),teacher_opinion:'기존 방식의 교사 의견',actions:[{id:'synthetic',text:'확인할 자료를 가져오기',due_date:'',status:'planned'}]} as unknown as Session
 assert.deepEqual(guidanceIssues(session),[])
 session.teacher_opinion=' '
 assert.deepEqual(guidanceIssues(session),['교사의 의견을 입력해 주세요.'])
})

test('a student message alone does not replace a learning or inquiry strategy',()=>{
 const session={topic:'학습 전략',strategy:{...emptyStrategy(),student_message:'자료를 준비하세요.'},actions:[],teacher_opinion:''} as unknown as Session
 assert.deepEqual(guidanceIssues(session),['교과·탐구·활동·학년별 전략 중 하나 이상을 작성해 주세요.'])
})
