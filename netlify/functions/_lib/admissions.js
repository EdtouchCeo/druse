// Generated from apps/counseling/src/lib/admissions.ts by scripts/sync-counseling-admissions.cjs. Do not edit directly.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.universityNames = void 0;
exports.getAdmissionContext = getAdmissionContext;
const admissions_json_1 = __importDefault(require("./admissions-data.json"));
const data = admissions_json_1.default;
exports.universityNames = [...new Set([...data.universities.map(u => u.name), ...data.directory.map(u => u.name)])].sort();
const aliases = { snu: ['서울대'], ku: ['고려대'], hyu: ['한양대'], kaist: ['카이스트'], gist: ['지스트'], dgist: ['디지스트'], unist: ['유니스트'], postech: ['포스텍', '포항공대'], kentech: ['켄텍', '한국에너지공대'], hufs: ['한국외대'], knu: ['경북대'] };
const norm = (value) => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/대학교/g, '대').replace(/[\s·._-]/g, '') : '';
function typeName(value) { const compact = norm(value).replace(/전형/g, ''); return { '학종': '학생부종합', '교과': '학생부교과', '종합': '학생부종합' }[compact] || compact; }
function universityParts(value) {
    const input = (value || '').normalize('NFKC').trim(), match = input.match(/\s*\(?\s*(서울|다빈치|안성|국제|글로벌|ERICA|에리카|WISE|와이즈|경주|나주)\s*(?:캠퍼스)?\s*\)?$/i);
    if (!match)
        return [norm(input), ''];
    const label = match[1].toLowerCase(), campus = { '안성': '다빈치', '에리카': 'erica', '와이즈': 'wise', '경주': 'wise' }[label] || label;
    return [norm(input.slice(0, match.index).trim()), campus];
}
function universityMatches(base, u) { return [u.name, u.name.split('(')[0], u.id, ...aliases[u.id] || []].some(name => norm(name) === base); }
function matchingLinks(directory, base, campus = '', u) {
    const names = new Set([base, ...u ? [u.name, u.name.split('(')[0], ...aliases[u.id] || []].map(norm) : []]);
    return directory.filter(link => { const [name, site] = universityParts(link.name); return names.has(name) && (!campus || !site || site === campus) && (!u || !site || u.campuses.includes(site)); });
}
function routeName(value) {
    const result = (value || '').normalize('NFKC').toLowerCase().replace(/[()\s·._-]/g, '').replace(/전형/g, '');
    for (const prefix of ['학생부종합', '학생부교과', '학종', '교과', '수능'])
        if (result.startsWith(prefix) && result.length > prefix.length)
            return result.slice(prefix.length);
    return result;
}
function preparation(type) {
    const value = typeName(type);
    if (value.includes('종합'))
        return ['희망 전공과 연결되는 과목을 고른 이유와 앞으로 배울 개념을 설명해 보세요. 과목 안에서 생긴 질문을 탐구로 발전시키고, 해석이 바뀐 이유를 자신의 말로 정리하는 준비가 도움이 됩니다.'];
    if (value.includes('교과'))
        return ['앞으로 이수할 과목에서 개념 이해와 문제 해결을 안정적으로 이어갈 방법을 정하세요. 대학의 교과 반영 범위와 수능최저가 확인되면 학교 수업과 수능 학습의 준비 범위를 함께 조정합니다.'];
    if (value.includes('논술'))
        return ['수업에서 읽는 자료의 주장과 근거를 구분하고, 정해진 조건 안에서 설명을 구성하는 연습을 해보세요. 지원 전형의 논술 유형과 교과 범위가 확인되면 그 범위에 맞춰 준비합니다.'];
    if (value.includes('수능') || value.includes('정시'))
        return ['교과 개념을 연결해 문제를 해결하고 오답의 원인을 설명하는 학습을 이어가세요. 확인된 수능 반영 영역과 학생부·면접 반영 여부에 따라 과목별 준비 범위를 정합니다.'];
    return ['관심 전공에서 배우는 내용과 앞으로 선택할 수 있는 과목을 비교하세요. 대학과 전형을 정하면 평가요소에 맞춰 교과 학습, 탐구 설명, 면접 준비의 비중을 조정합니다.'];
}
function getAdmissionContext(profile) {
    const targets = [];
    for (const target of profile.admission_targets || []) {
        const requested = { university: target.university || '', major: target.major || '', admission_type: target.admission_type || '', admission_name: target.admission_name || '', admission_year: target.admission_year ?? null };
        if (!Object.values(requested).some(Boolean))
            continue;
        const [queryUniversity, campus] = universityParts(requested.university);
        const baseMatches = data.universities.filter(u => universityMatches(queryUniversity, u));
        const matching = baseMatches.filter(u => !campus || u.campuses.includes(campus));
        const links = matchingLinks(data.directory, queryUniversity, campus);
        const row = { requested, match_status: 'university_not_found', university: requested.university, admission_year: null, reference_only: true, reference_status: '대학별 자료 확인 필요', source_url: '', source_title: '', reviewed_on: data.reviewed_on, elements: [], course_recommendations: [], campus_scope: '', links, notes: [], preparation_focus: preparation(requested.admission_type) };
        if (!matching.length) {
            row.match_status = !requested.university ? 'university_required' : baseMatches.length && campus ? 'campus_not_reviewed' : links.length ? 'directory_only' : 'university_not_found';
            row.notes = ['선택한 대학의 전형요소를 확인한 자료가 아직 없습니다. 입학처에서 해당 대입 학년도와 모집단위의 안내를 확인한 뒤 구체적인 조건을 적용합니다.'];
            if (row.match_status === 'campus_not_reviewed')
                row.notes.push('입력한 캠퍼스의 시행계획을 확인한 상세자료가 없습니다. 다른 캠퍼스의 전형을 대신 적용하지 않습니다.');
            targets.push(row);
            continue;
        }
        const u = matching[0];
        row.university = u.name;
        row.campus_scope = u.campus_scope;
        row.admission_year = u.admission_year;
        row.source_url = u.source_url;
        row.source_title = u.source_title;
        row.reviewed_on = u.reviewed_on;
        row.reference_only = requested.admission_year !== u.admission_year;
        row.reference_status = (row.reference_only ? (requested.admission_year ? `${u.admission_year}학년도 참고자료 · 희망 ${requested.admission_year}학년도와 다름` : `${u.admission_year}학년도 참고자료 · 희망 대입 학년도 미입력`) : `${u.admission_year}학년도 시행계획`) + (row.campus_scope ? ' · ' + row.campus_scope : '') + ` · ${u.reviewed_on} 확인`;
        row.notes = [row.reference_only ? '이 자료의 전형방법과 권장과목을 희망 대입 학년도의 확정 조건으로 적용하지 않습니다.' : '지원 전 최종 모집요강과 정정 공지를 확인하세요.', '모집단위별 적용 범위는 아래 조건과 공식 자료로 확인합니다. 희망 전공을 입력한 것만으로 지원자격이 확인되지는 않습니다.'];
        row.links = matchingLinks(data.directory, queryUniversity, campus, u);
        const type = norm(typeName(requested.admission_type));
        const typed = u.routes.filter(route => !type || norm(route.type).includes(type) || norm(route.round).includes(type));
        const query = routeName(requested.admission_name);
        const exact = typed.filter(route => routeName(route.name) === query);
        const selected = query ? (exact.length ? exact : typed.filter(route => query.length > 1 && routeName(route.name).includes(query))) : typed;
        row.course_recommendations = selected.length ? [...u.shared_rules] : [];
        if (!selected.length) {
            row.match_status = 'route_not_found';
            row.notes.push('입력한 전형명과 일치하는 검토 자료가 없습니다. 아래 입학처에서 정확한 전형명을 확인하세요.');
            targets.push(row);
            continue;
        }
        if (!query || selected.length > 3) {
            row.match_status = 'overview';
            row.elements = selected.map(route => ({ ...route, selection: [], csat: [], assessment: [], interview: [], courses: [], eligibility: '', exceptions: [] }));
            row.notes.push('전형명을 입력하면 해당 경로의 전형방법과 준비 범위를 볼 수 있습니다.');
        }
        else {
            row.match_status = selected.length === 1 ? 'matched' : 'candidates';
            row.elements = selected;
        }
        targets.push(row);
    }
    return { targets, scope: '대입 학년도와 캠퍼스·전형·모집단위가 맞는 범위만 전략에 반영합니다. 시행계획은 최종 모집요강과 구분합니다.', coverage: data.coverage };
}
