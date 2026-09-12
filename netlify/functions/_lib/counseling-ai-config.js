'use strict';
function getCounselingAiConfig(){
 const configured=Boolean(process.env.GEMINI_API_KEY||(process.env.VERTEX_PROJECT&&process.env.VERTEX_SA_KEY));
 return {enabled:process.env.COUNSELING_SERVER_AI_ENABLED!=='false'&&configured,model:process.env.LLM_MODEL||'gemini-2.5-flash'};
}
module.exports={getCounselingAiConfig};
