import { ApiError } from './api-client';

// How many times a failed query is tried again (TanStack Query's own default).
export const MAX_QUERY_RETRIES = 3;

// When a failed query is worth sending again.
//
// An answer in the 4xx range is the API's decision about THIS request (not allowed, not found,
// invalid, too many requests): the same request gets the same answer. Retrying it only
// multiplies the traffic, and for 429 that is the opposite of what the limit asks for: three
// more requests for each refused one keep the address over the limit. Screens that poll ask
// again by themselves on their next interval.
//
// Anything else (the network failed, the API answered 5xx) may well work a moment later.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) return false;
  return failureCount < MAX_QUERY_RETRIES;
}
