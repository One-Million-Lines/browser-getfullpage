import { describe, it, expect } from 'vitest';
import { DEVICE_PROFILES, DEFAULT_DEVICE, resolveDevice } from '@/shared/devices';

describe('device profiles', () => {
  it('exposes a non-empty catalogue with sane values', () => {
    expect(DEVICE_PROFILES.length).toBeGreaterThan(0);
    for (const d of DEVICE_PROFILES) {
      expect(d.key).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(d.width).toBeGreaterThan(200);
      expect(d.height).toBeGreaterThan(200);
      expect(d.dpr).toBeGreaterThanOrEqual(1);
      expect(d.userAgent).toMatch(/Mozilla/);
    }
  });

  it('resolves a known device by key', () => {
    const d = resolveDevice('iphone13');
    expect(d.width).toBe(390);
    expect(d.height).toBe(844);
    expect(d.dpr).toBe(3);
  });

  it('falls back to the first profile for unknown or missing keys', () => {
    expect(resolveDevice(undefined).key).toBe(DEVICE_PROFILES[0].key);
    expect(resolveDevice('does-not-exist').key).toBe(DEVICE_PROFILES[0].key);
  });

  it('has a default device present in the catalogue', () => {
    expect(DEVICE_PROFILES.some((d) => d.key === DEFAULT_DEVICE)).toBe(true);
  });
});
