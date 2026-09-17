<script setup lang="ts">
import {computed} from 'vue'
import {reportBlocks,inlineParts} from '../lib/reportContent'
const props=withDefaults(defineProps<{text:string;headingLevel?:4|5}>(),{headingLevel:4})
const blocks=computed(()=>reportBlocks(props.text,{hideEvidence:true}))
</script>
<template>
 <div class="result-prose">
  <template v-for="(block,index) in blocks" :key="index">
   <component :is="'h'+headingLevel" v-if="block.kind==='heading'" class="result-subheading"><template v-for="(part,i) in inlineParts(block.text)" :key="i"><strong v-if="part.strong">{{part.text}}</strong><template v-else>{{part.text}}</template></template></component>
   <p v-else-if="block.kind==='detail'" class="result-detail"><strong class="result-detail-label">{{block.label}}:</strong> <template v-for="(part,i) in inlineParts(block.text)" :key="i"><strong v-if="part.strong">{{part.text}}</strong><template v-else>{{part.text}}</template></template></p>
   <ul v-else-if="block.kind==='list'" class="result-list"><li v-for="(line,i) in block.items" :key="i"><template v-for="(part,j) in inlineParts(line)" :key="j"><strong v-if="part.strong">{{part.text}}</strong><template v-else>{{part.text}}</template></template></li></ul>
   <div v-else-if="block.kind==='table'" class="result-table-scroll" tabindex="0" role="region" aria-label="전략 내용 표"><table><thead><tr><th v-for="(cell,i) in block.headers" :key="i" scope="col">{{cell}}</th></tr></thead><tbody><tr v-for="(row,i) in block.rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{cell}}</td></tr></tbody></table></div>
   <p v-else :class="{'result-source':block.source,'result-gap':!block.text.trim()}"><template v-for="(part,i) in inlineParts(block.text)" :key="i"><strong v-if="part.strong">{{part.text}}</strong><template v-else>{{part.text}}</template></template></p>
  </template>
 </div>
</template>
<style scoped>
.result-prose{min-width:0}.result-subheading{font-size:17px;line-height:1.7;color:#214574;margin:23px 0 10px}.result-subheading:first-child{margin-top:0}.result-list{padding-left:23px;margin:10px 0 18px}.result-list li{padding:5px 0;font-size:15px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.result-table-scroll{max-width:100%;overflow-x:auto;margin:14px 0 22px}.result-table-scroll table{width:100%;min-width:520px;border-collapse:collapse;font-size:14px;line-height:1.8}.result-table-scroll th,.result-table-scroll td{border:1px solid #dce4ed;padding:12px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.result-table-scroll th{background:#edf3fb;color:#214574;font-weight:600}
</style>
