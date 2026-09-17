<script setup lang="ts">
import {computed,useId} from 'vue'
import {activityStrategySections} from '../lib/activityStrategy'
import ResultText from './ResultText.vue'
const props=defineProps<{text:string}>()
const id=useId(),content=computed(()=>activityStrategySections(props.text))
</script>
<template>
 <div class="activity-strategy">
  <nav v-if="content.sections.length" class="activity-contents" aria-label="창체·봉사·독서·행동특성 전략 목차"><a v-for="(section,index) in content.sections" :key="index" :href="'#'+id+'-area-'+index">{{section.title}}</a></nav>
  <ResultText v-if="content.introduction.trim()" :text="content.introduction"/>
  <section v-for="(section,index) in content.sections" :id="id+'-area-'+index" :key="index" class="activity-area" :data-strategy-area="section.title" :aria-labelledby="id+'-area-title-'+index">
   <h4 :id="id+'-area-title-'+index">{{section.title}}</h4>
   <ResultText v-if="section.text.trim()" :text="section.text" :heading-level="5"/>
  </section>
 </div>
</template>
<style scoped>
.activity-strategy{min-width:0}.activity-contents{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 24px}.activity-contents a{font-size:14px;text-decoration:none;color:#214574;padding:8px 12px;background:#edf3fb;border:1px solid #dce5f1;border-radius:6px;line-height:1.6;overflow-wrap:anywhere}.activity-area{padding:24px 0;margin:0;scroll-margin-top:30px;background:transparent;border:0;border-top:1px solid #d8e1ee;border-radius:0;box-shadow:none}.activity-area h4{font-size:19px;line-height:1.6;color:#173d68;margin:0 0 16px}.activity-area :deep(.result-detail){margin-bottom:16px}.activity-area :deep(.result-detail-label){display:block;margin-bottom:4px;font-size:14px;color:#36577e;font-weight:700}
</style>
