import type {Session} from './types'

/** An analysis document depends on the saved source, not the counseling workflow. */
export function analysisReportIssue(session:Session|undefined|null):string {
 if(!session?.record)return '학생부 PDF를 불러와 분석하면 보고서를 만들 수 있습니다.'
 if(!session.analysis)return '학생부 분석을 완료하면 보고서를 바로 확인하고 PDF로 저장할 수 있습니다.'
 if(!session.analysis.record_sha256)return '분석의 원본 연결 정보가 없습니다. 학생부를 다시 분석해 주세요.'
 if(session.analysis.record_sha256!==session.record.sha256)return '현재 학생부와 분석 자료가 다릅니다. 학생부를 다시 분석해 주세요.'
 return ''
}
