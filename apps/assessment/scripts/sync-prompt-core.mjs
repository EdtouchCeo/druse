// edtouch01의 구현 프롬프트 공통 핵심(core)을 이 앱으로 복사한다.
// 사용: node scripts/sync-prompt-core.mjs --edtouch <edtouch01 저장소 경로>
// 복사본(src/lib/promptCore/)은 손으로 고치지 않는다. 고칠 일이 있으면 edtouch01 원본을 고치고 다시 복사한다.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'src/lib/promptCore')
const argIndex = process.argv.indexOf('--edtouch')
const repo = argIndex > -1 ? process.argv[argIndex + 1] : ''
if (!repo) throw new Error('edtouch01 저장소 경로를 --edtouch 뒤에 적어 주세요.')
const relative = 'v2/src/lib/promptBuilder/core'
const source = path.resolve(repo, relative)

const git = (...args) => { try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim() } catch { return '' } }
const head = git('rev-parse', '--short=12', 'HEAD') || '알 수 없음'
const dirty = git('status', '--porcelain', '--', relative)
const origin = dirty ? `working-tree(HEAD ${head} 위의 커밋 전 변경)` : head

const files = (await readdir(source)).filter(name => name.endsWith('.ts')).sort()
if (!files.includes('index.ts')) throw new Error(`${source}에 core index.ts가 없습니다.`)
await mkdir(target, { recursive: true })
for (const old of await readdir(target)) if (old.endsWith('.ts') && !files.includes(old)) await rm(path.join(target, old))

const report = []
for (const name of files) {
  const text = (await readFile(path.join(source, name), 'utf8')).replace(/\r\n/g, '\n')
  if (/from ['"](vue|@\/)/.test(text)) throw new Error(`${name}가 vue나 @/를 가져옵니다. core는 순수 TypeScript여야 합니다.`)
  const sha = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const header = [
    '// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.',
    `// 원본: edtouch01 ${relative}/${name} · 원본 커밋 ${origin} · sha256 ${sha}`,
    '',
  ].join('\n')
  await writeFile(path.join(target, name), header + text)
  report.push(`${name} ${sha}`)
}
console.log(`core ${files.length}개 파일을 복사했습니다. 원본 커밋 ${origin}`)
for (const line of report) console.log('  ' + line)
