import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { AcpProcess } from './acp-process.js'
import {
  catalogFromSession,
  configureSession,
  mergeConfiguredCatalog,
  reasoningFromConfig,
} from './catalog.js'
import { acpPromptFor } from './projection.js'
import { AcpChunkProjector } from './stream.js'

function modelInfo(provider, base, configured, configOptions) {
  const reasoning = reasoningFromConfig(configOptions)
  const configuredEfforts = configured?.reasoningEfforts ?? []
  const efforts = configuredEfforts.length > 0
    ? configuredEfforts.map(id => ({ id, name: id }))
    : reasoning.efforts
  const defaultEffort = efforts.some(effort => effort.id === reasoning.defaultEffort)
    ? reasoning.defaultEffort
    : undefined
  return {
    provider,
    id: base.id,
    name: configured?.name || base.name || base.id,
    ...configured?.description || base.description ? { description: configured?.description || base.description } : {},
    inputModalities: ['text'],
    ...configured?.contextWindow ? { context: { contextWindow: configured.contextWindow } } : {},
    ...configured?.maxTokens ? { defaultMaxTokens: configured.maxTokens } : {},
    ...efforts.length > 0 ? {
      reasoning: {
        efforts,
        ...defaultEffort ? { defaultEffort } : {},
      },
    } : {},
  }
}

export class AcpAdapter extends LlmAdapter {
  constructor({ entries, subprocess, logger, defaultCwd, cwdFor }) {
    super()
    this.logger = logger
    this.cwdFor = cwdFor
    this.states = new Map()
    for (const [provider, profile] of entries) {
      this.states.set(provider, {
        provider,
        profile,
        process: new AcpProcess({ provider, profile, subprocess, logger, defaultCwd }),
        catalog: undefined,
        catalogAt: 0,
        catalogPromise: undefined,
        details: new Map(),
      })
    }
  }

  state(provider) {
    const state = this.states.get(provider)
    if (!state) throw new Error(`acp-bridge: unknown provider ${JSON.stringify(provider)}`)
    return state
  }

  providerInfo(provider) {
    const state = this.state(provider)
    return { id: provider, name: state.profile.displayName }
  }

  providerRetryPolicy() {
    return {
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: ['TRANSPORT'],
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      jitterRatio: 0.1,
    }
  }

  async discover(state) {
    let opened
    try {
      opened = await state.process.openSession({ cwd: state.profile.cwd || undefined })
      const discovered = catalogFromSession(opened.sessionResponse)
      const catalog = mergeConfiguredCatalog(discovered, state.profile.models)
      if (discovered.currentModel) {
        state.details.set(discovered.currentModel, {
          at: Date.now(),
          configOptions: opened.sessionResponse.configOptions ?? [],
        })
      }
      return catalog
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
      throw new Error(
        `${state.provider}: ACP model discovery failed: ${detail}. Check the command, external sign-in and network,`
        + ` increase startupTimeoutMs, or configure providers.${state.provider}.models explicitly.`,
        { cause: error },
      )
    } finally {
      if (opened) await opened.close()
    }
  }

  async catalog(state) {
    if (state.profile.models.length > 0) {
      return { models: state.profile.models, currentModel: undefined, configOptions: [] }
    }
    const now = Date.now()
    if (state.catalog && (state.profile.modelCacheMs > 0 && now - state.catalogAt < state.profile.modelCacheMs)) {
      return state.catalog
    }
    if (state.catalogPromise) return state.catalogPromise
    state.catalogPromise = this.discover(state).then(catalog => {
      state.catalog = catalog
      state.catalogAt = Date.now()
      return catalog
    }).finally(() => {
      state.catalogPromise = undefined
    })
    return state.catalogPromise
  }

  async listModels(provider) {
    const state = this.state(provider)
    const catalog = await this.catalog(state)
    return catalog.models.map(model => {
      const configured = state.profile.models.find(entry => entry.id === model.id)
      const { context, defaultMaxTokens, reasoning, ...info } = modelInfo(provider, model, configured, [])
      return info
    })
  }

  async resolveModel(provider, model, signal) {
    const state = this.state(provider)
    const catalog = await this.catalog(state)
    const base = catalog.models.find(entry => entry.id === model)
    if (!base) throw new LlmError(`acp-bridge(${provider}): model ${JSON.stringify(model)} is not in the ACP catalog`, 'MODEL_UNSUPPORTED')
    const configured = state.profile.models.find(entry => entry.id === model)
    if (configured) return modelInfo(provider, base, configured, [])

    const cached = state.details.get(model)
    if (cached && (state.profile.modelCacheMs > 0 && Date.now() - cached.at < state.profile.modelCacheMs)) {
      return modelInfo(provider, base, configured, cached.configOptions)
    }

    const opened = await state.process.openSession({ cwd: state.profile.cwd || undefined, signal })
    try {
      const configuredSession = await configureSession(
        opened.agent,
        opened.session,
        opened.sessionResponse,
        model,
        undefined,
        { cancellationSignal: signal, stopWaitingOnCancel: true },
      )
      const configOptions = configuredSession.configOptions
      state.details.set(model, { at: Date.now(), configOptions })
      return modelInfo(provider, base, configured, configOptions)
    } catch (error) {
      if (/reasoning effort/i.test(error instanceof Error ? error.message : '')) {
        throw new LlmError(`acp-bridge(${provider}/${model}): ${error.message}`, 'UNSUPPORTED_REASONING_EFFORT', { cause: error })
      }
      throw new LlmError(`acp-bridge(${provider}/${model}): ${error instanceof Error ? error.message : String(error)}`, 'MODEL_UNSUPPORTED', { cause: error })
    } finally {
      await opened.close()
    }
  }

  async *stream(options) {
    const state = this.state(options.provider)
    const projector = new AcpChunkProjector(options.provider)
    let opened
    let cancel
    try {
      const cwd = this.cwdFor?.(options.provider, options.sessionId) || state.profile.cwd || undefined
      // Open once without system first only when a native system prompt would be useful.
      // ACP advertises this capability during initialize, so openSession decides the wire form.
      const initialProjection = acpPromptFor(options, true)
      opened = await state.process.openSession({ cwd, system: initialProjection.system, signal: options.signal })
      await configureSession(
        opened.agent,
        opened.session,
        opened.sessionResponse,
        options.model,
        options.reasoningEffort,
        {
          cancellationSignal: options.signal,
          stopWaitingOnCancel: true,
          allowImplicitModel: state.profile.allowImplicitModel,
        },
      )
      const { prompt } = acpPromptFor(options, opened.nativeSystemPrompt)
      if (options.signal) {
        cancel = () => {
          void opened.agent.notify('session/cancel', { sessionId: opened.session.sessionId }).catch(() => {})
        }
        options.signal.addEventListener('abort', cancel, { once: true })
      }
      void opened.session.prompt([{ type: 'text', text: prompt }], {
        cancellationSignal: options.signal,
        stopWaitingOnCancel: true,
      })
      for (;;) {
        const message = await opened.session.nextUpdate()
        if (message.kind === 'stop') {
          for (const chunk of projector.finish(message.stopReason)) yield chunk
          return
        }
        for (const chunk of projector.push(message.update)) yield chunk
      }
    } catch (error) {
      for (const chunk of projector.fail(error, options.signal?.aborted === true)) yield chunk
    } finally {
      if (cancel && options.signal) options.signal.removeEventListener('abort', cancel)
      if (opened) await opened.close()
    }
  }

  async dispose() {
    await Promise.allSettled([...this.states.values()].map(state => state.process.dispose()))
  }
}
