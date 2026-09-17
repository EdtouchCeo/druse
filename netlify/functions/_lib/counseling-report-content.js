// Generated from apps/counseling/src/lib/reportContent.ts by scripts/sync-counseling-report-content.cjs. Do not edit directly.
// Source SHA-256: 648b72814443c3d7c9533d33155b01704fabc12a100fe18017cf524f15e1a402
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayText = displayText;
exports.consumerLine = consumerLine;
exports.inlineParts = inlineParts;
exports.reportBlocks = reportBlocks;
// Format a display copy. Never rewrite the saved strategy or student record.
function displayText(text) {
    const commands = { rightarrow: '→', Rightarrow: '⇒', to: '→', leftarrow: '←', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', times: '×', cdot: '·', leq: '≤', geq: '≥', neq: '≠', pm: '±', approx: '≈' };
    const math = (value) => value.replace(/\\(rightarrow|Rightarrow|to|leftarrow|Leftarrow|leftrightarrow|Leftrightarrow|times|cdot|leq|geq|neq|pm|approx)\b/g, (_, key) => commands[key]);
    return text.replace(/\rightarrow/g, '→').replace(/\text\{([^{}]*)\}/g, '$1').replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:p|div|h[1-6]|li|ul|ol)\b[^>]*>/gi, '\n')
        .replace(/<\/?(?:strong|b)\b[^>]*>/gi, '**').replace(/<\/?(?:em|i|span|a)\b[^>]*>/gi, '')
        .replace(/&#(x[\da-f]+|\d+);/gi, (entity, value) => { const n = value[0]?.toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : parseInt(value, 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity; })
        .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, key) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key]))
        .replace(/\$\$?([^$\n]*\\[a-zA-Z]+[^$\n]*)\$\$?/g, (_, value) => math(value))
        .replace(/\\\((.*?)\\\)/g, (_, value) => math(value))
        .replace(/\\(rightarrow|Rightarrow|to|leftarrow|Leftarrow|leftrightarrow|Leftrightarrow|times|cdot|leq|geq|neq|pm|approx)\b/g, (_, key) => commands[key])
        .replace(/\$([^$\n]*[→←⇒⇐↔⇔][^$\n]*)\$/g, (original, body) => /^\s*\d/.test(body) ? original : body);
}
function consumerLine(line) {
    const plain = line.replace(/\*\*|__/g, '');
    if (/^\s*(?:[-*•]\s*|#{1,6}\s*)?(?:원문\s*근거|확인\s*위치|원문\s*위치|자료\s*ID|근거\s*ID)\s*[:：]/.test(plain))
        return null;
    const source = /^(\s*(?:[-*•]\s*|#{1,6}\s*)?출처\s*[:：]\s*)(.*)$/.exec(plain);
    if (!source)
        return line;
    const schoolLink = /(?:^|·)\s*(?:\/[A-Za-z_][A-Za-z0-9_/-]*\/|개정\s*(?:\d+|확인\s*필요))/.test(source[2]);
    const parts = source[2].split('·').map((part, index) => {
        if (/^개정\s*(?:\d+|확인\s*필요)$/.test(part.trim()) || schoolLink && index > 0 && /^자료\s+(?:ID\s*[:：]?\s*)?[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(part.trim()))
            return '';
        return part.replace(/(?<![:/\w])\/(?:[A-Za-z_][A-Za-z0-9_.~-]*\/)+[A-Za-z0-9_.~-]+/g, '').replace(/(?:자료\s+(?:ID\s*[:：]?\s*)?)?\b(?:source|section|src)[-_][A-Za-z0-9_-]+\b/gi, '').replace(/(?:자료\s+(?:ID\s*[:：]?\s*)?)?\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '').trim().replace(/^[·,;]+|[·,;]+$/g, '');
    }).filter(Boolean);
    return parts.length ? source[1] + parts.join(' · ') : null;
}
function inlineParts(text) { return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => ({ strong: part.startsWith('**') && part.endsWith('**'), text: part.startsWith('**') && part.endsWith('**') ? part.slice(2, -2) : part })); }
function cells(line) { return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|')); }
function reportBlocks(text, options = {}) {
    const lines = displayText(text).split('\n').map(line => options.hideEvidence ? consumerLine(line) : line).filter((line) => line !== null), result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i], trim = line.trim(), next = lines[i + 1]?.trim() || '';
        if (trim.includes('|')) {
            const headers = cells(trim), separator = cells(next);
            if (headers.length >= 2 && separator.length === headers.length && separator.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))) {
                const rows = [];
                let end = i + 2;
                while (end < lines.length && lines[end].includes('|')) {
                    const row = cells(lines[end]);
                    if (row.length !== headers.length)
                        break;
                    rows.push(row);
                    end++;
                }
                // A table must contain data; otherwise preserve every original line as prose.
                if (rows.length) {
                    result.push({ kind: 'table', headers, rows });
                    i = end - 1;
                    continue;
                }
            }
        }
        const heading = /^#{1,6}\s+(.+)$/.exec(trim) || /^\[([^\]]+)\]$/.exec(trim);
        if (heading) {
            result.push({ kind: 'heading', text: heading[1] });
            continue;
        }
        const detail = /^(현재 근거|준비 방향|준비할 자료·결과물|필요한 도움|연결할 교과·탐구|학습 목표|학습 과목과 개념|배울 과목과 개념|과목과 선택 조건|학습 개념·방법|탐구 질문|자료 선정·확보 대안|준비 결과|학습 방법|탐구 질문과 방법|준비 자료와 결과물|다음 단계로 이어지는 이유)\s*[:：]\s*(.*)$/.exec(trim);
        if (detail) {
            result.push({ kind: 'detail', label: detail[1], text: detail[2] });
            continue;
        }
        if (/^(?:주제\s*\d*|탐구 주제|과목|교과|단계|후보\s*\d+|\d학년(?:\s*(?:[12]학기|남은 학기))?)\s*[:：]/.test(trim)) {
            result.push({ kind: 'heading', text: trim });
            continue;
        }
        const bullet = /^(?:[-*•]\s+|\d+[.)]\s+|[☐□]\s*)(.+)$/.exec(trim);
        if (bullet) {
            const previous = result.at(-1);
            if (previous?.kind === 'list')
                previous.items.push(bullet[1]);
            else
                result.push({ kind: 'list', items: [bullet[1]] });
            continue;
        }
        result.push({ kind: 'paragraph', text: line, source: /^\s*(출처:|자료 ID:|원문 위치:)/.test(line) });
    }
    return result;
}
