import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localDateInputValue } from '../apps/mobile/runtime.js';

describe('navigation et saisie mobile', () => {
  it('formate la date depuis le calendrier local plutôt que depuis UTC', () => {
    const lateLocalDay = new Date(2026, 8, 19, 23, 30);
    expect(localDateInputValue(lateLocalDay)).toBe('2026-09-19');
    expect(() => localDateInputValue('not-a-date')).toThrow('Date locale invalide');
  });

  it('laisse chaque shell consommer Back avant que WebView ne quitte la page', () => {
    const activity = readFileSync('android/app/src/main/java/com/rastaaslan/streamdashboard/remote/MainActivity.java', 'utf8');
    const preview = readFileSync('apps/mobile/preview.js', 'utf8');
    const legacy = readFileSync('apps/mobile/mobile.js', 'utf8');
    expect(activity).toContain('window.StreamDashboardHandleBack');
    expect(activity).toContain('if ("true".equals(handled)) return;');
    expect(preview).toContain('window.StreamDashboardHandleBack = () =>');
    expect(legacy).toContain('window.StreamDashboardHandleBack = () =>');
  });
});
