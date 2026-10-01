import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');

describe('câblage live non programmé', () => {
  it('ne demande Google que lorsqu’une connexion et un calendrier cible existent', () => {
    expect(server).toContain("const shouldPublishUnplannedToGoogle = () => google.connected && Boolean(local.google.targetCalendarId)");
    expect(server).toContain('publishGoogle: shouldPublishUnplannedToGoogle()');
  });

  it('persiste et diffuse le brouillon local avant de seulement mettre Google en file de fond', () => {
    expect(server).toMatch(/local\.planning\.push\(item\);[\s\S]*?await save\(\);\s*broadcast\(\);[\s\S]*?if \(googleSyncId\) queueUnplannedGoogleSync\(googleSyncId\);/);
    expect(server).not.toContain('await syncUnplannedWithGoogle');
  });

  it('capture la vraie heure d’arrêt avant toute attente réseau', () => {
    expect(server).toMatch(/const observedAt = Date\.now\(\);[\s\S]*?queueStreamTracking\(\(\) => currentStreaming \? startUnplannedLive\(observedAt\) : stopUnplannedLive\(observedAt\)\);/);
    expect(server).toContain('finalizeUnplannedLive(item, observedAt);');
  });

  it('sérialise Google séparément du suivi OBS et isole ses erreurs', () => {
    expect(server).toContain('let streamTrackingQueue: Promise<void> = Promise.resolve()');
    expect(server).toContain('let unplannedGoogleQueue: Promise<void> = Promise.resolve()');
    expect(server).toContain('streamTrackingQueue = streamTrackingQueue.then(operation).catch(logError)');
    expect(server).toContain('unplannedGoogleQueue.then(() => syncUnplannedGoogleNow(id))');
    expect(server).toContain('await recordUnplannedGoogleFailure(id, error)');
  });

  it('attend proprement les files de fond uniquement à la fermeture de l’application', () => {
    expect(server).toMatch(/await streamTrackingQueue\.catch\(\(\) => undefined\);\s*await unplannedMetadataQueue\.catch\(\(\) => undefined\);\s*await unplannedGoogleQueue\.catch\(\(\) => undefined\);/);
  });
});
