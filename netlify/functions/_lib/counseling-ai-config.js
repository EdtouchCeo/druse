'use strict';
function getCounselingAiConfig(){
 const configured=Boolean(process.env.GEMINI_API_KEY||(process.env.VERTEX_PROJECT&&process.env.VERTEX_SA_KEY));
 return {enabled:process.env.COUNSELING_SERVER_AI_ENABLED!=='false'&&configured,model:process.env.LLM_MODEL||'gemini-2.5-flash'};
}
// 전략 생성: 서버 AI(Claude)가 기본이고 Gemini는 대체 경로다.
// COUNSELING_STRATEGY_PROVIDER=gemini 로 두면 Claude 연결을 쓰지 않는다(배포 없이 되돌리는 스위치).
// enabled·model은 기존 Gemini 설정 그대로다. Claude 키는 EdTouch 서버에 있어 이 함수의 환경변수가 아니다.
function getPrivateStrategyAiConfig(){
 const on=process.env.COUNSELING_SERVER_AI_ENABLED!=='false';
 const configured=Boolean(process.env.GEMINI_API_KEY||(process.env.VERTEX_PROJECT&&process.env.VERTEX_SA_KEY));
 const provider=String(process.env.COUNSELING_STRATEGY_PROVIDER||'claude').trim().toLowerCase()==='gemini'?'gemini':'claude';
 return {enabled:on&&configured,model:process.env.COUNSELING_STRATEGY_MODEL||'gemini-3.6-flash',provider,claude:{enabled:on&&provider==='claude',model:'claude (서버 AI)'}};
}
module.exports={getCounselingAiConfig,getPrivateStrategyAiConfig};
