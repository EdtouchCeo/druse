import {test,expect} from '@playwright/test'

test.afterAll(async({request})=>{await request.post('/__synthetic_shutdown')})
test('invalid final candidate selections preserve verified findings and disclose the merged result',async({page,request},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const health=await(await request.get('/api/health')).json()
 const target=(await(await request.get('/api/cases')).json()).cases[0]
 const started=await request.post('/api/cases/'+target.id+'/analyze',{headers:{'X-Counseling-Token':health.csrf_token},data:{revision:target.revision,session_id:target.current_session_id,model:'synthetic-local',goal:''}})
 expect(started.status()).toBe(202)
 const job=(await started.json()).job
 await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).job.state,{timeout:30000}).toBe('succeeded')
 const stored=(await(await request.get('/api/cases/'+target.id)).json()).case.sessions[0].analysis
 expect(stored.analysis_details.synthesis.method).toBe('verified_batch_merge')
 expect(stored.strengths.map((s:any)=>s.evidence_ids[0])).toEqual(['s1','s2'])
 expect(JSON.stringify(stored)).not.toContain('REJECTED_SYNTHESIS_PROSE')
 const calls=await(await request.get('/__synthetic_calls')).json()
 expect(calls.source_ids).toEqual(['s1','s2']);expect(calls.synthesis).toBe(2)
 await page.goto('/counseling/')
 await page.getByRole('button',{name:'학생부 상세 분석',exact:true}).click()
 const analysis=page.locator('.structured-analysis').first()
 await expect(analysis.getByRole('status')).toContainText('원문 대조를 마친 구간별 분석을 모은 결과')
 await expect(analysis).toContainText('자료의 출처를 비교하고 단위를 확인했다.')
 await analysis.screenshot({path:testInfo.outputPath('synthesis-verified-merge.png')})
 const pdf=await request.get('/api/cases/'+target.id+'/report.pdf?audience=analysis&session_id='+target.current_session_id)
 expect(pdf.status()).toBe(200)
 expect((await pdf.body()).subarray(0,5).toString()).toBe('%PDF-')
 expect(errors).toEqual([])
})
