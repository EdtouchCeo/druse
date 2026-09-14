import {writeFile} from 'node:fs/promises'
import {finalCase} from './studentResult'
const target=new URL('../../../../_workspace/student-result-20260914/school-linked-final-case.json',import.meta.url)
await writeFile(target,JSON.stringify(finalCase(true),null,2)+'\n','utf8')
console.log('Synthetic final case with reviewed school sources exported.')
