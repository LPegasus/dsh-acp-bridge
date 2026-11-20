import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogFromSession, flattenSelectOptions, reasoningFromConfig } from '../lib/catalog.js'
import { inheritedEnvironmentFor, permissionOutcome } from '../lib/acp-process.js'
import { Config, providerEntries } from '../lib/config.js'
import { acpPromptFor } from '../lib/projection.js'
import { AcpChunkProjector } from '../lib/stream.js'

test('default config enables read-only Codex and lists Cursor Agent disabled', () => {
  const config = Config({})
  const entries = providerEntries(config)
  assert.equal(entries.length, 1)
  const [id, profile] = entries[0]
  assert.equal(id, 'codex')
  assert.equal(profile.permission, 'reject')
  assert.equal(profile.env.INITIAL_AGENT_MODE, 'read-only')
  assert.equal(profile.env.MODEL_PROVIDER, 'dsh_http')
  const codexConfig = JSON.parse(profile.env.CODEX_CONFIG)
  assert.equal(codexConfig.model_provider, 'dsh_http')
  assert.equal(codexConfig.model_providers.dsh_http.supports_websockets, false)
  assert.equal(codexConfig.model_providers.dsh_http.wire_api, 'responses')
  assert.equal(profile.command, '')
  assert.equal(profile.enabled, true)
  assert.equal(profile.packageName, '@agentclientprotocol/codex-acp')
  const cursor = providerEntries(config, true).find(([id]) => id === 'cursor')?.[1]
  assert.equal(cursor.displayName, 'Cursor Agent (ACP)')
  assert.equal(cursor.enabled, false)
  assert.equal(cursor.command, 'agent')
  assert.deepEqual(cursor.args, ['acp'])
  assert.equal(cursor.permission, 'reject')
})

test('supports Cursor hyphenated permission option kinds', () => {
  assert.deepEqual(permissionOutcome({ options: [
    { optionId: 'cursor-allow', kind: 'allow-once' },
    { optionId: 'cursor-reject', kind: 'reject-once' },
  ] }, 'allow'), { outcome: { outcome: 'selected', optionId: 'cursor-allow' } })
  assert.deepEqual(permissionOutcome({ options: [
    { optionId: 'cursor-reject', kind: 'reject-once' },
  ] }, 'reject'), { outcome: { outcome: 'selected', optionId: 'cursor-reject' } })
  assert.deepEqual(permissionOutcome({ options: [
    { optionId: 'legacy-reject', kind: 'reject_once' },
  ] }, 'reject'), { outcome: { outcome: 'selected', optionId: 'legacy-reject' } })
})

test('disabled providers stay configurable but are not registered for model selection', () => {
  const config = Config({
    providers: {
      on: { command: '/bin/on', models: [] },
      off: { command: '/bin/off', enabled: false, models: [] },
    },
  })
  assert.deepEqual(providerEntries(config).map(([id]) => id), ['on'])
  assert.deepEqual(providerEntries(config, true).map(([id]) => id), ['on', 'off', 'cursor'])
  const allOff = Config({ providers: { off: { command: '/bin/off', enabled: false } } })
  assert.deepEqual(providerEntries(allOff), [])
  assert.deepEqual(providerEntries(allOff, true).map(([id]) => id), ['off', 'cursor'])
})

test('adds disabled Cursor to existing provider maps without restoring removed Codex', () => {
  const codexOnly = Config({ providers: { codex: { enabled: false } } })
  assert.deepEqual(providerEntries(codexOnly, true).map(([id]) => id), ['codex', 'cursor'])
  assert.deepEqual(providerEntries(codexOnly), [])

  const customOnly = Config({ providers: { another: { command: '/bin/another', enabled: true } } })
  assert.deepEqual(providerEntries(customOnly, true).map(([id]) => id), ['another', 'cursor'])
  assert.deepEqual(providerEntries(customOnly).map(([id]) => id), ['another'])
  assert.equal(providerEntries(customOnly, true).some(([id]) => id === 'codex'), false)
})

test('keeps Cursor credentials out of Codex and custom ACP processes', () => {
  const source = {
    CODEX_API_KEY: 'codex-secret',
    OPENAI_API_KEY: 'openai-secret',
    CURSOR_API_KEY: 'cursor-secret',
    CURSOR_AUTH_TOKEN: 'cursor-token',
  }
  assert.deepEqual(inheritedEnvironmentFor('cursor', source), {
    CURSOR_API_KEY: 'cursor-secret', CURSOR_AUTH_TOKEN: 'cursor-token',
  })
  assert.equal(inheritedEnvironmentFor('codex', source).CURSOR_API_KEY, undefined)
  assert.equal(inheritedEnvironmentFor('codex', source).CURSOR_AUTH_TOKEN, undefined)
  assert.equal(inheritedEnvironmentFor('another', source).CURSOR_API_KEY, undefined)
  assert.equal(inheritedEnvironmentFor('codex', source).CODEX_API_KEY, 'codex-secret')
})

test('parses grouped model options and legacy model state', () => {
  const grouped = catalogFromSession({ configOptions: [{
    id: 'model', type: 'select', currentValue: 'b',
    options: [{ group: 'gpt', name: 'GPT', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }],
  }] })
  assert.deepEqual(grouped.models.map(model => model.id), ['a', 'b'])
  assert.equal(grouped.currentModel, 'b')

  const legacy = catalogFromSession({ models: {
    currentModelId: 'old-a',
    availableModels: [{ modelId: 'old-a', name: 'Old A' }],
  } })
  assert.equal(legacy.legacyModels, true)
  assert.deepEqual(legacy.models, [{ id: 'old-a', name: 'Old A' }])
})

test('parses reasoning options and flattens select groups', () => {
  const options = [{ group: 'levels', options: [{ value: 'low' }, { value: 'high' }] }]
  assert.deepEqual(flattenSelectOptions(options).map(option => option.value), ['low', 'high'])
  const reasoning = reasoningFromConfig([{ id: 'reasoning_effort', type: 'select', currentValue: 'high', options }])
  assert.equal(reasoning.defaultEffort, 'high')
  assert.deepEqual(reasoning.efforts.map(effort => effort.id), ['low', 'high'])
})

test('projects system prompts natively or into the fallback transcript', () => {
  const options = {
    system: 'base system',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'history system' }] },
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'next' }] },
    ],
  }
  assert.equal(acpPromptFor(options, true).system, 'base system\n\nhistory system')
  assert.doesNotMatch(acpPromptFor(options, true).prompt, /base system/)
  assert.match(acpPromptFor(options, false).prompt, /<message role="system">/)
  assert.match(acpPromptFor(options, false).prompt, /<message role="user">/)
})

test('closes and reopens stream blocks when ACP content kind changes', () => {
  const projector = new AcpChunkProjector('fake')
  const chunks = [
    ...projector.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'think' } }),
    ...projector.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } }),
    ...projector.finish('end_turn'),
  ]
  assert.deepEqual(chunks.map(chunk => chunk.type), [
    'block-start', 'reasoning-delta', 'block-end', 'block-start', 'text-delta', 'block-end', 'finish',
  ])
  assert.equal(chunks[2].block.text, 'think')
  assert.equal(chunks[5].block.text, 'answer')
})
