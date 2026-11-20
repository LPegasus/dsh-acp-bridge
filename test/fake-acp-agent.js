import { appendFileSync } from 'node:fs'
import readline from 'node:readline'

let currentModel = 'gpt-fake-a'
let currentEffort = 'low'
const pending = new Map()
const logPath = process.env.FAKE_ACP_LOG

function record(value) {
  if (logPath) appendFileSync(logPath, `${JSON.stringify(value)}\n`)
}

function send(value) {
  record({ direction: 'out', value })
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function configOptions() {
  return [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: currentModel,
      options: [
        { value: 'gpt-fake-a', name: 'GPT Fake A' },
        { value: 'gpt-fake-b', name: 'GPT Fake B', description: 'Second fake model' },
      ],
    },
    {
      id: 'reasoning_effort', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: currentEffort,
      options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
    },
  ]
}

function notification(sessionId, update) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  const request = JSON.parse(line)
  record({ direction: 'in', value: request })
  const { id, method, params } = request
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: params.protocolVersion,
      agentInfo: { name: 'fake-acp', version: '1.0.0' },
      agentCapabilities: {
        promptCapabilities: { image: false },
        sessionCapabilities: { close: {}, systemPrompt: {} },
      },
      authMethods: [],
    } })
  } else if (method === 'session/new') {
    send({ jsonrpc: '2.0', id, result: { sessionId: 'fake-session', configOptions: configOptions() } })
  } else if (method === 'session/set_config_option') {
    if (params.configId === 'model') currentModel = params.value
    if (params.configId === 'reasoning_effort') currentEffort = params.value
    send({ jsonrpc: '2.0', id, result: { configOptions: configOptions() } })
  } else if (method === 'session/prompt') {
    pending.set(params.sessionId, id)
    const run = async () => {
      if (params.prompt[0].text.includes('REQUEST_PERMISSION')) {
        const permissionId = 'permission-1'
        send({ jsonrpc: '2.0', id: permissionId, method: 'session/request_permission', params: {
          sessionId: params.sessionId,
          toolCall: { toolCallId: 'tool-1', title: 'Fake write' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        } })
        return
      }
      notification(params.sessionId, { sessionUpdate: 'agent_thought_chunk', messageId: 'thought-1', content: { type: 'text', text: 'thinking' } })
      notification(params.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'message-1', content: { type: 'text', text: `answer from ${currentModel}/${currentEffort}` } })
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
      pending.delete(params.sessionId)
    }
    if (params.prompt[0].text.includes('WAIT_FOR_CANCEL')) {
      const timer = setTimeout(run, 10_000)
      pending.set('timer', timer)
    } else {
      void run()
    }
  } else if (method === 'session/cancel') {
    const promptId = pending.get(params.sessionId)
    const timer = pending.get('timer')
    if (timer) clearTimeout(timer)
    if (promptId !== undefined) {
      send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } })
      pending.delete(params.sessionId)
    }
  } else if (method === 'session/close') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else if (id !== undefined && method === 'session/request_permission') {
    // This branch is never used: permission responses have no method.
  } else if (id === 'permission-1') {
    // Handled by the generic response branch below.
  }

  if (request.method === undefined && request.id === 'permission-1') {
    const promptId = pending.get('fake-session')
    notification('fake-session', { sessionUpdate: 'agent_message_chunk', messageId: 'message-1', content: { type: 'text', text: `permission ${request.result.outcome.optionId}` } })
    send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } })
    pending.delete('fake-session')
  }
})
