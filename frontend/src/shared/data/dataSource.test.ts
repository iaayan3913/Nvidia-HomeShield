// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('data source selection', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); vi.resetModules(); });

  it('defaults to mock unless API mode is explicitly configured', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'mock'); vi.resetModules();
    expect((await import('./index')).dataSourceMode).toBe('mock');
  });

  it('honours an explicit runtime override without mixing modes', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'mock'); localStorage.setItem('homeshield.data-source.override', 'api'); vi.resetModules();
    const source = await import('./index');
    expect(source.dataSourceMode).toBe('api'); expect(source.isApiMode).toBe(true);
  });
});
