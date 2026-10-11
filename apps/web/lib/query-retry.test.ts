import { ApiError } from './api-client';
import { MAX_QUERY_RETRIES, shouldRetryQuery } from './query-retry';

describe('shouldRetryQuery', () => {
  it('never repeats a request the API refused: the answer would be the same', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetryQuery(0, new ApiError(status, 'CODE', 'message'))).toBe(false);
    }
  });

  it('does not answer "too many requests" with three more requests', () => {
    const limited = new ApiError(429, 'TOO_MANY_REQUESTS', 'Too Many Requests');
    const attempts = [0, 1, 2].filter((failureCount) => shouldRetryQuery(failureCount, limited));
    expect(attempts).toHaveLength(0);
  });

  it('tries again when the API itself failed', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldRetryQuery(0, new ApiError(status, 'CODE', 'message'))).toBe(true);
    }
  });

  it('tries again when the network failed', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('offline'))).toBe(true);
  });

  it('gives up after the same number of attempts as before', () => {
    expect(MAX_QUERY_RETRIES).toBe(3);
    expect(shouldRetryQuery(2, new Error('offline'))).toBe(true);
    expect(shouldRetryQuery(3, new Error('offline'))).toBe(false);
    expect(shouldRetryQuery(3, new ApiError(503, 'CODE', 'message'))).toBe(false);
  });
});
