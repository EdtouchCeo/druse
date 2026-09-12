<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {Plus,Trash2} from 'lucide-vue-next'
import {profileFields,profileIssues,newGrade} from '../lib/profile'
import type {StudentProfile,GradeRecord} from '../lib/types'
const props=defineProps<{profile:StudentProfile;academicYear:number;locked:boolean}>()
const issues=computed(()=>profileIssues(props.profile))
const subjectText=ref(props.profile.selected_subjects.join(', '))
watch(()=>props.profile,()=>{subjectText.value=props.profile.selected_subjects.join(', ')})
function subjects(event:Event){props.profile.selected_subjects=(event.target as HTMLTextAreaElement).value.split(/[,\n]/).map(v=>v.trim()).filter(Boolean)}
function numeric(event:Event){const value=(event.target as HTMLInputElement).value;return value===''?null:Number(value)}
function addGrade(){if(!props.locked&&props.profile.grades.length<60)props.profile.grades.push(newGrade(props.academicYear))}
function removeGrade(id:string){if(!props.locked)props.profile.grades=props.profile.grades.filter(g=>g.id!==id)}
function scaleChanged(row:GradeRecord){row.rank_grade=null}
</script>
<template>
 <div class="profile-form">
  <div v-if="issues.length" class="inline-note warning" role="alert"><ul><li v-for="issue in issues" :key="issue">{{issue}}</li></ul></div>
  <fieldset :disabled="locked">
   <div class="profile-input-grid"><label v-for="field in profileFields" :key="field.key">{{field.label}}<textarea v-model="profile[field.key]" :aria-label="field.label" :rows="2" maxlength="6000" :placeholder="field.hint"></textarea></label></div>
   <div class="profile-input-grid"><label>실제 이수 과목<textarea v-model="subjectText" aria-label="실제 이수 과목" rows="2" placeholder="실제로 듣는 과목을 쉼표나 줄바꿈으로 구분합니다." @input="subjects"></textarea><small>과목당 100자, 최대 20개. 관심만 있는 과목과 구분하세요.</small></label><label>주간 가용 시간<input :value="profile.weekly_minutes" aria-label="주간 가용 시간" type="number" min="0" max="2400" step="1" placeholder="미확인" @input="profile.weekly_minutes=numeric($event)"><small>분 단위. 빈칸은 미확인, 0은 추가 가용 시간 없음입니다.</small></label></div>
   <section class="grade-input-section"><div class="profile-section-title"><div><h3>과목별 성적 입력</h3><p>원자료의 등급 체계를 선택합니다. 5등급제와 9등급제를 환산하거나 섞지 않습니다.</p></div><button class="secondary compact" :disabled="profile.grades.length>=60" @click="addGrade"><Plus :size="16"/>성적 추가</button></div>
    <p v-if="!profile.grades.length" class="help">확인한 성적이 있을 때 추가합니다. 입력하지 않아도 학생 이해와 전략 작성을 이어갈 수 있습니다.</p>
    <div v-for="(row,index) in profile.grades" :key="row.id" class="grade-entry"><div class="action-heading"><strong>성적 {{index+1}}</strong><button class="icon-button" :aria-label="'성적 '+(index+1)+' 삭제'" @click="removeGrade(row.id)"><Trash2 :size="16"/></button></div><div class="grade-fields">
     <label>과목<input v-model="row.subject" :aria-label="'성적 '+(index+1)+' 과목'" maxlength="100" placeholder="원자료의 과목명"></label><label>학년도<input v-model.number="row.academic_year" :aria-label="'성적 '+(index+1)+' 학년도'" type="number" min="1990" max="2100"></label><label>학기<select v-model.number="row.semester" :aria-label="'성적 '+(index+1)+' 학기'"><option :value="1">1학기</option><option :value="2">2학기</option></select></label>
     <label>등급 체계<select v-model="row.grade_scale" :aria-label="'성적 '+(index+1)+' 등급 체계'" @change="scaleChanged(row)"><option value="unknown">미확인</option><option value="5">5등급제</option><option value="9">9등급제</option><option value="achievement">성취도</option></select></label><label>석차등급<input :value="row.rank_grade" :aria-label="'성적 '+(index+1)+' 석차등급'" type="number" min="1" :max="row.grade_scale==='5'?5:9" step="1" :disabled="!['5','9'].includes(row.grade_scale)" placeholder="미확인" @input="row.rank_grade=numeric($event)"></label><label>원점수<input :value="row.score" :aria-label="'성적 '+(index+1)+' 원점수'" type="number" min="0" max="100" step="any" placeholder="미확인" @input="row.score=numeric($event)"></label><label>성취도<input v-model="row.achievement" :aria-label="'성적 '+(index+1)+' 성취도'" maxlength="20" placeholder="예: A / 원문 표기"></label>
    </div></div>
   </section>
  </fieldset>
 </div>
</template>
