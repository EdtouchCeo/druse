<script setup lang="ts">
import {computed} from 'vue'
import {LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-vue-next'
const props=defineProps<{checking:boolean;issue:{status:number;code:string}|null}>()
defineEmits<{retry:[]}>()
const explanation=computed(()=>{
 if(props.issue?.status===403){
  if(props.issue.code==='COUNSELING_NOT_APPROVED')return {title:'학종 전략실 참여 확인이 필요합니다',message:'학교 로그인은 확인되었습니다. 현재 계정에 학종 전략실 참여 권한이 아직 없습니다.',help:'담당 선생님에게 학생 참여 승인 여부를 확인해 달라고 요청해 주세요. 승인 후 아래 버튼으로 다시 확인할 수 있습니다.'}
  if(props.issue.code==='NOT_APPROVED')return {title:'학교 회원 승인 대기',message:'로그인은 되어 있지만 학교 회원 승인이 아직 완료되지 않았습니다.',help:'담당 선생님에게 학교 회원 승인 상태를 확인해 달라고 요청해 주세요.'}
  if(props.issue.code==='PROFILE_REQUIRED')return {title:'학교 회원 등록 확인이 필요합니다',message:'로그인은 확인되었지만 연결된 학교 회원 정보를 찾지 못했습니다.',help:'사용 설명서에서 회원 등록 상태를 확인하고, 필요한 경우 담당 선생님에게 문의해 주세요.'}
  return {title:'전략실 이용 권한 확인이 필요합니다',message:'현재 계정으로 학종 전략실을 이용할 수 있는지 확인이 필요합니다.',help:'담당 선생님에게 전략실 이용 권한과 학생 계정 연결 상태를 확인해 달라고 요청해 주세요.'}
 }
 if(props.issue?.code==='SESSION_CHANGED')return {title:'로그인 계정이 변경되었습니다',message:'현재 학교 계정으로 전략실 연결을 다시 확인해 주세요.',help:'아래 버튼을 누르면 현재 계정의 이용 상태를 확인합니다.'}
 return {title:'전략실에 연결하지 못했습니다',message:'일시적인 연결 문제로 이용 상태를 확인하지 못했습니다.',help:'잠시 후 아래 버튼으로 다시 시도해 주세요.'}
})
</script>

<template>
<section class="card auth-card access-status" aria-live="polite" :aria-busy="checking">
 <template v-if="checking"><LoaderCircle class="spin" :size="30" aria-hidden="true"/><h2>전략실 연결 확인 중</h2><p>학교 로그인과 전략실 이용 상태를 확인하고 있습니다.</p></template>
 <template v-else><ShieldCheck v-if="issue?.status===403" :size="30" aria-hidden="true"/><h2>{{explanation.title}}</h2><p>{{explanation.message}}</p><p class="help">{{explanation.help}}</p><button class="primary wide" @click="$emit('retry')"><RefreshCw :size="17"/>이용 상태 다시 확인</button><a href="/" class="secondary wide">사용 설명서로 돌아가기</a></template>
</section>
</template>

<style scoped>
.access-status>svg{color:var(--brand);margin-bottom:16px}.access-status>h2{margin-bottom:16px}.access-status .help{margin:12px 0 24px}.access-status>a{margin-top:10px}.access-status>p{line-height:1.85}
</style>
