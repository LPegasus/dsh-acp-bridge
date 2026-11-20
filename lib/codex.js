// Scoped to the codex-acp process launched by this plugin. This does not edit
// the user's global Codex config and can be overridden through provider.env.
export const CODEX_PROVIDER_ID = 'dsh_http'
export const CODEX_ACP_PACKAGE = '@agentclientprotocol/codex-acp'
export const CODEX_CLI_PACKAGE = '@openai/codex'

export const CODEX_HTTP_CONFIG = JSON.stringify({
  model_provider: CODEX_PROVIDER_ID,
  model_providers: {
    [CODEX_PROVIDER_ID]: {
      name: 'OpenAI HTTP',
      base_url: 'https://chatgpt.com/backend-api/codex',
      wire_api: 'responses',
      requires_openai_auth: true,
      supports_websockets: false,
      supports_standalone_web_search: true,
    },
  },
})

export const CODEX_DEFAULT_ENV = Object.freeze({
  NO_BROWSER: '1',
  INITIAL_AGENT_MODE: 'read-only',
  MODEL_PROVIDER: CODEX_PROVIDER_ID,
  CODEX_CONFIG: CODEX_HTTP_CONFIG,
})
