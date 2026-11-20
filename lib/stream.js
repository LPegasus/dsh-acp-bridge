export class AcpChunkProjector {
  constructor(provider) {
    this.provider = provider
    this.index = -1
    this.open = undefined
  }

  push(update) {
    if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') return []
    if (update.content?.type !== 'text' || typeof update.content.text !== 'string' || update.content.text.length === 0) return []
    const blockType = update.sessionUpdate === 'agent_message_chunk' ? 'text' : 'reasoning'
    const messageId = update.messageId ?? null
    const chunks = []
    if (this.open && (this.open.blockType !== blockType || this.open.messageId !== messageId)) {
      chunks.push(...this.closeBlock())
    }
    if (!this.open) {
      this.index += 1
      this.open = { index: this.index, blockType, messageId, text: '' }
      chunks.push({ type: 'block-start', index: this.index, blockType })
    }
    this.open.text += update.content.text
    chunks.push({
      type: blockType === 'text' ? 'text-delta' : 'reasoning-delta',
      index: this.index,
      text: update.content.text,
    })
    return chunks
  }

  closeBlock() {
    if (!this.open) return []
    const current = this.open
    this.open = undefined
    return [{
      type: 'block-end',
      index: current.index,
      block: { type: current.blockType, text: current.text },
    }]
  }

  finish(stopReason) {
    const chunks = this.closeBlock()
    if (stopReason === 'end_turn') chunks.push({ type: 'finish', reason: { kind: 'stop' } })
    else if (stopReason === 'max_tokens') chunks.push({ type: 'finish', reason: { kind: 'max-tokens' } })
    else if (stopReason === 'cancelled') {
      chunks.push({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ACP prompt cancelled' } } })
    } else if (stopReason === 'refusal') {
      chunks.push({ type: 'finish', reason: { kind: 'error', failure: { code: 'REFUSAL', message: 'The ACP agent refused the request' } } })
    } else {
      chunks.push({ type: 'finish', reason: { kind: 'error', failure: { code: 'ACP_STOP', message: `The ACP agent stopped: ${stopReason}` } } })
    }
    return chunks
  }

  fail(error, aborted = false) {
    const chunks = this.closeBlock()
    const failure = acpFailure(error, this.provider, aborted)
    chunks.push({ type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure } })
    return chunks
  }
}

export function acpFailure(error, provider, aborted = false) {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw
  if (aborted) return { code: 'ABORTED', message: `${provider}: ACP request cancelled` }
  if (/auth|login|credential|unauthorized|401/i.test(message)) {
    return { code: 'AUTH', message: `${provider}: ACP authentication failed; sign in to the external agent first (${message})` }
  }
  if (/rate.?limit|too many requests|429/i.test(message)) return { code: 'RATE_LIMIT', message: `${provider}: ${message}` }
  if (/timed? out|timeout/i.test(message)) return { code: 'TIMEOUT', message: `${provider}: ${message}` }
  return { code: 'ACP_REQUEST', message: `${provider}: ${message || 'ACP request failed'}` }
}
