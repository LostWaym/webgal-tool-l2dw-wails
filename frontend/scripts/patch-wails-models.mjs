// Patches the auto-generated wailsjs/go/models.ts file to fix a TS1011 error
// the Wails binding generator occasionally emits:
//   this.File = this.convertValues(source["File"], FileHeader[], true);
//    --> FileHeader[] is parsed as element access, not an Array constructor call.
// The fix replaces it with `FileHeader` (the value) and relies on convertValues'
// built-in array handling.
//
// Re-run this after every `wails generate module` to keep the build green.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const target = resolve(__dirname, '..', 'wailsjs', 'go', 'models.ts')

const BAD = 'this.File = this.convertValues(source["File"], FileHeader[], true);'
const GOOD = 'this.File = this.convertValues(source["File"], FileHeader, true);'

async function main() {
  let src
  try {
    src = await readFile(target, 'utf8')
  } catch {
    // File may not exist yet if no binding has been generated. That's fine.
    return
  }
  if (!src.includes(BAD)) {
    // Either already fixed or the upstream generator changed. Either way,
    // nothing to do.
    return
  }
  const fixed = src.replace(BAD, GOOD)
  await writeFile(target, fixed, 'utf8')
  console.log('[patch-wails-models] Fixed TS1011 issue in', target)
}

main().catch((e) => {
  console.error('[patch-wails-models] failed:', e)
  process.exitCode = 1
})
