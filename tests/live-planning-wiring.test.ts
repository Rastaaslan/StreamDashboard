import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');

describe('câblage live non programmé', () => {
  it('ne demande Google que lorsqu’une connexion et un calendrier cible existent', () => {
    expect(server).toContain("const shouldPublishUnplannedToGoogle = () => google.connected && Boolean(local.google.targetCalendarId)");
    expect(server).toContain('publishGoogle: shouldPublishUnplannedToGoogle()');
  });

  it('persiste et diffuse d’abord le brouillon local avant toute attente Google', () => {
    expect(server).toMatch(/local\.planning\.push\(item\);[\s\S]*?await save\(\);\s*broadcast\(\);\s*await syncUnplannedWithGoogle\(item\);/);
  });

  it('finalise la vraie heure locale avant de mettre à jour Google', () => {
    expect(server).toMatch(/finalizeUnplannedLive\(item, Date\.now\(\)\);\s*await save\(\);\s*broadcast\(\);\s*await syncUnplannedWithGoogle\(item\);/);
  });

  it('isole les erreurs Google au lieu de les transformer en échec Start\/Stop', () => {
    expect(server).toMatch(/const syncUnplannedWithGoogle = async \(item: CalendarItem\) => \{[\s\S]*?try \{[\s\S]*?planning\(\)\.retry\(item\.id, 'google'\)[\s\S]*?catch \(error\)/);
    expect(server).toContain('streamTrackingQueue = streamTrackingQueue.then(operation).catch(logError)');
  });
});
