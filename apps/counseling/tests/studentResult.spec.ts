import {test,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {intuitiveApi,onlineOrigin} from './fixtures/intuitive'
import {finalCase} from './fixtures/studentResult'


async function shot(page:any,name:string){const dir=path.resolve('../../_workspace/student-result-20260914/screenshots');await mkdir(dir,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(dir,name+'.png'),fullPage:true});await page.screenshot({path:path.join(dir,name+'-viewport.png')})}

test('teacher preview uses the current post-consultation result without changing or publishing it',async({page})=>{
 const value=finalCase(true),api=await intuitiveApi(page,{value}),before=JSON.stringify(api.value)
 await page.goto('/counseling/')
 await page.getByRole('button',{name:'최종 결과물',exact:true}).click()
 await expect(page.getByLabel('다음 점검일',{exact:true})).toBeVisible()
 await expect(page.locator('.teacher-notes').getByLabel('다음 점검일',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'학생 결과물 미리보기',exact:true}).focus()
 await page.keyboard.press('Enter')
 const result=page.getByRole('article',{name:'학생 최종 결과물'})
 await expect(result).toBeFocused()
 const modify=page.getByRole('button',{name:'내용 수정',exact:true})
 await expect(modify).toBeInViewport({ratio:1})
 const captureDir=path.resolve('../../_workspace/student-result-20260914/screenshots');await mkdir(captureDir,{recursive:true})
 // Capture the actual keyboard activation position before shot() scrolls to the page top.
 await page.screenshot({path:path.join(captureDir,'teacher-final-preview-activated-viewport.png')})
 await expect(result).toContainText('현재 수업에서 허용한 자료')
 await expect(result).toContainText('AI 활용 금지')
 await expect(result).toContainText('성장 활동 일지')
 await expect(result).not.toContainText('비공개표식')
 await expect(result.locator('textarea,input,button')).toHaveCount(0)
 const order=await result.locator('[data-result-section]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-result-section')))
 expect(order.slice(0,3)).toEqual(['message','actions','direction'])
 expect(order.indexOf('actions')).toBeLessThan(order.indexOf('subject_plan'))
 await expect(result.locator('.result-next-date')).toHaveText('다음 점검일: 2026-09-28')
 await expect(result.locator('.result-actions li').nth(1)).toContainText('점검일: 미정')
 await shot(page,'teacher-final-preview-desktop')
 await modify.focus();await expect(modify).toBeFocused();await page.keyboard.press('Enter')
 await expect(page.getByRole('button',{name:'학생 결과물 미리보기',exact:true})).toBeFocused()
 await expect(page.getByLabel('교과 계획',{exact:true})).toHaveValue(value.sessions[0]!.strategy!.subject_plan)
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('published student result preserves school conditions, reads in action order and fits 320px',async({page})=>{
 const value=finalCase(true),s=value.sessions[0]!
 value.privacy='standard';s.guidance={published_at:'2026-09-14T00:00:00Z',published_by:'synthetic'}
 const api=await intuitiveApi(page,{mode:'online',role:'student',value})
 await page.setViewportSize({width:1280,height:900});await page.goto(onlineOrigin+'/counseling/')
 const result=page.getByRole('article',{name:'학생 최종 결과물'})
 await expect(result.getByRole('heading',{name:'나의 학종 전략',exact:true})).toBeVisible()
 const actions=await result.locator('[data-result-section=actions]').boundingBox(),plan=await result.locator('[data-result-section=subject_plan]').boundingBox()
 expect(actions!.y).toBeLessThan(plan!.y)
 await expect(result).toContainText('AI 활용 금지');await expect(result).toContainText('성장 활동 일지')
 await expect(result).not.toContainText('비공개표식');await expect(page.locator('textarea,input[type=file],.teacher-notes')).toHaveCount(0)
 await shot(page,'student-final-desktop')
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>document.fonts.ready)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await shot(page,'student-final-'+width)
  const firstAction=await result.locator('.result-actions li .result-prose p').first().evaluate(element=>{const box=element.getBoundingClientRect();return {top:box.top,bottom:box.bottom,lineHeight:Number.parseFloat(getComputedStyle(element).lineHeight),viewport:innerHeight}})
  await writeFile(path.resolve('../../_workspace/student-result-20260914/screenshots/student-first-action-'+width+'.json'),JSON.stringify(firstAction,null,2)+'\n')
  await expect(result.getByRole('heading',{name:'이번 실행과제',exact:true})).toBeInViewport({ratio:1})
  // A long action may continue below; its first full text line must already be readable.
  expect(firstAction.top).toBeGreaterThanOrEqual(0)
  expect(firstAction.top+firstAction.lineHeight).toBeLessThanOrEqual(firstAction.viewport)
 }
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})
