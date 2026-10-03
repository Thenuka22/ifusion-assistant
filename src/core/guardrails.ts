/**
 * Client-side phrasing guards.
 *
 * These do not decide anything — the API refuses what it refuses. They exist so a refusal reads
 * like an explanation of the assistant's remit rather than a bare error code, and so a card number
 * pasted into the box is never echoed back on screen in full.
 */

const SENSITIVE_REQUEST_PATTERN =
  /\b(card\s*(number|numbers|detail|details|information|info|data)|ticket\s*(number|numbers|identifier|identifiers|detail|details)|passenger\s*(detail|details|record|records)|driver\s*(contact|details?|records?)|personal\s*(information|data|details?))\b/i;
const DESTRUCTIVE_REQUEST_PATTERN = /\b(alter|delete|drop|insert|truncate)\b/i;
const MUTATION_REQUEST_PATTERN = /\b(add|change|edit|modify|remove|update)\b/i;
const MUTATION_TARGET_PATTERN =
  /\b(card|data|database|record|records|row|rows|setting|settings|table|ticket|transaction|transactions|user|users)\b/i;
const LONG_NUMBER_PATTERN = /\b(?:\d[ -]?){12,19}\b/g;

export function maskSensitiveNumbers(value: string) {
  return value.replace(LONG_NUMBER_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 12 ? `•••• ${digits.slice(-4)}` : match;
  });
}

export function isSensitiveRequest(question: string) {
  return SENSITIVE_REQUEST_PATTERN.test(question);
}

export function isWriteRequest(question: string) {
  return (
    DESTRUCTIVE_REQUEST_PATTERN.test(question) ||
    (MUTATION_REQUEST_PATTERN.test(question) && MUTATION_TARGET_PATTERN.test(question))
  );
}

export function getFriendlyName(userName: string) {
  const firstPart = userName.trim().split(/[\s_@.]+/)[0] || "there";
  return firstPart.charAt(0).toLocaleUpperCase() + firstPart.slice(1);
}

/**
 * The message shown for a refusal.
 *
 * `canEdit` is true on screens where the assistant may fill an editor, so the blanket "I can only
 * read" line is not shown to someone who has just been offered a fill.
 */
export function getRefusalMessage(
  reason: string,
  question: string,
  options?: { canEdit?: boolean; retryAfterSeconds?: number }
) {
  if (isSensitiveRequest(question)) {
    return "To protect privacy, I don’t have access to sensitive details such as card numbers, ticket identifiers or personal information. I can still help with totals, trends and summaries.";
  }

  if (isWriteRequest(question) && !options?.canEdit) {
    return "For safety, I can only read your data. I can fill in an editor for you to check and save, but I can’t change or delete anything myself.";
  }

  switch (reason) {
    case "range_too_long":
      return "I can help with periods of up to 31 days. Please choose a shorter range.";
    // None of these name a vendor or a model: the person asking is talking to the assistant, and
    // which service is behind it is a setting for administrators.
    case "tool_limit_reached":
      return "I couldn’t finish that one in time. Your draft is preserved; try again, perhaps naming the table or rule you mean.";
    // Told apart on purpose: one is the service being unreachable, the other is it answering in a
    // shape we cannot use. They need different things done about them, so they read differently.
    case "model_unavailable":
      return "I can’t think straight at the moment. It’s usually brief; please try again shortly.";
    case "model_rate_limited":
      return options?.retryAfterSeconds
        ? `I’m at my limit just now. Please try again in ${formatWait(options.retryAfterSeconds)}; your message is still in the box.`
        : "I’m at my limit just now. Please try again shortly; your message is still in the box.";
    case "model_timeout":
      return "That took me too long to answer. Your message is still in the box, so you can send it again.";
    case "input_too_long":
      return "That message is longer than I can take in one go. Shorten it, or split a large table across two messages.";
    case "malformed_model_output":
      return "I got muddled putting that answer together. Try asking again, perhaps in different words.";
    case "agent_disabled":
      return "I’m not available right now.";
    case "out_of_section":
      return "I can only do that on the screen it belongs to. Open it and ask me again.";
    default:
      return "I’m focused on your iFusion data. I can look things up, explain totals and trends, and help you fill in the editors.";
  }
}

/** "40 seconds", "2 minutes": a wait as a person would say it. */
export function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The fallback for a request that never produced an answer. */
export function getFriendlyRequestError(error: unknown, status?: number) {
  const code = status ?? readStatus(error);
  if (code === 401) return "Your session has expired. Please sign in again.";
  if (code === 403) return "I’m not available for your account right now.";
  if (code === 429) return "You’ve asked me a lot this hour. Please try again a little later.";
  if (code === 413) return "That message is too large to send. Shorten it, or split it across two messages.";
  if (code === 504) return "That took me too long to answer. Your message is still in the box; please try again.";
  return "I couldn’t complete that request right now. Please try again shortly.";
}

function readStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}
