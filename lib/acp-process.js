import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const CODEX_ENTRY = createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp')
const CODEX_ENV = ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME', 'CODEX_PATH', 'MODEL_PROVIDER']
const CURSOR_ENV = ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN']

export function inheritedEnvironmentFor(provider, source = process.env) {
  // Never leak one vendor's credentials into another vendor's ACP process.
  // Legacy Codex names retain their existing behavior for custom providers.
  const names = provider === 'cursor' ? CURSOR_ENV : CODEX_ENV
  const env = {}
  for (const name of names) {
    if (source[name] !== undefined) env[name] = source[name]
  }
  return env
}

function requestOptions(signal, stopWaitingOnCancel = true) {
  return signal ? { cancellationSignal: signal, stopWaitingOnCancel } : { stopWaitingOnCancel }
}

function startupSignal(external, timeoutMs, disposal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signals = [external, timeout, disposal].filter(Boolean)
  return {
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    timedOut: () => timeout.aborted && !external?.aborted && !disposal?.aborted,
  }
}

export function permissionOutcome(params, permission) {
  const options = params.options ?? []
  // Cursor currently advertises hyphenated kinds; other ACP agents use underscores.
  const kinds = permission === 'allow'
    ? ['allow_once', 'allow-once', 'allow_always', 'allow-always']
    : ['reject_once', 'reject-once', 'reject_always', 'reject-always']
  for (const kind of kinds) {
    const option = options.find(candidate => candidate.kind === kind)
    if (option) return { outcome: { outcome: 'selected', optionId: option.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

export class AcpProcess {
  constructor({ provider, profile, subprocess, logger, defaultCwd }) {
    this.provider = provider
    this.profile = profile
    this.subprocess = subprocess
    this.logger = logger
    this.defaultCwd = defaultCwd
    this.readyPromise = undefined
    this.live = undefined
    this.closed = false
    this.disposeController = new AbortController()
  }

  async ready(signal) {
    if (this.closed) throw new Error(`${this.provider}: ACP bridge is disposed`)
    if (this.readyPromise) return this.readyPromise
    const generation = Symbol('acp-generation')
    const promise = this.open(signal, generation).catch(async error => {
      const live = this.live
      if (this.readyPromise === promise) this.readyPromise = undefined
      if (live?.generation === generation) {
        this.live = undefined
        await this.stopLive(live)
      }
      throw error
    })
    this.readyPromise = promise
    return promise
  }

  async open(externalSignal, generation) {
    const startup = startupSignal(externalSignal, this.profile.startupTimeoutMs, this.disposeController.signal)
    if (!this.profile.command && this.profile.packageName && !this.profile.cliEntry) {
      throw new Error(`${this.provider}: managed ACP CLI ${this.profile.packageName} is not installed`)
    }
    const executable = this.profile.command
      ? await this.subprocess.resolveExecutable(this.profile.command, this.profile.env, startup.signal)
      : process.execPath
    const args = this.profile.command
      ? [...this.profile.args]
      : [this.profile.cliEntry || CODEX_ENTRY, ...this.profile.args]
    const cwd = resolve(this.profile.cwd || this.defaultCwd)
    const env = inheritedEnvironmentFor(this.provider)
    Object.assign(env, this.profile.env)
    if (!this.profile.command) env.ELECTRON_RUN_AS_NODE = '1'

    const lifetime = new AbortController()
    const handle = this.subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3000,
      signal: lifetime.signal,
    })
    const live = { handle, connection: undefined, generation, lifetime }
    this.live = live
    if (!handle.stdin || !handle.stdout) throw new Error(`${this.provider}: ACP subprocess did not expose stdio pipes`)
    // Drain diagnostics without copying potentially sensitive agent output into model-visible errors.
    handle.stderr?.on('data', () => {})
    handle.stdin.on('error', () => {})
    handle.stdout.on('error', () => {})
    handle.stderr?.on('error', () => {})

    const stream = ndJsonStream(
      Writable.toWeb(handle.stdin),
      Readable.toWeb(handle.stdout),
    )
    const connection = client({ name: `dsh-acp-bridge:${this.provider}` })
      .onRequest(methods.client.session.requestPermission, ({ params }) => permissionOutcome(params, this.profile.permission))
      .connect(stream)
    live.connection = connection
    void handle.done.then(outcome => {
      this.logger?.debug?.(`acp-bridge(${this.provider}): agent exited with code ${outcome.exitCode}`)
    }, () => {})
    void connection.closed.then(() => {
      if (this.live === live) {
        this.live = undefined
        this.readyPromise = undefined
      }
    })

    try {
      const initialize = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'dsh-acp-bridge', version: '0.3.1' },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          session: { configOptions: { boolean: {} } },
        },
      }, requestOptions(startup.signal))
      this.logger?.debug?.(`acp-bridge(${this.provider}): connected to ${initialize.agentInfo?.name || 'ACP agent'} ${initialize.agentInfo?.version || ''}`)
      return { connection, initialize, handle }
    } catch (error) {
      if (startup.timedOut()) throw new Error(`${this.provider}: ACP startup timed out after ${this.profile.startupTimeoutMs} ms`, { cause: error })
      throw new Error(`${this.provider}: ACP startup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  async openSession({ cwd, system, signal } = {}) {
    const { connection, initialize } = await this.ready(signal)
    const startup = startupSignal(signal, this.profile.startupTimeoutMs, this.disposeController.signal)
    const supportsSystem = Boolean(system) && Boolean(initialize.agentCapabilities?.sessionCapabilities?.systemPrompt)
    const request = {
      cwd: resolve(cwd || this.profile.cwd || this.defaultCwd),
      mcpServers: [],
      ...supportsSystem ? {
        systemPrompt: { mode: 'append', content: [{ type: 'text', text: system }] },
      } : {},
    }
    let session
    try {
      session = await connection.agent.buildSession(request).start(requestOptions(startup.signal))
    } catch (error) {
      const live = this.live
      this.live = undefined
      this.readyPromise = undefined
      if (live) await this.stopLive(live)
      if (startup.timedOut()) throw new Error(`${this.provider}: ACP session creation timed out after ${this.profile.startupTimeoutMs} ms`, { cause: error })
      throw new Error(`${this.provider}: ACP session creation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    let closed = false
    return {
      session,
      sessionResponse: session.newSessionResponse,
      agent: connection.agent,
      initialize,
      nativeSystemPrompt: supportsSystem,
      close: async () => {
        if (closed) return
        closed = true
        session.dispose()
        if (!initialize.agentCapabilities?.sessionCapabilities?.close) return
        try {
          await connection.agent.request(methods.agent.session.close, { sessionId: session.sessionId }, requestOptions(AbortSignal.timeout(5000)))
        } catch (error) {
          this.logger?.debug?.(`acp-bridge(${this.provider}): session close failed: ${String(error)}`)
        }
      },
    }
  }

  async stopLive(live) {
    try { live.connection?.close() } catch {}
    try { live.handle.stdin?.end() } catch {}
    const exited = await Promise.race([
      live.handle.done.then(() => true, () => true),
      delay(1500).then(() => false),
    ])
    if (!exited) live.lifetime.abort()
    if (!exited) live.handle.terminate()
    await Promise.allSettled([live.handle.done, live.handle.waitForExit()])
  }

  async dispose() {
    if (this.closed) return
    this.closed = true
    this.disposeController.abort()
    const live = this.live
    this.live = undefined
    this.readyPromise = undefined
    if (live) await this.stopLive(live)
  }
}
