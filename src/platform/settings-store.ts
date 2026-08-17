import { storageGet, storageSet } from './browser';
import { DEFAULT_SETTINGS, migrateSettings } from '@/shared/settings';
import type { Settings } from '@/shared/types';

const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const raw = await storageGet<unknown>(SETTINGS_KEY);
  if (raw === undefined) return { ...DEFAULT_SETTINGS };
  return migrateSettings(raw);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await storageSet(SETTINGS_KEY, settings);
}

export async function resetSettings(): Promise<Settings> {
  const fresh = { ...DEFAULT_SETTINGS };
  await saveSettings(fresh);
  return fresh;
}
