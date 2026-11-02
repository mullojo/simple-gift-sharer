// Runtime is buildless. This development-only runner supplies the pinned SDK to
// the real-signing tests; it never contacts a chain API or broadcasts bitcoin.
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
let directory
try {
  let sdk = process.env.SDK_MODULE
  if (!sdk) {
    const response = await fetch('https://esm.sh/bitcoin-sdk-js@1.0.1/es2022/bitcoin-sdk-js.bundle.mjs', { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`SDK download failed (${response.status}).`)
    directory = await mkdtemp(join(tmpdir(), 'gift-sharer-tests-'))
    const path = join(directory, 'sdk.mjs')
    await writeFile(path, await response.text())
    sdk = pathToFileURL(path).href
  }
  const result = spawnSync(process.execPath, ['--test', 'tests/math.test.js', 'tests/lifecycle.test.js', 'tests/test-purses.test.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, SDK_MODULE: sdk }, stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} catch (error) { console.error(error.message, '\nUse SDK_MODULE=file:///absolute/path/to/sdk.mjs for an offline SDK bundle.'); process.exitCode = 1 }
finally { if (directory) await rm(directory, { recursive: true, force: true }) }
