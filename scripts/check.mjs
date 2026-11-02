// Parse all project JavaScript without executing browser code or contacting APIs.
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('..', import.meta.url))
const excluded = new Set(['.git', 'node_modules', '.cache', 'coverage', 'recovery', 'backups', 'local-data'])
let count = 0
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !excluded.has(entry.name)) await check(path)
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' })
      if (result.status !== 0) throw new Error(`Syntax check failed: ${relative(root, path)}`)
      count++
    }
  }
}
try { await check(root); console.log(`Syntax checks passed for ${count} JavaScript files.`) }
catch (error) { console.error(error.message); process.exitCode = 1 }
