<script setup lang="ts">
import {computed,ref} from 'vue'
import {BookOpen,ArrowRight} from 'lucide-vue-next'
import {schoolMatches,activityApplicability,schoolAiLabel,type SchoolContext,type SchoolAssessment,type SchoolActivity} from '../lib/schoolContext'
import type {Student} from '../lib/types'
const props=defineProps<{data:SchoolContext;student:Student;subjects:string[];locked:boolean}>()
const emit=defineEmits<{adopt:[task:SchoolAssessment];adoptActivity:[activity:SchoolActivity,semester:number|null]}>()
const query=ref(''),semester=ref<number|null>(null),limit=ref(3)
const matches=computed(()=>schoolMatches(props.data,props.student,props.subjects,query.value,semester.value))
const taskGroups=computed(()=>[{label:'이수 과목과 맞는 계획',items:matches.value.selected,reference:false},{label:'다른 조건의 탐색 자료',items:matches.value.reference,reference:true}])
const activityGroups=computed(()=>[{label:'대상 조건 일치 · 운영 확인',items:matches.value.activityGroups.matched},{label:'적용 범위 확인 필요',items:matches.value.activityGroups.unverified},{label:'다른 대상 · 탐색 참고',items:matches.value.activityGroups.reference}])
function showAll(){limit.value=Math.max(props.data.assessments.length,props.data.clubs.length+props.data.activities.length)}
</script>
<template>
 <section class="card school-context">
  <div class="profile-section-title"><h2>학교 과제·활동</h2></div>
  <div class="school-filters"><label>자료 학기<select v-model="semester"><option :value="null">전체 학기</option><option :value="1">1학기</option><option :value="2">2학기</option></select></label><label>자료 검색<input v-model="query" maxlength="100" placeholder="과목·관심 키워드"></label></div>
  <p v-if="!subjects.length" class="profile-empty">이수 과목을 입력하면 맞는 교과 계획을 찾습니다.</p>
  <p v-if="student.school_stage==='middle'" class="inline-note">고등학교 자료는 진학 후 탐색용입니다. 현재 중학교 과제로 적용하지 않습니다.</p>
  <template v-for="group in taskGroups" :key="group.label">
   <div v-if="group.items.length" class="school-task-group">
    <h3>{{group.label}} <span class="badge">{{group.items.length}}개</span></h3>
    <article v-for="task in group.items.slice(0,limit)" :key="task.id" class="school-task">
     <div class="school-task-meta"><span>{{task.academic_year}}학년도 · {{task.grade}}학년 · {{task.semester}}학기 · {{task.subject}}</span><span class="badge">{{group.reference?'탐색 참고':'현행 여부 확인'}}</span></div>
     <h4>{{task.title}}</h4><p>원문 시기: {{task.timing||'확인 필요'}}</p><p v-if="task.ai_status" class="help">AI 조건: {{schoolAiLabel(task.ai_status)}}</p>
     <details><summary>절차·조건·출처</summary><div>
      <p v-if="task.learning_topics.length">주제: {{task.learning_topics.join(' · ')}}</p>
      <h5>절차</h5><ol v-if="task.steps.length"><li v-for="(step,i) in task.steps" :key="i">{{step}}</li></ol><p v-else>원문 확인 필요</p>
      <h5>산출물</h5><ul v-if="task.outputs.length"><li v-for="(output,i) in task.outputs" :key="i">{{output}}</li></ul><p v-else>별도 정리 없음 · 절차·과제명 확인</p>
      <h5>원문 조건</h5><ul v-if="task.conditions.length"><li v-for="(condition,i) in task.conditions" :key="i">{{condition}}</li></ul><p v-else>원문 확인 필요</p><p v-if="!task.ai_status">AI 허용 여부 확인 필요</p>
      <template v-if="task.rubric_excerpts?.length"><h5>채점표 발췌 · 필수 조건과 구분</h5><ul><li v-for="(excerpt,i) in task.rubric_excerpts" :key="i">{{excerpt}}</li></ul></template>
      <template v-if="task.issues?.length"><h5>추가 확인</h5><ul><li v-for="(issue,i) in task.issues" :key="i">{{issue}}</li></ul></template><p v-if="task.summary_note">{{task.summary_note}}</p>
      <small>출처: {{task.source_label}} · 개정 {{task.revision}}<br>자료 {{task.source_ref.source_id}} · <code>{{task.source_ref.json_pointer}}</code></small>
     </div></details>
     <button class="text-button" :disabled="locked" @click="emit('adopt',task)">계획에 담기 <ArrowRight :size="15"/></button>
    </article><button v-if="group.items.length>limit" class="text-button" @click="showAll">과제 더 보기</button>
   </div>
  </template>
  <p v-if="subjects.length&&!matches.selected.length" class="help">일치하는 계획이 없습니다. 과목명·자료 학기를 확인하세요.</p>
  <details class="school-activities"><summary>동아리·특색활동 · {{matches.activities.length}}개</summary>
   <template v-for="group in activityGroups" :key="group.label"><section v-if="group.items.length" class="school-task-group">
    <h3>{{group.label}} <span class="badge">{{group.items.length}}개</span></h3>
    <article v-for="item in group.items.slice(0,limit)" :key="item.id">
     <h4>{{item.name||item.title}}</h4><p>{{item.description}}</p><p class="activity-grade">{{activityApplicability(item,student,semester).reasons.join(' · ')}}</p>
     <details><summary>절차·산출물·출처</summary>
      <p>{{item.school_stage==='high'?'고등학교':item.school_stage==='middle'?'중학교':'학교급 확인 필요'}} · {{item.grade_range?.length?item.grade_range.join('·')+'학년':'대상 학년 확인 필요'}} · {{item.school_year?item.school_year+'학년도':'학년도 확인 필요'}} · {{item.semester?item.semester+'학기':'학기 확인 필요'}}</p>
      <h5>절차</h5><ol v-if="item.steps?.length"><li v-for="(step,i) in item.steps" :key="i">{{step}}</li></ol><p v-else>원문 확인 필요</p><h5>산출물</h5><ul v-if="item.outputs?.length"><li v-for="(output,i) in item.outputs" :key="i">{{output}}</li></ul><p v-else>원문 확인 필요</p>
      <p>{{item.summary_note||'현재 운영·참여 가능 여부와 일정 확인 필요'}}</p><small>출처: {{item.source_label}} · 개정 {{item.revision}}<br>자료 {{item.source_ref.source_id}} · <code>{{item.source_ref.json_pointer}}</code></small>
     </details><button class="text-button" :disabled="locked" @click="emit('adoptActivity',item,semester)">활동 초안에 담기 <ArrowRight :size="15"/></button>
    </article><button v-if="group.items.length>limit" class="text-button" @click="showAll">활동 더 보기</button>
   </section></template>
  </details>
  <small class="school-review-date">{{data.reviewed_on}} 검토 자료 · 선택 후 저장 필요 · 실제 배정·참여는 확인 필요</small>
 </section>
</template>
