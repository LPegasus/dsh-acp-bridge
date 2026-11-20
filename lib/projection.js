function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    switch (block.type) {
      case 'text': return block.text
      case 'reasoning': return `<reasoning>\n${block.text}\n</reasoning>`
      case 'tool-call':
        return `<tool-call id=${JSON.stringify(block.id)} name=${JSON.stringify(block.name)}>\n${block.arguments}\n</tool-call>`
      case 'tool-addition': return `<tool-addition name=${JSON.stringify(block.toolName)}/>`
      case 'tool-removal': return `<tool-removal name=${JSON.stringify(block.toolName)}/>`
      case 'image': return `[image ${block.attachment.name ?? block.attachment.attachmentId}]`
      case 'file': return `[file ${block.attachment.name}, ${block.attachment.bytes} bytes]`
      default: return `[${block.type}]`
    }
  }).join('\n')
}

function messageLabel(message) {
  if (message.role === 'tool') return `tool call=${JSON.stringify(message.toolCallId)}`
  return message.role
}

export function projectConversation(options) {
  const systemParts = []
  if (typeof options.system === 'string' && options.system.length > 0) systemParts.push(options.system)
  const messages = []
  for (const message of options.messages) {
    const text = textOfContent(message.content)
    if (message.role === 'system') systemParts.push(text)
    else messages.push(`<message role=${JSON.stringify(messageLabel(message))}>\n${text}\n</message>`)
  }
  const system = systemParts.join('\n\n')
  const transcript = messages.join('\n')
  return { system, transcript }
}

export function acpPromptFor(options, nativeSystemPrompt) {
  const { system, transcript } = projectConversation(options)
  const fallbackSystem = nativeSystemPrompt || system.length === 0
    ? ''
    : `<message role="system">\n${system}\n</message>\n`
  const prompt = `${fallbackSystem}<dsh-conversation>\n${transcript}\n</dsh-conversation>\nContinue as the assistant.`
  return { system, prompt }
}
