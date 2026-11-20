import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcpManagementFetch, createAcpManagementHandler } from '../index.js'

const owner = { principal: { kind: 'owner' } }
const other = { principal: { kind: 'api' } }

function fixture() {
  const calls = []
  const updates = {
    snapshot: () => ({ checking: false, providers: [{ id: 'codex', enabled: true }] }),
    async upgrade(id) { calls.push(['upgrade', id]); return { upgraded: id } },
  }
  const setEnabled = async (id, enabled) => { calls.push(['set-enabled', id, enabled]); return { id, enabled } }
  return { calls, handler: createAcpManagementHandler(updates, setEnabled) }
}

test('management /api Fetch adapter accepts JSON POST and returns operation results', async () => {
  const { calls, handler } = fixture()
  const fetch = createAcpManagementFetch({ snapshot: () => ({ checking: false, providers: [] }) }, async (id, enabled) => {
    calls.push(['set-enabled', id, enabled])
    return { id, enabled }
  })
  const state = await fetch(new Request('http://localhost/api/acp-bridge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'state', payload: {} }),
  }))
  assert.equal(state.status, 200)
  assert.match(state.headers.get('content-type'), /application\/json/)
  assert.deepEqual((await state.json()).value.providers, [])

  const changed = await fetch(new Request('http://localhost/api/acp-bridge', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ endpoint: 'set-enabled', payload: { id: 'codex', enabled: false } }),
  }))
  assert.deepEqual(await changed.json(), { ok: true, value: { id: 'codex', enabled: false } })
  assert.deepEqual(calls, [['set-enabled', 'codex', false]])
  assert.equal(typeof handler, 'function')
})

test('management /api Fetch adapter rejects malformed transport requests', async () => {
  const fetch = createAcpManagementFetch({ snapshot: () => ({}) }, async () => {})
  const wrongMethod = await fetch(new Request('http://localhost/api/acp-bridge'))
  assert.equal(wrongMethod.status, 405)
  const wrongType = await fetch(new Request('http://localhost/api/acp-bridge', { method: 'POST', body: '{}' }))
  assert.equal(wrongType.status, 415)
  const malformed = await fetch(new Request('http://localhost/api/acp-bridge', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  }))
  assert.equal(malformed.status, 400)
  const missingEndpoint = await fetch(new Request('http://localhost/api/acp-bridge', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }))
  assert.equal(missingEndpoint.status, 400)
  assert.equal((await missingEndpoint.json()).error.code, 'acp/invalid-request')
})

test('management RPC reads state and applies enablement for the owner', async () => {
  const { calls, handler } = fixture()
  const state = await handler('state', {}, undefined, owner)
  assert.equal(state.ok, true)
  assert.equal(state.value.providers[0].id, 'codex')
  const changed = await handler('set-enabled', { id: 'codex', enabled: false }, undefined, owner)
  assert.deepEqual(changed, { ok: true, value: { id: 'codex', enabled: false } })
  assert.deepEqual(calls, [['set-enabled', 'codex', false]])
})

test('management RPC runs the shared upgrade operation and validates input', async () => {
  const { calls, handler } = fixture()
  const upgraded = await handler('upgrade', { id: 'codex' }, undefined, owner)
  assert.deepEqual(upgraded, { ok: true, value: { upgraded: 'codex' } })
  assert.deepEqual(calls, [['upgrade', 'codex']])
  const invalid = await handler('set-enabled', { id: 'codex', enabled: 'no' }, undefined, owner)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'acp/invalid-request')
  const unknown = await handler('unknown', {}, undefined, owner)
  assert.equal(unknown.error.code, 'acp/unknown-method')
})

test('management RPC refuses non-owner peers before any operation', async () => {
  const { calls, handler } = fixture()
  for (const endpoint of ['state', 'set-enabled', 'upgrade']) {
    const result = await handler(endpoint, { id: 'codex', enabled: false }, undefined, other)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'acp/forbidden')
  }
  assert.deepEqual(calls, [])
})
