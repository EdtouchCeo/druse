export const activityStrategyAreas=['자율·자치활동','동아리활동','진로활동','봉사활동','독서활동','행동특성 및 종합의견'] as const
export type ActivityStrategySection={title:string;heading:string;text:string}

/** Read headings already present in a plan; never fill a missing area or rewrite its content. */
export function activityStrategySections(text:string):{introduction:string;sections:ActivityStrategySection[]}{
 const introduction:string[]=[],sections:ActivityStrategySection[]=[]
 let current:{title:string;heading:string;lines:string[]}|undefined
 function finish(){if(current)sections.push({title:current.title,heading:current.heading,text:current.lines.join('\n')})}
 for(const line of text.split('\n')){
  const heading=line.trim().replace(/^#{1,6}\s+/,'').replace(/^\[([^\]]+)\]$/,'$1').replace(/^\*\*(.+)\*\*$/,'$1').trim()
  const marked=/^영역\s*[:：]\s*(.+)$/.exec(heading)
  const title=marked?.[1]?.trim()||(activityStrategyAreas.some(area=>area===heading)||heading==='자율활동'?heading:'')
  if(title){finish();current={title,heading:line,lines:[]}}
  else if(current)current.lines.push(line)
  else introduction.push(line)
 }
 finish()
 return {introduction:introduction.join('\n'),sections}
}
