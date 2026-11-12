import { AssistantToolbox } from './assistant-toolbox';

// A provider turns the customer's new messages into ONE reply, using only the toolbox. The
// toolbox, the guards and the persistence are the same for every provider, so changing the
// provider (local rules, Claude, another vendor later) never changes what the assistant may do.

export interface HistoryEntry {
  role: 'customer' | 'assistant';
  text: string;
}

export interface AssistantTurnInput {
  toolbox: AssistantToolbox;
  // The new customer messages of this turn, oldest first, joined by line breaks.
  customerText: string;
  // Earlier messages of the conversation, oldest first (without this turn's).
  history: HistoryEntry[];
  // The local provider's dialogue state from the previous turn (opaque to the others).
  dialogState: unknown;
  restaurantName: string;
  behaviorInstructions: string | null;
}

export interface AssistantTurnOutput {
  text: string;
  dialogState?: unknown;
  provider: string;
  model: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AssistantProvider {
  readonly name: string;
  reply(input: AssistantTurnInput): Promise<AssistantTurnOutput>;
}

export class AssistantProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
