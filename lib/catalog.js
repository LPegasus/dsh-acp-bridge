export function flattenSelectOptions(options) {
  const flattened = []
  for (const entry of options ?? []) {
    if (Array.isArray(entry.options)) flattened.push(...entry.options)
    else flattened.push(entry)
  }
  return flattened
}

export function findConfigOption(configOptions, kind) {
  const select = (configOptions ?? []).filter(option => option.type === 'select')
  if (kind === 'model') {
    return select.find(option => option.category === 'model' || option.id === 'model')
  }
  return select.find(option => option.category === 'thought_level'
    || ['reasoning_effort', 'reasoning', 'effort'].includes(option.id))
}

export function catalogFromSession(sessionResponse) {
  const configOptions = sessionResponse.configOptions ?? []
  const modelOption = findConfigOption(configOptions, 'model')
  if (modelOption) {
    const models = flattenSelectOptions(modelOption.options).map(option => ({
      id: option.value,
      name: option.name || option.value,
      ...option.description ? { description: option.description } : {},
    }))
    return {
      models,
      currentModel: modelOption.currentValue,
      configOptions,
      modelOption,
      legacyModels: false,
    }
  }

  // ACP v1 before configOptions used session/new.models and session/set_model.
  const legacy = sessionResponse.models
  if (legacy && Array.isArray(legacy.availableModels)) {
    return {
      models: legacy.availableModels.map(model => ({
        id: model.modelId ?? model.id,
        name: model.name || model.modelId || model.id,
        ...model.description ? { description: model.description } : {},
      })).filter(model => typeof model.id === 'string' && model.id.length > 0),
      currentModel: legacy.currentModelId,
      configOptions,
      modelOption: undefined,
      legacyModels: true,
    }
  }

  return {
    models: [],
    currentModel: undefined,
    configOptions,
    modelOption: undefined,
    legacyModels: false,
  }
}

export function reasoningFromConfig(configOptions) {
  const option = findConfigOption(configOptions, 'reasoning')
  if (!option) return { efforts: [], defaultEffort: undefined, option: undefined }
  return {
    efforts: flattenSelectOptions(option.options).map(entry => ({
      id: entry.value,
      name: entry.name || entry.value,
      ...entry.description ? { description: entry.description } : {},
    })),
    defaultEffort: option.currentValue,
    option,
  }
}

export function mergeConfiguredCatalog(discovered, configuredModels) {
  if (configuredModels.length > 0) {
    return {
      ...discovered,
      models: configuredModels,
    }
  }
  return discovered
}

export async function configureSession(agent, session, sessionResponse, model, reasoningEffort, options = {}) {
  let catalog = catalogFromSession(sessionResponse)
  let configOptions = sessionResponse.configOptions ?? []

  if (catalog.modelOption) {
    const values = flattenSelectOptions(catalog.modelOption.options).map(option => option.value)
    if (!values.includes(model)) {
      throw new Error(`ACP model ${JSON.stringify(model)} is not advertised by this agent`)
    }
    if (catalog.currentModel !== model) {
      const updated = await agent.request('session/set_config_option', {
        sessionId: session.sessionId,
        configId: catalog.modelOption.id,
        value: model,
      }, options)
      configOptions = updated.configOptions
      catalog = catalogFromSession({ ...sessionResponse, configOptions })
    }
  } else if (catalog.legacyModels) {
    if (!catalog.models.some(entry => entry.id === model)) {
      throw new Error(`ACP model ${JSON.stringify(model)} is not advertised by this agent`)
    }
    if (catalog.currentModel !== model) {
      await agent.request('session/set_model', {
        sessionId: session.sessionId,
        modelId: model,
      }, options)
      catalog = { ...catalog, currentModel: model }
    }
  } else if (options.allowImplicitModel !== true) {
    throw new Error('The ACP agent exposes no model selector; configure models and set allowImplicitModel only when its command already selects the requested model')
  }

  if (reasoningEffort !== undefined) {
    const reasoning = reasoningFromConfig(configOptions)
    if (!reasoning.option || !reasoning.efforts.some(effort => effort.id === reasoningEffort)) {
      throw new Error(`ACP reasoning effort ${JSON.stringify(reasoningEffort)} is not available for model ${JSON.stringify(model)}`)
    }
    if (reasoning.defaultEffort !== reasoningEffort) {
      const updated = await agent.request('session/set_config_option', {
        sessionId: session.sessionId,
        configId: reasoning.option.id,
        value: reasoningEffort,
      }, options)
      configOptions = updated.configOptions
    }
  }

  return { configOptions, catalog }
}
