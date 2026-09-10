import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve('../../../../_workspace/student-assessment-build-plan-20260910/verification-readability')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage(),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
try{
  for(const [name,url,selectors] of [['landing','/assessment/',['.landing-intro>p','.landing-card p']],['business','/assessment/business-model/',['#draft-text','.help-question']]]){
    await page.goto((process.env.QA_BASE||'http://127.0.0.1:5188')+url);await page.locator(selectors[0]).first().waitFor()
    for(const width of [1440,375,360]){
      await page.setViewportSize({width,height:1000})
      const measurements=await page.evaluate(sels=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:sels.map(selector=>{const el=document.querySelector(selector),style=getComputedStyle(el);return {selector,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight)}})}),selectors)
      const result=measurements.scrollWidth<=width&&measurements.text.every(text=>text.fontSize>=16)?'PASS':'FAIL'
      await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true});results.push({name,width,result,...measurements});console.log(`${result} ${name} ${width}px ${JSON.stringify(measurements.text)}`)
    }
  }
  assert.deepEqual(errors,[])
  assert.ok(results.every(r=>r.result==='PASS'),'Some page readability checks failed; see additional-pages.json')
}finally{await writeFile(path.join(out,'additional-pages.json'),JSON.stringify({results,errors},null,2));await browser.close()}
