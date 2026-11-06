#!/usr/bin/env node
// /evalplan/·/backward/ 재빌드. 사용법은 README.md.
import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const which = process.argv[2]
if (!['evalplan', 'backward', 'all'].includes(which)) {
  throw new Error('사용법: node apps/ai-ports/build.mjs evalplan|backward|all --edtouch <edtouch01 저장소> --data-analysis <data_analysis 저장소>')
}

const APPS = {
  evalplan: { repoArg: '--edtouch', sub: 'v2', commonDir: 'src/daeryun-port/common' },
  backward: { repoArg: '--data-analysis', sub: '.', commonDir: 'src/daeryun-port/common' },
}

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

function applyPatches(root, patches) {
  for (const [rel, edits] of Object.entries(patches)) {
    const file = join(root, rel)
    let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const [label, from, to] of edits) {
      const hits = typeof from === 'string'
        ? s.split(from).length - 1
        : (s.match(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g')) || []).length
      if (hits !== 1) throw new Error(`${rel}: '${label}' 기준 문자열 ${hits}건(1건이어야 함). 원본이 바뀌었으니 patches.mjs를 먼저 고치세요.`)
      s = s.replace(from, to)
    }
    writeFileSync(file, s)
  }
}

function checkBundle(dir, { forbidden, required }) {
  const text = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  for (const w of forbidden) if (text.includes(w)) throw new Error(`번들에 금지 문자열이 있습니다: ${w}`)
  for (const w of required) if (!text.includes(w)) throw new Error(`번들에 필요한 문자열이 없습니다: ${w}`)
}

async function build(app) {
  const cfg = APPS[app]
  const sourceArg = arg(cfg.repoArg)
  if (!sourceArg) throw new Error(`${cfg.repoArg} 경로가 필요합니다.`)
  const source = resolve(sourceArg)
  const commit = execFileSync('git', ['-C', source, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()

  // 작업 중인 파일이 섞이지 않도록 커밋된 내용만 꺼낸다.
  const work = join(arg('--workspace') || join(tmpdir(), 'daeryun-ai-ports'), app)
  const link = join(work, 'node_modules')
  if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  execFileSync('git', ['-C', join(source, cfg.sub), 'archive', '--format=tar', '-o', join(work, 'source.tar'), 'HEAD', '.'])
  execFileSync('tar', ['-xf', 'source.tar'], { cwd: work })
  rmSync(join(work, 'source.tar'))

  const overlay = join(HERE, app)
  cpSync(overlay, work, { recursive: true, filter: (p) => !/(patches\.mjs|vite\.config\.ts)$/.test(p) })
  cpSync(join(overlay, 'vite.config.ts'), join(work, 'vite.port.config.ts'))
  cpSync(join(HERE, 'common'), join(work, cfg.commonDir), { recursive: true })

  const spec = await import(pathToFileURL(join(overlay, 'patches.mjs')).href)
  applyPatches(work, spec.patches)

  const modules = join(source, cfg.sub, 'node_modules')
  if (existsSync(modules)) symlinkSync(modules, link, 'junction')
  else run('npm', ['ci'], work)

  run('npx', ['vite', 'build', '--config', 'vite.port.config.ts'], work)

  const dist = join(work, 'dist-port')
  checkBundle(join(dist, 'assets'), spec)

  const out = join(REPO, 'output', 'web', app)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  renameSync(join(dist, `${app}.html`), join(out, 'index.html'))
  cpSync(join(dist, 'assets'), join(out, 'assets'), { recursive: true })

  unlinkSync(link)
  console.log(`${app}: output/web/${app}/ 갱신(원본 ${commit})`)
  return commit
}

const inventoryFile = join(HERE, 'BUILD-INVENTORY.json')
const inventory = existsSync(inventoryFile) ? JSON.parse(readFileSync(inventoryFile, 'utf8')) : {}
for (const app of which === 'all' ? Object.keys(APPS) : [which]) {
  inventory[app] = { sourceCommit: await build(app) }
}
writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2) + '\n')
