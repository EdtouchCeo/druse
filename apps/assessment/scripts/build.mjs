import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target=path.resolve(root, '../../output/web/assessment')
await mkdir(target,{recursive:true})
const html=await readFile(path.join(root,'dist/index.html'),'utf8')
// Copy only this entry's assets. The app uses a single bundled entry, with no
// dynamic chunks. Old build attempts in dist must not be published by accident.
await mkdir(path.join(target,'assets'),{recursive:true})
const assets=[...html.matchAll(/(?:src|href)="\/assessment\/(assets\/[^"/]+)"/g)].map(m=>m[1])
if(assets.length<2) throw new Error('Expected the current JS and CSS entries')
for(const asset of assets) await writeFile(path.join(target,asset),await readFile(path.join(root,'dist',asset)))
await writeFile(path.join(target,'index.html'),html)
for(const [slug,title,desc] of [
 ['social-plan','사회 문제 해결 계획서','문제 상황부터 평가 방법까지, 네 가지 AI 기법의 질문과 예시로 나의 해결 계획을 작성하세요.'],
 ['business-model','비즈니스 모델 수립하기','사회 문제 해결 계획을 이어받아 린 캔버스 9항목을 작성하고 내 글을 점검하세요.'],
 ['implementation-prompt','구현 프롬프트 연습','설계안의 기능을 [입력] → [처리] → [결과]로 옮겨 구현 프롬프트를 완성합니다. 용어 조건과 예외 상황을 점검하며 연습합니다.'],
 ['terms','앱 서비스 개발 용어','구현 프롬프트에 쓰는 개발 용어 16개를 세 범주로 나누어 뜻, 화면 예시, 프롬프트 문장, 결과 확인 방법으로 보여 줍니다.']
]) {
 const url=`https://daeryun.life/assessment/${slug}/`
 const page=html.replaceAll('수행평가 준비 | 대륜고',`${title} | 대륜고`)
   .replace(/(<meta name="description" content=")[^"]+/,`$1${desc}`)
   .replace(/(<meta property="og:description" content=")[^"]+/,`$1${desc}`)
   .replaceAll('https://daeryun.life/assessment/',url)
 await mkdir(path.join(target,slug),{recursive:true})
 await writeFile(path.join(target,slug,'index.html'),page)
}
console.log('Built /assessment/ with four direct entry pages.')
