import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export const fakeAgentPath = resolve('test/fake-acp-agent.js')

export const nodeSubprocess = {
  async resolveExecutable(command) {
    return command
  },
  spawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let exit
    const done = new Promise((resolveDone, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, signal) => {
        exit = { exitCode, signal }
        resolveDone(exit)
      })
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

export function fakeProfile(overrides = {}) {
  return {
    displayName: 'Fake ACP',
    command: process.execPath,
    args: [fakeAgentPath],
    env: {},
    cwd: '',
    permission: 'reject',
    allowImplicitModel: false,
    startupTimeoutMs: 5000,
    modelCacheMs: 60_000,
    models: [],
    ...overrides,
  }
}

export async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
