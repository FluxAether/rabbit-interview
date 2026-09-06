import { orderCopilotMessagesForDisplay, type CopilotMessage } from './copilotSessionState'

export function extractKeyTakeaways(text: string): string[] {
  // Only use short, explicit bullets. A paragraph is the answer, not a second summary.
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim())
    .filter((line) => line.length > 5 && line.length <= 160)
    .slice(0, 3)
}

export function groupCopilotMessages(messages: CopilotMessage[], showMyBubbles = true): CopilotMessage[][] {
  const groups: CopilotMessage[][] = []
  for (const message of orderCopilotMessagesForDisplay(messages)) {
    if (!showMyBubbles && message.role === 'me') continue
    const previous = groups[groups.length - 1]
    if (message.role === 'assistant' && previous
      && (message.replyToId == null || message.replyToId === previous[0].id)
      && (previous[0].role === 'interviewer' || previous[0].source === 'follow-up')) {
      previous.push(message)
    } else {
      groups.push([message])
    }
  }
  return groups
}
