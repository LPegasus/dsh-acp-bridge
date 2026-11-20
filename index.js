import { AcpAdapter } from './lib/adapter.js'
import { Config, providerEntries } from './lib/config.js'
import { AcpCliUpdates } from './lib/updates.js'

export { Config }
export { AcpAdapter } from './lib/adapter.js'
export { AcpProcess } from './lib/acp-process.js'
export { AcpCliUpdates } from './lib/updates.js'

export const name = 'acp-bridge'
export const inject = ['llm', 'subprocess']

const MANAGEMENT_PATH = '/api/acp-bridge'

function failure(code, error) {
  return {
    ok: false,
    error: {
      code,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 1200),
      details: {},
    },
  }
}

function providerRequest(payload, requireEnabled = false) {
  if (typeof payload !== 'object' || payload === null || typeof payload.id !== 'string'
    || (requireEnabled && typeof payload.enabled !== 'boolean')) {
    throw new TypeError('Expected an ACP provider id and a boolean enabled value')
  }
  return payload
}

export function createAcpManagementHandler(updates, setEnabled) {
  return async (endpoint, payload, _signal, peer) => {
    if (peer.principal.kind !== 'owner') return failure('acp/forbidden', new Error('ACP management requires the owner'))
    try {
      if (endpoint === 'state') return { ok: true, value: updates.snapshot() }
      if (endpoint === 'set-enabled') {
        const request = providerRequest(payload, true)
        return { ok: true, value: await setEnabled(request.id, request.enabled) }
      }
      // Installing executable code is deliberately a user-only UI operation;
      // no Agent tool is registered for this method.
      if (endpoint === 'upgrade') {
        const request = providerRequest(payload)
        return { ok: true, value: await updates.upgrade(request.id) }
      }
      return failure('acp/unknown-method', new Error(`Unknown ACP management method ${endpoint}`))
    } catch (error) {
      return failure(error instanceof TypeError ? 'acp/invalid-request' : 'acp/operation-failed', error)
    }
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Raw JSON Fetch adapter for Connection's authenticated exact /api route. */
export function createAcpManagementFetch(updates, setEnabled) {
  const handler = createAcpManagementHandler(updates, setEnabled)
  return async request => {
    if (request.method !== 'POST') return jsonResponse(failure('acp/method-not-allowed', new Error('POST required')), 405)
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return jsonResponse(failure('acp/invalid-request', new Error('Content-Type must be application/json')), 415)
    }
    let body
    try { body = await request.json() } catch {
      return jsonResponse(failure('acp/invalid-request', new Error('Request body is not JSON')), 400)
    }
    if (typeof body !== 'object' || body === null || typeof body.endpoint !== 'string') {
      return jsonResponse(failure('acp/invalid-request', new Error('Expected an ACP management endpoint')), 400)
    }
    // Connection exact routes admit only owner Peers before this callback.
    const result = await handler(body.endpoint, body.payload, request.signal, { principal: { kind: 'owner' } })
    return jsonResponse(result)
  }
}

export function apply(ctx, config) {
  const allEntries = providerEntries(config, true)
  const allEntryMap = new Map(allEntries)
  const updates = new AcpCliUpdates({
    entries: allEntries,
    subprocess: ctx.subprocess,
    logger: ctx.logger,
  })
  const enabledEntries = allEntries.filter(([, profile]) => profile.enabled !== false)
  const entries = updates.runtimeEntries(enabledEntries)
  const entryMap = new Map(entries)
  const workingDirectory = ctx.get('workingDirectory')
  const agents = ctx.get('agents')
  const defaultCwd = workingDirectory?.defaultDirectory || process.cwd()
  const cwdFor = (provider, sessionId) => {
    const configured = entryMap.get(provider)?.cwd
    if (configured) return configured
    const agent = sessionId ? agents?.get(sessionId) : undefined
    if (agent?.session) return workingDirectory?.get(agent.session) || agent.session.header.cwd || defaultCwd
    return defaultCwd
  }
  const adapter = new AcpAdapter({
    entries,
    subprocess: ctx.subprocess,
    logger: ctx.logger,
    defaultCwd,
    cwdFor,
  })
  // Disabled providers are absent from the LLM registry, so the chat model
  // selector cannot list or resolve their models.
  if (entries.length > 0) ctx.llm.registerAdapter(entries.map(([provider]) => provider), adapter)
  ctx.effect(() => () => adapter.dispose(), 'acp-bridge.processes')
  ctx.effect(() => () => updates.dispose(), 'acp-bridge.updates')

  const setEnabled = async (id, enabled) => updates.serialize(async () => {
    // Configuration edits restart this plugin. Let the daily check finish first,
    // and use the same queue as upgrades so a restart cannot cancel either one.
    await updates.checkDaily()
    if (!allEntryMap.has(id)) throw new Error(`Unknown ACP provider ${JSON.stringify(id)}`)
    const editor = ctx.get('configEditor')
    const entry = ctx.fiber.entry
    if (!entry || !editor) throw new Error('ACP enablement cannot be saved in this profile')
    await editor.edit(entry, current => {
      const providers = current.providers ?? config.providers
      const profile = providers[id] ?? allEntryMap.get(id)
      return {
        ...current,
        providers: {
          ...providers,
          [id]: { ...profile, enabled },
        },
      }
    })
    return { id, enabled }
  })

  // Keep the bridge usable in headless profiles. The authenticated management
  // route mounts only where the Web Host and configuration editor can exist.
  ctx.inject(['connection', 'webServer'], managementCtx => {
    managementCtx.connection.fetch.register({
      path: MANAGEMENT_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createAcpManagementFetch(updates, setEnabled),
    })
  })

  // The date is persisted before the first lookup. A restart later that day
  // does not check again, including after a failed lookup.
  void updates.checkDaily().catch(error => {
    ctx.logger?.debug?.(`acp-bridge: daily update check failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}
