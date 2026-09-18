import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../apps/mobile/transport.js', import.meta.url), 'utf8');

describe('Twitch Live Control mobile', () => {
  it('expose des outils mobiles dédiés au lieu de réduire le desktop', () => {
    for (const panel of ['chat', 'audience', 'vod', 'clips']) expect(html).toContain(`data-hub-panel="${panel}"`);
    expect(html).toContain('utilisateurs présents dans le chat');
    expect(html).not.toContain('liste des viewers');
  });

  it('attend les confirmations serveur pour le chat et les suppressions', () => {
    expect(mobile).toContain('await transport.sendTwitchChat');
    expect(mobile).toContain('Message confirmé par Twitch.');
    expect(mobile).toContain('await transport.deleteTwitchVideo');
    expect(mobile).toContain('Suppression définitive. Saisissez DELETE');
    expect(transport).toContain('confirmation: `DELETE ${id}`');
  });

  it('conserve un message PC hors ligne explicite', () => {
    expect(mobile).toContain('PC hors ligne. Le message n’a pas été envoyé.');
    expect(mobile).toContain('PC hors ligne. Les VOD Twitch ne peuvent pas être chargées via le PC.');
  });
});
