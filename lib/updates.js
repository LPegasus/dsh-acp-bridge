import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { CODEX_ACP_PACKAGE, CODEX_CLI_PACKAGE } from './codex.js'
import { isNewerVersion, localDateKey, versionFromNpmOutput } from './version.js'

const PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const DEFAULT_CHECK_TIMEOUT_MS = 20_000
const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000
const MAX_DIAGNOSTIC = 1200

function messageOf(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_DIAGNOSTIC)
}

function defaultCacheDirectory() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(resolve(home), 'cache', 'acp-bridge')
}

function emptyState() {
  return {
    version: 1,
    lastCheckDate: '',
    selectedVersions: {},
    latestVersions: {},
    checkErrors: {},
    restartRequired: {},
  }
}

function stringRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string'))
}

function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return emptyState()
    return {
      version: 1,
      lastCheckDate: typeof value.lastCheckDate === 'string' ? value.lastCheckDate : '',
      selectedVersions: stringRecord(value.selectedVersions),
      latestVersions: stringRecord(value.latestVersions),
      checkErrors: stringRecord(value.checkErrors),
      restartRequired: Object.fromEntries(Object.entries(value.restartRequired ?? {}).filter(([, item]) => item === true)),
    }
  } catch {
    return emptyState()
  }
}

function bundledInstallation(packageName) {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return { version: manifest.version, entry: require.resolve(packageName), source: 'bundled' }
}

function dependencyInstallation(installation, packageName) {
  if (!installation?.entry) return undefined
  try {
    // Resolve from the selected adapter, not from this plugin: an upgraded
    // adapter may carry a different compatible OpenAI Codex CLI dependency.
    const require = createRequire(installation.entry)
    const manifestPath = require.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return { packageName, version: manifest.version }
  } catch {
    return undefined
  }
}

function packageDirectory(root, packageName) {
  return join(root, 'node_modules', ...packageName.split('/'))
}

function within(root, candidate) {
  const base = resolve(root)
  const path = resolve(candidate)
  return path === base || path.startsWith(`${base}${sep}`)
}

async function managedInstallation(root, packageName, version) {
  if (!PACKAGE_PATTERN.test(packageName) || !version || !within(root, join(root, version))) return undefined
  const installRoot = join(root, version)
  const manifestPath = join(packageDirectory(installRoot, packageName), 'package.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.name !== packageName || manifest.version !== version) return undefined
    const require = createRequire(join(installRoot, 'package.json'))
    return { version, entry: require.resolve(packageName), source: 'managed', installRoot }
  } catch {
    return undefined
  }
}

function managedInstallationSync(root, packageName, version) {
  if (!PACKAGE_PATTERN.test(packageName) || !version || !within(root, join(root, version))) return undefined
  const installRoot = join(root, version)
  const manifestPath = join(packageDirectory(installRoot, packageName), 'package.json')
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== packageName || manifest.version !== version) return undefined
    const require = createRequire(join(installRoot, 'package.json'))
    return { version, entry: require.resolve(packageName), source: 'managed', installRoot }
  } catch {
    return undefined
  }
}

/** Resolve npm's JavaScript entry on Windows; Node rejects direct .cmd spawns. */
export async function packageManagerArgv(subprocess, packageManager, args, signal, platform = process.platform) {
  const executable = await subprocess.resolveExecutable(packageManager, {}, signal)
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) return [executable, ...args]
  if (!/^npm(?:\.(?:cmd|bat))?$/i.test(packageManager)) {
    throw new Error(`Windows package manager ${JSON.stringify(packageManager)} is unsupported; use npm`)
  }
  const cli = join(dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const info = await stat(cli)
  if (!info.isFile()) throw new Error(`npm CLI entry is not a file: ${cli}`)
  const node = await subprocess.resolveExecutable('node', {}, signal)
  return [node, cli, ...args]
}

/** Run npm without a shell and retain only bounded diagnostic tails. */
export async function runPackageManager(subprocess, packageManager, { args, cwd, signal, timeoutMs }) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const lifetime = AbortSignal.any([signal, timeout].filter(Boolean))
  const argv = await packageManagerArgv(subprocess, packageManager, args, lifetime)
  const handle = subprocess.spawn({
    argv,
    cwd,
    env: { NO_UPDATE_NOTIFIER: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 3000,
    signal: lifetime,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  if (timeout.aborted) throw new Error(`Package manager timed out after ${timeoutMs} ms`)
  if (signal?.aborted) throw new Error('Package manager operation was cancelled')
  if (outcome.exitCode !== 0) {
    const diagnostic = (stderr || stdout).trim().slice(-MAX_DIAGNOSTIC)
    throw new Error(diagnostic || `Package manager exited with code ${outcome.exitCode}`)
  }
  return stdout
}

/**
 * Owns persisted daily checks and version-isolated CLI package installations.
 * An upgrade never overwrites the package a running ACP process loaded.
 */
export class AcpCliUpdates {
  constructor({
    entries,
    subprocess,
    logger,
    cacheDirectory = defaultCacheDirectory(),
    packageManager = process.platform === 'win32' ? 'npm.cmd' : 'npm',
    now = () => new Date(),
    runner,
    bundledResolver = bundledInstallation,
    checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
    installTimeoutMs = DEFAULT_INSTALL_TIMEOUT_MS,
  }) {
    this.entries = new Map(entries)
    this.subprocess = subprocess
    this.logger = logger
    this.cacheDirectory = resolve(cacheDirectory)
    this.stateFile = join(this.cacheDirectory, 'state.json')
    this.packageManager = packageManager
    this.now = now
    this.bundledResolver = bundledResolver
    this.checkTimeoutMs = checkTimeoutMs
    this.installTimeoutMs = installTimeoutMs
    this.runner = runner ?? (request => runPackageManager(subprocess, this.packageManager, request))
    this.state = readState(this.stateFile)
    this.checking = false
    this.disposal = new AbortController()
    this.tasks = new Set()
    this.upgrades = new Map()
    this.upgradeErrors = new Map()
    this.writeQueue = Promise.resolve()
    this.operationQueue = Promise.resolve()
    this.activeInstallations = new Map()
    for (const [id, profile] of this.managedEntries()) {
      const selected = this.selectedInstallation(id, profile)
      this.activeInstallations.set(id, selected)
      if (selected?.version && this.state.selectedVersions[id] === selected.version) {
        delete this.state.restartRequired[id]
      }
    }
  }

  packageName(id, profile = this.entries.get(id)) {
    if (!profile || profile.command) return undefined
    return profile.packageName || (id === 'codex' ? CODEX_ACP_PACKAGE : undefined)
  }

  managedEntries() {
    return [...this.entries].filter(([id, profile]) => this.packageName(id, profile) !== undefined)
  }

  installRoot(id) {
    const root = join(this.cacheDirectory, 'packages', id)
    if (!within(join(this.cacheDirectory, 'packages'), root)) throw new Error(`Invalid ACP provider id ${id}`)
    return root
  }

  selectedInstallation(id, profile = this.entries.get(id)) {
    const packageName = this.packageName(id, profile)
    if (!packageName) return undefined
    const managed = managedInstallationSync(this.installRoot(id), packageName, this.state.selectedVersions[id])
    if (managed) return managed
    try {
      return this.bundledResolver(packageName)
    } catch (error) {
      return { version: undefined, entry: undefined, source: 'unavailable', error: messageOf(error) }
    }
  }

  /** Add the selected managed entry point to the profiles used by the adapter. */
  runtimeEntries(entries) {
    return entries.map(([id, profile]) => {
      const installation = this.selectedInstallation(id, profile)
      return [id, installation?.entry ? { ...profile, cliEntry: installation.entry } : profile]
    })
  }

  snapshot() {
    return {
      checking: this.checking,
      lastCheckDate: this.state.lastCheckDate,
      providers: [...this.entries].map(([id, profile]) => {
        const managed = this.packageName(id, profile) !== undefined
        const active = this.activeInstallations.get(id)
        const selected = managed ? this.selectedInstallation(id, profile) : undefined
        const latestVersion = managed ? this.state.latestVersions[id] : undefined
        const baseline = selected?.version ?? active?.version
        const cliPackageName = id === 'codex' ? CODEX_CLI_PACKAGE : undefined
        const activeCli = cliPackageName ? dependencyInstallation(active, cliPackageName) : undefined
        const selectedCli = cliPackageName ? dependencyInstallation(selected, cliPackageName) : undefined
        return {
          id,
          name: profile.displayName,
          enabled: profile.enabled !== false,
          managed,
          packageName: managed ? (cliPackageName ?? this.packageName(id, profile)) : undefined,
          version: cliPackageName ? (activeCli?.version ?? selectedCli?.version) : (active?.version ?? selected?.version),
          installedVersion: cliPackageName ? selectedCli?.version : selected?.version,
          adapterPackageName: cliPackageName ? this.packageName(id, profile) : undefined,
          adapterVersion: cliPackageName ? (active?.version ?? selected?.version) : undefined,
          adapterInstalledVersion: cliPackageName ? selected?.version : undefined,
          updateKind: cliPackageName ? 'adapter' : 'cli',
          latestVersion,
          updateAvailable: Boolean(latestVersion && isNewerVersion(latestVersion, baseline)),
          checkError: managed ? this.state.checkErrors[id] : undefined,
          upgrading: this.upgrades.has(id),
          upgradeError: this.upgradeErrors.get(id),
          restartRequired: this.state.restartRequired[id] === true,
        }
      }),
    }
  }

  async persist() {
    const content = `${JSON.stringify(this.state, null, 2)}\n`
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true })
      const temporary = `${this.stateFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      await writeFile(temporary, content, 'utf8')
      await rename(temporary, this.stateFile)
    })
    return this.writeQueue
  }

  track(task) {
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task)).catch(() => {})
    return task
  }

  /** Serialize upgrades with configuration writes that would restart this fiber. */
  serialize(operation) {
    let started = false
    let onAbort
    const interrupted = new Promise((resolve, reject) => {
      onAbort = () => {
        // A queued operation must reject independently of its predecessor.
        // A running configuration edit is allowed to finish its own reload;
        // running package commands observe this same signal in their runner.
        if (!started) reject(new Error('ACP update manager is disposed'))
      }
      if (this.disposal.signal.aborted) onAbort()
      else this.disposal.signal.addEventListener('abort', onAbort, { once: true })
    })
    const queued = this.operationQueue.catch(() => {}).then(() => {
      if (this.disposal.signal.aborted) throw new Error('ACP update manager is disposed')
      started = true
      return operation()
    })
    this.operationQueue = queued
    return Promise.race([queued, interrupted]).finally(() => {
      this.disposal.signal.removeEventListener('abort', onAbort)
    })
  }

  async latestVersion(packageName) {
    await mkdir(this.cacheDirectory, { recursive: true })
    const output = await this.runner({
      args: ['view', `${packageName}@latest`, 'version', '--json'],
      cwd: this.cacheDirectory,
      signal: this.disposal.signal,
      timeoutMs: this.checkTimeoutMs,
    })
    return versionFromNpmOutput(output)
  }

  /** Check only on the first Host start of each local calendar day. */
  checkDaily() {
    if (this.disposal.signal.aborted) return Promise.resolve(this.snapshot())
    const today = localDateKey(this.now())
    // The date is persisted before lookups start, so it cannot take precedence
    // over the in-flight Promise: callers may be waiting to edit configuration.
    if (this.checkPromise) return this.checkPromise
    if (this.state.lastCheckDate === today) return Promise.resolve(this.snapshot())
    this.checking = true
    this.state.lastCheckDate = today
    for (const [id] of this.managedEntries()) delete this.state.checkErrors[id]
    this.checkPromise = this.track((async () => {
      await this.persist().catch(error => this.logger?.warn?.(`acp-bridge: could not save update state: ${messageOf(error)}`))
      await Promise.all(this.managedEntries().map(async ([id, profile]) => {
        try {
          const latest = await this.latestVersion(this.packageName(id, profile))
          const selected = this.selectedInstallation(id, profile)
          if (isNewerVersion(latest, selected?.version)) this.state.latestVersions[id] = latest
          else delete this.state.latestVersions[id]
          delete this.state.checkErrors[id]
        } catch (error) {
          if (!this.disposal.signal.aborted) {
            this.state.checkErrors[id] = messageOf(error)
            this.logger?.debug?.(`acp-bridge(${id}): update check failed: ${messageOf(error)}`)
          }
        }
      }))
      this.checking = false
      await this.persist().catch(error => this.logger?.warn?.(`acp-bridge: could not save update state: ${messageOf(error)}`))
      return this.snapshot()
    })().finally(() => {
      this.checking = false
      this.checkPromise = undefined
    }))
    return this.checkPromise
  }

  upgrade(id) {
    if (this.upgrades.has(id)) return this.upgrades.get(id)
    const operation = this.serialize(async () => {
      // A cached update can be clicked while the daily check is still running.
      // Wait for that check so the target version and the UI agree.
      await this.checkDaily()
      return this.performUpgrade(id)
    })
    const task = operation.then(
      () => {
        this.upgrades.delete(id)
        return this.snapshot()
      },
      error => {
        this.upgrades.delete(id)
        throw error
      },
    )
    this.track(task)
    this.upgrades.set(id, task)
    return task
  }

  async performUpgrade(id) {
    const profile = this.entries.get(id)
    const packageName = this.packageName(id, profile)
    if (!profile || !packageName) throw new Error(`ACP provider ${JSON.stringify(id)} does not support managed CLI upgrades`)
    const selected = this.selectedInstallation(id, profile)
    const version = this.state.latestVersions[id]
    if (!version || !isNewerVersion(version, selected?.version)) throw new Error(`ACP provider ${JSON.stringify(id)} has no newer CLI version`)
    this.upgradeErrors.delete(id)
    const providerRoot = this.installRoot(id)
    const target = join(providerRoot, version)
    if (!within(providerRoot, target)) throw new Error('Invalid target version')
    try {
      let installation = await managedInstallation(providerRoot, packageName, version)
      if (!installation) {
        await mkdir(providerRoot, { recursive: true })
        // Only this provider/version directory is removed; other running versions stay untouched.
        await rm(target, { recursive: true, force: true })
        await mkdir(target, { recursive: true })
        await this.runner({
          args: [
            'install', '--prefix', target, '--no-save', '--no-package-lock', '--ignore-scripts',
            '--no-audit', '--no-fund', `${packageName}@${version}`,
          ],
          cwd: this.cacheDirectory,
          signal: this.disposal.signal,
          timeoutMs: this.installTimeoutMs,
        })
        installation = await managedInstallation(providerRoot, packageName, version)
        if (!installation) throw new Error(`The installed ${packageName} package could not be verified`)
      }
      this.state.selectedVersions[id] = version
      this.state.restartRequired[id] = true
      delete this.state.latestVersions[id]
      delete this.state.checkErrors[id]
      await this.persist()
      return this.snapshot()
    } catch (error) {
      if (!managedInstallationSync(providerRoot, packageName, version)) await rm(target, { recursive: true, force: true }).catch(() => {})
      this.upgradeErrors.set(id, messageOf(error))
      throw error
    }
  }

  async dispose() {
    if (this.disposal.signal.aborted) return
    this.disposal.abort()
    await Promise.allSettled([...this.tasks])
    await this.writeQueue.catch(() => {})
  }
}
