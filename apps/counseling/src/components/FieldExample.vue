<script setup lang="ts">
defineProps<{text:string}>()
</script>
<template>
 <details class="field-example"><summary>입력 예시</summary><p>{{text}}</p></details>
</template>
