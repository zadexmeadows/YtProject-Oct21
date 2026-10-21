import { describe, expect, it } from 'vitest';
import { ensureCsrfToken } from '../lib/csrf';

describe('csrf helper', () => {
  it('creates a stable session token', () => {
    const req = { session: {} } as any;
    const token = ensureCsrfToken(req);
    expect(token).toEqual(expect.any(String));
    expect(ensureCsrfToken(req)).toBe(token);
  });
});
