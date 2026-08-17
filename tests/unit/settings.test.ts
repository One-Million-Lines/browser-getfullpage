import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  migrateSettings,
  normalizeSettings,
} from '@/shared/settings';

describe('normalizeSettings', () => {
  it('returns defaults for empty or invalid input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps jpeg quality into range', () => {
    expect(normalizeSettings({ jpegQuality: 5 }).jpegQuality).toBe(1);
    expect(normalizeSettings({ jpegQuality: 0.1 }).jpegQuality).toBe(0.6);
  });

  it('clamps engine limits', () => {
    const s = normalizeSettings({ maxSlices: 999999, maxPageHeightPx: 1 });
    expect(s.maxSlices).toBeLessThanOrEqual(2000);
    expect(s.maxPageHeightPx).toBeGreaterThanOrEqual(2000);
  });

  it('rejects unknown enum values', () => {
    const s = normalizeSettings({ defaultFormat: 'gif', postCapture: 'ftp' });
    expect(s.defaultFormat).toBe('png');
    expect(s.postCapture).toBe('preview');
  });

  it('merges nested pdf defaults without dropping fields', () => {
    const s = normalizeSettings({ pdf: { paper: 'letter' } });
    expect(s.pdf.paper).toBe('letter');
    expect(s.pdf.orientation).toBe(DEFAULT_SETTINGS.pdf.orientation);
  });
});

describe('migrateSettings', () => {
  it('upgrades legacy data with no schema version', () => {
    const migrated = migrateSettings({ defaultFormat: 'jpeg' });
    expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.defaultFormat).toBe('jpeg');
    expect(migrated.pdf).toBeDefined();
    expect(migrated.memoryCeilingBytes).toBe(DEFAULT_SETTINGS.memoryCeilingBytes);
  });

  it('preserves user choices across migration', () => {
    const migrated = migrateSettings({ jpegQuality: 0.8, freezeAnimations: false });
    expect(migrated.jpegQuality).toBe(0.8);
    expect(migrated.freezeAnimations).toBe(false);
  });
});
