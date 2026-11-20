const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parsedVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) return undefined
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  }
}

/** A YYYY-MM-DD key in the Host's local time zone, not UTC. */
export function localDateKey(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Compare ordinary npm semantic versions, including prerelease precedence. */
export function compareVersions(left, right) {
  const a = parsedVersion(left)
  const b = parsedVersion(right)
  if (!a || !b) throw new Error(`Invalid semantic version: ${!a ? left : right}`)
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) > Number(y) ? 1 : -1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function isNewerVersion(candidate, current) {
  if (!parsedVersion(candidate)) return false
  if (!parsedVersion(current)) return true
  return compareVersions(candidate, current) > 0
}

/** npm may print either a JSON string or an object carrying `version`. */
export function versionFromNpmOutput(output) {
  const text = String(output ?? '').trim()
  try {
    const parsed = JSON.parse(text)
    const version = typeof parsed === 'string' ? parsed : parsed?.version
    if (parsedVersion(version)) return version.trim()
  } catch {}
  const version = text.replace(/^v/, '')
  if (parsedVersion(version)) return version
  throw new Error('The package manager returned an invalid version')
}
