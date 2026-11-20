import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { AcpCliUpdates, packageManagerArgv } from '../lib/updates.js'
import { compareVersions, isNewerVersion, localDateKey, versionFromNpmOutput } from '../lib/version.js'

const packageName = '@fake/acp'

function entries(overrides = {}) {
  return [['fake', {
    displayName: 'Fake ACP',
    enabled: true,
    packageName,
    command: '',
    ...overrides,
  }]]
}

function bundledResolver() {
  return { version: '1.0.0', entry: '/bundled/fake-acp.js', source: 'bundled' }
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'acp-updates-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = []
  let releaseView = () => {}
  const viewGate = options.deferView ? new Promise(resolve => { releaseView = resolve }) : undefined
  const runner = async request => {
    calls.push(request.args)
    if (request.args[0] === 'view') {
      if (viewGate) await viewGate
      if (options.checkError) throw new Error('registry unavailable')
      return JSON.stringify('1.1.0')
    }
    if (options.installError) throw new Error('install failed')
    const prefix = request.args[request.args.indexOf('--prefix') + 1]
    const packageRoot = join(prefix, 'node_modules', '@fake', 'acp')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: packageName,
      version: '1.1.0',
      main: 'index.js',
    }))
    await writeFile(join(packageRoot, 'index.js'), 'export {}\n')
    return ''
  }
  const updates = new AcpCliUpdates({
    entries: entries(options.profile),
    subprocess: {},
    cacheDirectory: directory,
    bundledResolver,
    runner,
    now: options.now ?? (() => new Date(2026, 10, 20, 8, 0, 0)),
  })
  return { directory, calls, runner, updates, releaseView }
}

test('compares semantic versions and formats local calendar dates', () => {
  assert.equal(localDateKey(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02')
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.2'), 1)
  assert.equal(compareVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1)
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true)
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false)
  assert.equal(versionFromNpmOutput('{"version":"2.3.4"}'), '2.3.4')
  assert.equal(versionFromNpmOutput('"2.3.4"\n'), '2.3.4')
})

test('reports the OpenAI Codex CLI version separately from its ACP adapter', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-codex-version-test-'))
  const updates = new AcpCliUpdates({
    entries: [['codex', {
      displayName: 'Codex (ACP)', enabled: true, packageName: '@agentclientprotocol/codex-acp', command: '',
    }]],
    subprocess: {}, cacheDirectory: directory,
  })
  t.after(async () => { await updates.dispose(); await rm(directory, { recursive: true, force: true }) })
  const provider = updates.snapshot().providers[0]
  assert.equal(provider.version, '0.170.0')
  assert.equal(provider.packageName, '@openai/codex')
  assert.equal(provider.adapterVersion, '2.8.0')
  assert.equal(provider.adapterPackageName, '@agentclientprotocol/codex-acp')
  assert.equal(provider.updateKind, 'adapter')
})

test('resolves Windows npm.cmd through node without a shell', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-npm-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const npm = join(directory, 'npm.cmd')
  const cli = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await mkdir(dirname(cli), { recursive: true })
  await writeFile(npm, '@echo off\n')
  await writeFile(cli, '// npm\n')
  const subprocess = {
    async resolveExecutable(command) {
      if (command === 'npm.cmd') return npm
      if (command === 'node') return join(directory, 'node.exe')
      return '/usr/bin/npm'
    },
  }
  const argv = await packageManagerArgv(subprocess, 'npm.cmd', ['view', 'pkg'], undefined, 'win32')
  assert.deepEqual(argv, [join(directory, 'node.exe'), cli, 'view', 'pkg'])
  assert.deepEqual(await packageManagerArgv(subprocess, 'npm', ['view'], undefined, 'linux'), ['/usr/bin/npm', 'view'])
})

test('checks once on the first start of each local day and caches a new version', async t => {
  const { directory, calls, updates } = await fixture(t)
  t.after(() => updates.dispose())
  await updates.checkDaily()
  await updates.checkDaily()
  assert.equal(calls.filter(args => args[0] === 'view').length, 1)
  assert.equal(updates.snapshot().providers[0].updateAvailable, true)
  assert.equal(updates.snapshot().providers[0].latestVersion, '1.1.0')

  const restarted = new AcpCliUpdates({
    entries: entries(), subprocess: {}, cacheDirectory: directory, bundledResolver,
    runner: async request => { calls.push(request.args); return '"1.1.0"' },
    now: () => new Date(2026, 10, 20, 23, 0, 0),
  })
  t.after(() => restarted.dispose())
  await restarted.checkDaily()
  assert.equal(calls.filter(args => args[0] === 'view').length, 1)
  assert.equal(restarted.snapshot().providers[0].updateAvailable, true)
})

test('persists the daily attempt even when the registry check fails', async t => {
  const { directory, calls, updates } = await fixture(t, { checkError: true })
  t.after(() => updates.dispose())
  await updates.checkDaily()
  assert.equal(calls.length, 1)
  assert.equal(updates.snapshot().providers[0].checkError, 'registry unavailable')
  assert.equal(updates.snapshot().providers[0].updateAvailable, false)

  const restarted = new AcpCliUpdates({
    entries: entries(), subprocess: {}, cacheDirectory: directory, bundledResolver,
    runner: async request => { calls.push(request.args); return '"1.1.0"' },
    now: () => new Date(2026, 10, 20, 18, 0, 0),
  })
  t.after(() => restarted.dispose())
  await restarted.checkDaily()
  assert.equal(calls.length, 1)
  const stored = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
  assert.equal(stored.lastCheckDate, '2026-11-20')
})

test('an upgrade waits for an in-progress daily check before installing', async t => {
  const { calls, updates, releaseView } = await fixture(t, { deferView: true })
  t.after(() => updates.dispose())
  const checking = updates.checkDaily()
  const upgrading = updates.upgrade('fake')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.filter(args => args[0] === 'install').length, 0)
  releaseView()
  await Promise.all([checking, upgrading])
  assert.equal(calls.filter(args => args[0] === 'view').length, 1)
  assert.equal(calls.filter(args => args[0] === 'install').length, 1)
})

test('serializes lifecycle operations that could otherwise restart the plugin', async t => {
  const { updates } = await fixture(t)
  t.after(() => updates.dispose())
  const order = []
  let release = () => {}
  const gate = new Promise(resolve => { release = resolve })
  const first = updates.serialize(async () => { order.push('first:start'); await gate; order.push('first:end') })
  const second = updates.serialize(async () => { order.push('second:start') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['first:start'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start'])
})

test('dispose rejects an upgrade queued behind a configuration reload without a wait cycle', async t => {
  const { updates } = await fixture(t)
  let finishConfiguration = () => {}
  const configuration = updates.serialize(() => new Promise(resolve => { finishConfiguration = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const upgrading = updates.upgrade('fake')
  const rejected = assert.rejects(upgrading, /disposed/)
  let timer
  try {
    await Promise.race([
      updates.dispose(),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('dispose deadlocked')), 100) }),
    ])
  } finally { clearTimeout(timer) }
  await rejected
  // The already-running configuration operation is not rejected by its own reload.
  finishConfiguration()
  await configuration
  assert.equal(updates.snapshot().providers[0].upgrading, false)
})

test('installs an upgrade beside the active CLI and selects it after restart', async t => {
  const { directory, updates } = await fixture(t)
  t.after(() => updates.dispose())
  await updates.checkDaily()
  const result = await updates.upgrade('fake')
  const provider = result.providers[0]
  assert.equal(provider.version, '1.0.0')
  assert.equal(provider.installedVersion, '1.1.0')
  assert.equal(provider.restartRequired, true)
  assert.equal(provider.upgrading, false)
  assert.equal(provider.updateAvailable, false)
  assert.match(updates.runtimeEntries(entries())[0][1].cliEntry, /1\.1\.0.*index\.js$/)

  const restarted = new AcpCliUpdates({
    entries: entries(), subprocess: {}, cacheDirectory: directory, bundledResolver,
    runner: async () => { throw new Error('same-day check should not run') },
    now: () => new Date(2026, 10, 20, 22, 0, 0),
  })
  t.after(() => restarted.dispose())
  await restarted.checkDaily()
  assert.equal(restarted.snapshot().providers[0].version, '1.1.0')
  assert.equal(restarted.snapshot().providers[0].restartRequired, false)
  const manifest = JSON.parse(await readFile(join(directory, 'packages', 'fake', '1.1.0', 'node_modules', '@fake', 'acp', 'package.json'), 'utf8'))
  assert.equal(manifest.version, '1.1.0')
})

test('keeps the previous CLI selected when an upgrade fails', async t => {
  const { directory, updates } = await fixture(t, { installError: true })
  t.after(() => updates.dispose())
  await updates.checkDaily()
  await assert.rejects(updates.upgrade('fake'), /install failed/)
  const provider = updates.snapshot().providers[0]
  assert.equal(provider.installedVersion, '1.0.0')
  assert.equal(provider.updateAvailable, true)
  assert.equal(provider.upgradeError, 'install failed')
  assert.equal(updates.runtimeEntries(entries())[0][1].cliEntry, '/bundled/fake-acp.js')
  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
  assert.equal(state.selectedVersions.fake, undefined)
})

test('external commands are listed but are not replaced by managed upgrades', async t => {
  const { calls, updates } = await fixture(t, { profile: { command: '/external/fake-acp', packageName: '' } })
  t.after(() => updates.dispose())
  await updates.checkDaily()
  assert.equal(calls.length, 0)
  assert.equal(updates.snapshot().providers[0].managed, false)
  await assert.rejects(updates.upgrade('fake'), /does not support managed CLI upgrades/)
})
