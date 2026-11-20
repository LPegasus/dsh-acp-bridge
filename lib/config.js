import Schema from '@deepseek-ai/schemastery'
import { CODEX_ACP_PACKAGE, CODEX_DEFAULT_ENV } from './codex.js'

const ModelSchema = Schema.object({
  id: Schema.string().required(),
  name: Schema.string(),
  description: Schema.string(),
  contextWindow: Schema.natural().min(1),
  maxTokens: Schema.natural().min(1),
  reasoningEfforts: Schema.array(Schema.string()).default([]),
})

const ProviderSchema = Schema.object({
  displayName: Schema.string(),
  enabled: Schema.boolean().default(true),
  // Empty command + packageName selects a version-managed ACP CLI package.
  // A non-empty command remains an external CLI and is listed without managed upgrades.
  packageName: Schema.string().default(''),
  command: Schema.string().default(''),
  args: Schema.array(Schema.string()).default([]),
  env: Schema.dict(Schema.string()).default({}),
  cwd: Schema.string().default(''),
  permission: Schema.union([Schema.const('reject'), Schema.const('allow')]).default('reject'),
  allowImplicitModel: Schema.boolean().default(false),
  startupTimeoutMs: Schema.natural().min(1000).default(90_000),
  modelCacheMs: Schema.natural().min(0).default(60_000),
  models: Schema.array(ModelSchema).default([]),
})

const CURSOR_DEFAULT_PROVIDER = Object.freeze({
  displayName: 'Cursor Agent (ACP)',
  enabled: false,
  command: 'agent',
  args: Object.freeze(['acp']),
})

function withBuiltInProviders(providers) {
  // Existing profiles keep their custom provider map, but still discover newly
  // supported Cursor Agent as a disabled row. Codex retains its historical
  // replacement semantics for fully custom provider maps.
  if (Object.hasOwn(providers, 'cursor')) return providers
  return {
    ...providers,
    cursor: ProviderSchema({ ...CURSOR_DEFAULT_PROVIDER, args: [...CURSOR_DEFAULT_PROVIDER.args] }),
  }
}

export const Config = Schema.object({
  providers: Schema.dict(ProviderSchema).default({
    codex: {
      displayName: 'Codex (ACP)',
      packageName: CODEX_ACP_PACKAGE,
      env: { ...CODEX_DEFAULT_ENV },
    },
    cursor: { ...CURSOR_DEFAULT_PROVIDER, args: [...CURSOR_DEFAULT_PROVIDER.args] },
  }),
})

export const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function providerEntries(config, includeDisabled = false) {
  const entries = Object.entries(withBuiltInProviders(config.providers))
  if (entries.length === 0) throw new Error('acp-bridge: configure at least one provider')
  const seen = new Set()
  const resolved = entries.map(([id, profile]) => {
    if (!PROVIDER_PATTERN.test(id)) {
      throw new Error(`acp-bridge: invalid provider id ${JSON.stringify(id)}; use lowercase letters, digits, dot, underscore, or dash`)
    }
    if (seen.has(id)) throw new Error(`acp-bridge: duplicate provider id ${JSON.stringify(id)}`)
    seen.add(id)
    const models = profile.models.map(model => ({
      ...model,
      name: model.name ?? model.id,
    }))
    const modelIds = new Set()
    for (const model of models) {
      if (model.id.length === 0) throw new Error(`acp-bridge(${id}): model ids must not be empty`)
      if (modelIds.has(model.id)) throw new Error(`acp-bridge(${id}): duplicate model id ${JSON.stringify(model.id)}`)
      modelIds.add(model.id)
      if (new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length) {
        throw new Error(`acp-bridge(${id}/${model.id}): duplicate reasoning effort`)
      }
    }
    return [id, {
      ...profile,
      displayName: profile.displayName || (id === 'codex' ? 'Codex (ACP)' : `${id} (ACP)`),
      models,
    }]
  })
  return includeDisabled ? resolved : resolved.filter(([, profile]) => profile.enabled !== false)
}
