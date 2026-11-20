import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { AcpAdapter } from '../lib/adapter.js'
import { collect, fakeProfile, nodeSubprocess } from './helpers.js'

function adapterFor(profile = fakeProfile()) {
  return new AcpAdapter({
    entries: [['fake', profile]],
    subprocess: nodeSubprocess,
    logger: { debug() {} },
    defaultCwd: resolve('.'),
    cwdFor: () => resolve('.'),
  })
}

test('discovers models, selects model and effort, and streams text and reasoning', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'))
  const logPath = join(directory, 'wire.jsonl')
  const adapter = adapterFor(fakeProfile({ env: { FAKE_ACP_LOG: logPath } }))
  t.after(async () => {
    await adapter.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  const models = await adapter.listModels('fake')
  assert.deepEqual(models.map(model => model.id), ['gpt-fake-a', 'gpt-fake-b'])
  const resolved = await adapter.resolveModel('fake', 'gpt-fake-b')
  assert.deepEqual(resolved.reasoning.efforts.map(effort => effort.id), ['low', 'high'])

  const chunks = await collect(adapter.stream({
    provider: 'fake',
    model: 'gpt-fake-b',
    reasoningEffort: 'high',
    system: 'test system',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  }))
  assert.equal(chunks.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text).join(''), 'thinking')
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'answer from gpt-fake-b/high')
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(chunks.filter(chunk => chunk.type === 'block-end').length, 2)

  const wire = (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse)
  const newSession = wire.find(entry => entry.value.method === 'session/new' && entry.value.params.systemPrompt).value
  assert.equal(newSession.params.systemPrompt.mode, 'append')
  assert.equal(newSession.params.systemPrompt.content[0].text, 'test system')
  const prompt = wire.find(entry => entry.value.method === 'session/prompt').value
  assert.match(prompt.params.prompt[0].text, /<message role="user">/)
  assert.doesNotMatch(prompt.params.prompt[0].text, /test system/)
  assert.ok(wire.some(entry => entry.value.method === 'session/set_config_option' && entry.value.params.configId === 'model' && entry.value.params.value === 'gpt-fake-b'))
  assert.ok(wire.some(entry => entry.value.method === 'session/set_config_option' && entry.value.params.configId === 'reasoning_effort' && entry.value.params.value === 'high'))
})

test('rejects external permission requests by default', async t => {
  const adapter = adapterFor()
  t.after(() => adapter.dispose())
  const chunks = await collect(adapter.stream({
    provider: 'fake',
    model: 'gpt-fake-a',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'REQUEST_PERMISSION' }] }],
  }))
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'permission reject')
})

test('cancels an in-flight prompt and closes its ACP session', async t => {
  const adapter = adapterFor()
  t.after(() => adapter.dispose())
  const controller = new AbortController()
  const chunks = []
  const consuming = (async () => {
    for await (const chunk of adapter.stream({
      provider: 'fake',
      model: 'gpt-fake-a',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'WAIT_FOR_CANCEL' }] }],
      signal: controller.signal,
    })) chunks.push(chunk)
  })()
  setTimeout(() => controller.abort(), 100)
  await consuming
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'aborted')
  assert.equal(chunks.at(-1).reason.failure.code, 'ABORTED')
})

test('serves statically configured models without online discovery', async t => {
  const adapter = adapterFor(fakeProfile({
    command: 'not-needed-for-static-catalog',
    models: [{ id: 'static-gpt', name: 'Static GPT', contextWindow: 12345, maxTokens: 678, reasoningEfforts: ['low', 'high'] }],
  }))
  t.after(() => adapter.dispose())
  const models = await adapter.listModels('fake')
  assert.deepEqual(models.map(model => model.id), ['static-gpt'])
  const resolved = await adapter.resolveModel('fake', 'static-gpt')
  assert.equal(resolved.context.contextWindow, 12345)
  assert.equal(resolved.defaultMaxTokens, 678)
  assert.deepEqual(resolved.reasoning.efforts.map(effort => effort.id), ['low', 'high'])
})

test('retries with a fresh process after an executable startup failure', async t => {
  const profile = fakeProfile({ command: 'definitely-not-an-acp-executable' })
  const adapter = adapterFor(profile)
  t.after(() => adapter.dispose())
  await assert.rejects(adapter.listModels('fake'), /startup failed|not found|missing|ACP/i)
  profile.command = process.execPath
  const models = await adapter.listModels('fake')
  assert.deepEqual(models.map(model => model.id), ['gpt-fake-a', 'gpt-fake-b'])
})

test('refuses an unknown model before prompting', async t => {
  const adapter = adapterFor()
  t.after(() => adapter.dispose())
  await assert.rejects(adapter.resolveModel('fake', 'not-a-model'), error => error.code === 'MODEL_UNSUPPORTED')
})
