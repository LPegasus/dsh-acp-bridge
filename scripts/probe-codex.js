import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { AcpAdapter } from '../lib/adapter.js'
import { CODEX_DEFAULT_ENV } from '../lib/codex.js'

const subprocess = {
  async resolveExecutable(command) { return command },
  spawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const done = new Promise((resolveDone, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, signal) => resolveDone({ exitCode, signal }))
    })
    const abort = () => child.kill()
    spec.signal?.addEventListener('abort', abort, { once: true })
    void done.finally(() => spec.signal?.removeEventListener('abort', abort)).catch(() => {})
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate() { child.kill() },
      async waitForExit() { await done; return true },
    }
  },
}

const adapter = new AcpAdapter({
  entries: [['codex', {
    displayName: 'Codex (ACP)',
    command: '',
    args: [],
    env: { ...CODEX_DEFAULT_ENV },
    cwd: '',
    permission: 'reject',
    allowImplicitModel: false,
    startupTimeoutMs: Number(process.env.ACP_PROBE_STARTUP_MS || 90_000),
    modelCacheMs: 60_000,
    models: [],
  }]],
  subprocess,
  logger: { debug: message => console.error(message) },
  defaultCwd: resolve('.'),
  cwdFor: () => resolve('.'),
})

const timeout = setTimeout(() => {
  console.error('Codex probe timed out')
  process.exitCode = 2
  void adapter.dispose().then(() => process.exit())
}, 120_000)

try {
  const models = await adapter.listModels('codex')
  console.log(`MODELS ${JSON.stringify(models)}`)
  if (models.length === 0) throw new Error('Codex advertised no models')
  if (process.env.ACP_PROBE_MODELS_ONLY === '1') {
    console.log('MODELS_ONLY_OK')
    clearTimeout(timeout)
    await adapter.dispose()
    process.exit(0)
  }
  const model = process.env.ACP_PROBE_MODEL || models[0].id
  const resolved = await adapter.resolveModel('codex', model)
  console.log(`RESOLVED ${JSON.stringify(resolved)}`)
  let text = ''
  let reasoning = ''
  for await (const chunk of adapter.stream({
    provider: 'codex',
    model,
    system: 'You are running a minimal connectivity probe.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly ACP_BRIDGE_OK and nothing else.' }] }],
  })) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
      process.stdout.write(chunk.text)
    } else if (chunk.type === 'reasoning-delta') {
      reasoning += chunk.text
    } else if (chunk.type === 'finish') {
      console.log(`\nFINISH ${JSON.stringify(chunk.reason)}`)
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') process.exitCode = 1
    }
  }
  console.log(`TEXT ${JSON.stringify(text)}`)
  console.log(`REASONING_CHARS ${reasoning.length}`)
} finally {
  clearTimeout(timeout)
  await adapter.dispose()
}
