import type {
  ActionId,
  BranchId,
  CommitmentId,
  ConversationId,
  EventId,
  GameId,
  MessageId,
  TurnId,
} from './schemas';

type GeneratedId =
  ActionId | BranchId | CommitmentId | ConversationId | EventId | GameId | MessageId | TurnId;

export function createId<T extends GeneratedId>(prefix: string): T {
  const entropy = globalThis.crypto.randomUUID().replaceAll('-', '');
  return `${prefix}:${entropy}` as T;
}
