/**
 * Builds the app and runs electron-builder, retrying when Windows briefly locks a
 * freshly written .exe (antivirus scanning it). That shows up as "spawn UNKNOWN",
 * EBUSY or EPERM while NSIS makes the uninstaller; a second try then works.
 * Any other failure stops immediately.
 *
 *   node scripts/build.cjs --publish never|always
 */
const { spawn } = require('node:child_process')

const ATTEMPTS = 4
const WAIT_MS = 10000
const TRANSIENT = /spawn UNKNOWN|EBUSY|EPERM|resource busy or locked/i

function run(command, args) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(command, args, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (chunk) => {
        output += chunk
        process[stream].write(chunk)
      })
    }
    child.on('close', (code) => resolve({ code, output }))
  })
}

/**
 * electron-builder uploads the release files in parallel and each upload creates the
 * GitHub release if it's missing, so a new version could end up as two releases for
 * the same tag (one without latest.yml, which broke updates). Creating the release
 * first means every upload finds it. It starts as a draft, invisible to installed apps,
 * so none of them sees a release whose latest.yml isn't uploaded yet; the workflow
 * publishes it once every file is there.
 */
async function ensureRelease() {
  const { version } = require('../package.json')
  const { owner, repo } = { owner: 'PedroGraph', repo: 'price-tracker' }
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('Set GH_TOKEN first (see README → Releases).')
  const api = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) }
    })
  const tag = `v${version}`
  const res = await api('/releases?per_page=100')
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  const same = (await res.json()).filter((r) => r.tag_name === tag)
  if (same.length > 1) {
    throw new Error(`There are ${same.length} releases for ${tag}. Delete the extra ones on GitHub and run this again.`)
  }
  if (same.length === 1) return console.log(`Using the existing release ${tag}.`)
  const created = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, name: version, draft: true }) })
  if (!created.ok) throw new Error(`Could not create release ${tag}: ${created.status} ${await created.text()}`)
  console.log(`Created draft release ${tag}.`)
}

async function main() {
  const builderArgs = ['electron-builder', '--win', ...process.argv.slice(2)]
  if (builderArgs.includes('always')) {
    try {
      await ensureRelease()
    } catch (e) {
      console.error(`
✖ ${e.message}
`)
      process.exit(1)
    }
  }

  const vite = await run('npx', ['electron-vite', 'build'])
  if (vite.code !== 0) process.exit(vite.code)

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { code, output } = await run('npx', builderArgs)
    if (code === 0) return
    if (attempt === ATTEMPTS || !TRANSIENT.test(output)) process.exit(code)
    console.log(`\n⟳ Windows locked a file while packaging (usually the antivirus scanning it). Retrying in ${WAIT_MS / 1000}s… (${attempt + 1}/${ATTEMPTS})\n`)
    await new Promise((r) => setTimeout(r, WAIT_MS))
  }
}

main()
