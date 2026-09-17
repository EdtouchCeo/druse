'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../netlify/functions/_lib/counseling');
const P=require('../netlify/functions/_lib/counseling-profile');
const choice=(patch={})=>({id:C.newId(),university:'합성 대학',major:'생명과학과',admission_type:'학생부종합',admission_name:'합성전형',admission_year:2029,...patch});
function sample(){const c=C.newCase({student_id:C.newId(),student_number:'10101',academic_year:2026,school_stage:'high',grade:1},{id:C.newId(),display_name:'합성 교사'});c.sessions[0].profile.target_major='기존 관심 분야';return c;}

test('optional admission target rows are normalized and retained without inferred university or year',()=>{
 const c=sample(),id=C.newId();c.sessions[0].profile.admission_targets=[{id,major:'전공만 확인'}];C.validateCase(c);
 const profile=C.profileOf(c.sessions[0]);assert.deepEqual(profile.admission_targets,[{id,university:'',major:'전공만 확인',admission_type:'',admission_name:'',admission_year:null}]);
 assert.equal(profile.target_major,'기존 관심 분야');assert.deepEqual(C.normalizeCase(JSON.parse(JSON.stringify(c))).sessions[0].profile,profile);
 for(const patch of [{university:'대학만 확인'},{admission_type:'유형만 확인'},{admission_name:'전형명만 확인'},{admission_year:2030}]){c.sessions[0].profile.admission_targets=[{id,...patch}];C.validateCase(c);assert.equal(P.hasAdmissionTarget(C.profileOf(c.sessions[0]).admission_targets[0]),true);}
});

test('new empty defaults preserve the exact legacy nonempty profile hash representation',()=>{
 const c=sample(),s=c.sessions[0],profile=P.profileOf(s);delete profile.admission_targets;
 const expectedContent={id:s.id,date:s.date,topic:s.topic,student_question:s.student_question,context:s.context,evidence_notes:s.evidence_notes,teacher_opinion:s.teacher_opinion,next_date:s.next_date,actions:s.actions,profile,workflow_version:2};
 const oldHash=crypto.createHash('sha256').update(JSON.stringify(expectedContent)).digest('hex');
 assert.equal(C.hashSession(s),oldHash);
 delete s.profile.admission_targets;assert.equal(C.hashSession(C.normalizeCase(c).sessions[0]),oldHash);
 s.profile.admission_targets=[{id:C.newId()}];assert.equal(C.hashSession(s),oldHash);
 s.profile.admission_targets=[choice()];assert.notEqual(C.hashSession(s),oldHash);
});

test('actual choices invalidate review and confirmed choices cannot be edited',()=>{
 const c=sample(),s=c.sessions[0];s.review={state:'pending',content_hash:C.hashSession(s),created_at:C.now()};
 const next=structuredClone(c);next.sessions[0].profile.admission_targets=[choice()];
 const updated=C.updateCase(c,next);assert.equal(updated.sessions[0].review,null);assert.equal(updated.sessions[0].profile.admission_targets[0].university,'합성 대학');
 s.confirmed={at:C.now(),content_hash:C.hashSession(s),teacher_id:C.newId()};
 const changed=structuredClone(c);changed.sessions[0].profile.admission_targets=[choice()];assert.throws(()=>C.updateCase(c,changed),error=>error.code==='CONFIRMED_SESSION');
 const empty=structuredClone(c);empty.sessions[0].profile.admission_targets=[{id:C.newId()}];assert.equal(C.hashSession(C.updateCase(c,empty).sessions[0]),s.confirmed.content_hash);
});

test('admission validation rejects duplicate identifiers, invalid years, oversize strings and extra payloads',()=>{
 const row=choice();
 const invalid=[null,{},[null],[row,row],[row,{...row,id:row.id.toUpperCase()}],Array.from({length:13},()=>choice()),...[{id:'invalid'},{admission_year:true},{admission_year:'2029'},{admission_year:2029.5},{admission_year:2101},{admission_year:1989},{university:null},{major:'x'.repeat(201)},{admission_type:'x'.repeat(101)},{admission_name:'x\0y'},{raw_pdf:'forbidden'}].map(patch=>[{...row,...patch}])];
 for(const rows of invalid){const c=sample();c.sessions[0].profile.admission_targets=rows;assert.throws(()=>C.validateCase(c),C.HttpError);}
});
