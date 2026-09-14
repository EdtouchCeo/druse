<script setup lang="ts">
import {computed} from 'vue'
const props=defineProps<{text:string}>()
// Present every stored line as text. Source coordinates remain available without
// competing with the student's actions. No HTML, inferred links or rewriting.
const lines=computed(()=>props.text.split('\n').map(text=>({text,source:/^\s*(출처:|자료 ID:|원문 위치:)/.test(text)})))
</script>
<template>
 <div class="result-prose"><p v-for="(line,index) in lines" :key="index" :class="{'result-source':line.source,'result-gap':!line.text.trim()}">{{line.text}}</p></div>
</template>
