import { redactUrlQuery } from './redact-url.util';

describe('redactUrlQuery', () => {
  it('leaves a URL without a query string untouched', () => {
    expect(redactUrlQuery('/v1/customers/123')).toBe('/v1/customers/123');
  });

  it('keeps the parameter names and drops every value', () => {
    expect(redactUrlQuery('/v1/customers?search=Maria%20Silva&page=2')).toBe(
      '/v1/customers?search=[REDACTED]&page=[REDACTED]',
    );
  });

  it('does not let a phone or an e-mail through', () => {
    const redacted = redactUrlQuery('/v1/customers?search=11987654321&email=maria@example.com');
    expect(redacted).not.toContain('11987654321');
    expect(redacted).not.toContain('maria@example.com');
  });

  it('handles values that contain "=" and parameters without a value', () => {
    expect(redactUrlQuery('/v1/orders?token=a=b=c&flag')).toBe('/v1/orders?token=[REDACTED]&flag=[REDACTED]');
  });

  it('drops a dangling "?"', () => {
    expect(redactUrlQuery('/v1/orders?')).toBe('/v1/orders');
  });

  it('returns an empty string when there is no URL', () => {
    expect(redactUrlQuery(undefined)).toBe('');
  });
});
