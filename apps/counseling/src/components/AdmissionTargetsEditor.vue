<script setup lang="ts">
import {Plus,Trash2} from 'lucide-vue-next'
import {nextTick,useId} from 'vue'
import {newAdmissionTarget} from '../lib/profile'
import {getAdmissionContext,universityNames} from '../lib/admissions'
import type {AdmissionTarget,StudentProfile} from '../lib/types'
import AdmissionTargetInfo from './AdmissionTargetInfo.vue'
import strategyTaxonomy from '../data/private-strategy-taxonomy.json'
const departments=Object.values(strategyTaxonomy.departments)
const props=defineProps<{profile:StudentProfile;locked:boolean}>()
const id=useId()
function routeNames(row:AdmissionTarget){return [...new Set(getAdmissionContext({admission_targets:[{...row,admission_name:''}]}).targets.flatMap(target=>target.elements.map(route=>route.name)))]}
async function add(){if(props.locked||props.profile.admission_targets.length>=12)return;const row=newAdmissionTarget();props.profile.admission_targets.push(row);await nextTick();document.getElementById(id+'-target-'+row.id)?.focus()}
async function remove(rowId:string){if(props.locked)return;const index=props.profile.admission_targets.findIndex(row=>row.id===rowId);props.profile.admission_targets=props.profile.admission_targets.filter(row=>row.id!==rowId);await nextTick();const next=props.profile.admission_targets[Math.min(index,props.profile.admission_targets.length-1)];document.getElementById(next?id+'-target-'+next.id:id+'-add')?.focus()}
function year(event:Event){const value=(event.target as HTMLInputElement).value;return value===''?null:Number(value)}
</script>
<template>
 <section class="admission-targets" aria-label="희망 대학·학과 입력">
  <div class="profile-section-title"><h3>희망 대학·학과 <small>학종 준비</small></h3><button :id="id+'-add'" class="secondary compact" :disabled="locked||profile.admission_targets.length>=12" @click="add"><Plus :size="16"/>희망 대학·전공 추가</button></div>
  <p class="help">학종 준비를 위한 대학·학과와 대입 학년도를 입력하세요. 여러 대학의 공통 준비와 대학별 차이를 비교합니다.</p>
  <datalist :id="id+'-universities'"><option v-for="name in universityNames" :key="name" :value="name"/></datalist>
  <datalist :id="id+'-departments'"><option v-for="department in departments" :key="department.label" :value="department.label"/></datalist>
  <section v-for="(row,index) in profile.admission_targets" :key="row.id" class="admission-entry" :aria-label="'희망 '+(index+1)+' 입력'">
   <div class="action-heading"><h4>희망 {{index+1}}</h4><button class="icon-button" :disabled="locked" :aria-label="'희망 '+(index+1)+' 삭제'" @click="remove(row.id)"><Trash2 :size="16"/></button></div>
   <div class="admission-fields">
    <label>대학<input :id="id+'-target-'+row.id" v-model="row.university" :list="id+'-universities'" :aria-label="'희망 '+(index+1)+' 대학'" maxlength="200" placeholder="희망 대학 이름" :disabled="locked"></label>
    <label>모집단위·전공<input v-model="row.major" :list="id+'-departments'" :aria-label="'희망 '+(index+1)+' 모집단위·전공'" maxlength="200" placeholder="예: 생명과학과 / 아직 탐색 중" :disabled="locked"></label>
    <label>대입 학년도<input :value="row.admission_year" :aria-label="'희망 '+(index+1)+' 대입 학년도'" type="number" min="1990" max="2100" step="1" placeholder="미정" :disabled="locked" @input="row.admission_year=year($event)"></label>
   </div>
  </section>
  <details class="help"><summary>전략 생성에 연결할 수 있는 학과 분류</summary><p>{{departments.map(item=>item.label).join(' · ')}}</p><p>학과 분류와 실제 대학의 모집단위 개설 여부는 구분하여 확인합니다.</p></details>
  <AdmissionTargetInfo :profile="profile"/>
 </section>
</template>
<style scoped>
.admission-targets{margin:12px 0 24px;padding:20px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);min-width:0}.admission-targets .help{margin:0 0 16px}.admission-targets h3{line-height:1.6}.admission-targets h3 small{font-weight:400;margin-left:4px}.admission-entry{min-width:0;margin-top:16px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--subtle)}.admission-entry h4{font-size:14px;margin:0}.admission-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px;margin-top:12px}.admission-fields label{min-width:0;margin:0;font-size:13px}.admission-fields input{min-width:0;width:100%;font-size:14px}.profile-section-title{flex-wrap:wrap}.profile-section-title button{max-width:100%;white-space:normal}@media(max-width:760px){.admission-entry{padding:14px}.admission-fields{grid-template-columns:minmax(0,1fr)}.admission-fields input{font-size:16px}}
</style>
