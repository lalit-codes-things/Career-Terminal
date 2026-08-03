export type CommunicationProvider = 'gmail' | 'outlook' | 'future_provider';
export type MessageDirection = 'inbound' | 'outbound';

export interface CommunicationParticipant {
  address: string;
  displayName?: string;
  recruiterId?: string;
  userId?: string;
}

export interface RecruiterMessageInput {
  provider: CommunicationProvider;
  providerMessageId: string;
  providerThreadId: string;
  sentAt: Date;
  direction: MessageDirection;
  subject?: string;
  snippet?: string;
  from: CommunicationParticipant;
  to: CommunicationParticipant[];
  metadata?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface RecruiterConversation {
  id: string;
  provider: CommunicationProvider;
  providerThreadId: string;
  participants: CommunicationParticipant[];
  messages: RecruiterMessageInput[];
  firstContactAt: Date;
  latestContactAt: Date;
  responseLatencyMs?: number;
  followUpCount: number;
  metadata: Record<string, unknown>;
}

export class RecruiterCommunicationService {
  ingestMessage(
    existing: RecruiterConversation | undefined,
    message: RecruiterMessageInput,
  ): RecruiterConversation {
    const messages = [...(existing?.messages ?? []), message].sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
    );
    const firstMessage = messages[0];
    const latestMessage = messages[messages.length - 1];
    if (!firstMessage || !latestMessage) {
      throw new Error('Conversation ingestion requires at least one message');
    }
    const participants = this.mergeParticipants([
      ...(existing?.participants ?? []),
      message.from,
      ...message.to,
    ]);
    const inbound = messages.filter((item) => item.direction === 'inbound');
    const outbound = messages.filter((item) => item.direction === 'outbound');
    const firstInbound = inbound[0];
    const firstOutboundAfterInbound = firstInbound
      ? outbound.find((item) => item.sentAt > firstInbound.sentAt)
      : undefined;

    return {
      id: existing?.id ?? `${message.provider}:${message.providerThreadId}`,
      provider: message.provider,
      providerThreadId: message.providerThreadId,
      participants,
      messages,
      firstContactAt: firstMessage.sentAt,
      latestContactAt: latestMessage.sentAt,
      responseLatencyMs:
        firstInbound && firstOutboundAfterInbound
          ? firstOutboundAfterInbound.sentAt.getTime() - firstInbound.sentAt.getTime()
          : existing?.responseLatencyMs,
      followUpCount: messages.filter((item) =>
        /follow\s*up|following up|checking in|circling back/i.test(
          `${item.subject ?? ''} ${item.snippet ?? ''}`,
        ),
      ).length,
      metadata: { ...(existing?.metadata ?? {}), ...(message.metadata ?? {}) },
    };
  }

  buildTimeline(conversation: RecruiterConversation): Array<{
    occurredAt: Date;
    type: string;
    messageId: string;
    metadata: Record<string, unknown>;
  }> {
    return conversation.messages.map((message) => ({
      occurredAt: message.sentAt,
      type: `communication.${message.direction}`,
      messageId: message.providerMessageId,
      metadata: {
        provider: message.provider,
        threadId: message.providerThreadId,
        evidence: message.evidence ?? {},
      },
    }));
  }

  private mergeParticipants(participants: CommunicationParticipant[]): CommunicationParticipant[] {
    const byAddress = new Map<string, CommunicationParticipant>();
    for (const participant of participants) {
      const key = participant.address.trim().toLowerCase();
      byAddress.set(key, { ...byAddress.get(key), ...participant, address: key });
    }
    return [...byAddress.values()].sort((a, b) => a.address.localeCompare(b.address));
  }
}
