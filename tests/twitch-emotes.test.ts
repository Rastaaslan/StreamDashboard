import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTwitchMessage, twitchEmoteUrl, twitchMessageParts } from '../apps/mobile/control/twitch-emotes.js';

afterEach(() => vi.unstubAllGlobals());
describe('Twitch emotes in authenticated chat', () => {
  it('uses verified EventSub fragments without confusing plain words for emotes', () => {
    const parts = twitchMessageParts({
      text: 'Salut Kappa <3',
      fragments: [
        { type: 'text', text: 'Salut ' },
        { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } },
        { type: 'text', text: ' <3' },
      ],
    });
    expect(parts).toEqual([
      { type: 'text', text: 'Salut ' },
      { type: 'emote', text: 'Kappa', id: '25', animated: false },
      { type: 'text', text: ' <3' },
    ]);
    expect(twitchEmoteUrl('25')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');
    expect(twitchEmoteUrl('emotesv2_abc123', true)).toBe('https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc123/animated/dark/2.0');
  });
  it('uses native IRC emote positions, including positions after emoji Unicode characters', () => {
    const text = '😀 Kappa and Kappa!';
    expect(twitchMessageParts({ text, emotes: '25:2-6,12-16' })).toEqual([
      { type: 'text', text: '😀 ' }, { type: 'emote', text: 'Kappa', id: '25', animated: false },
      { type: 'text', text: ' and ' }, { type: 'emote', text: 'Kappa', id: '25', animated: false },
      { type: 'text', text: '!' },
    ]);
  });
  it('ignores malformed fragments/indices and never accepts arbitrary image URLs', () => {
    expect(twitchEmoteUrl('../../malicious')).toBe('');
    expect(twitchEmoteUrl('https://evil.example/a')).toBe('');
    expect(twitchMessageParts({
      text: 'Kappa <img src=x>',
      fragments: [{ type: 'emote', text: 'WRONG', emote: { id: '25' } }],
    })).toEqual([{ type: 'text', text: 'Kappa <img src=x>' }]);
    expect(twitchMessageParts({ text: 'hello', emotes: '25:9-20' }))
      .toEqual([{ type: 'text', text: 'hello' }]);
  });
  it('creates image and text DOM nodes, never HTML from a Twitch message', () => {
    const created: any[] = [];
    vi.stubGlobal('document', {
      createDocumentFragment() { return { nodes: [] as any[], append(node: any) { this.nodes.push(node); } }; },
      createTextNode(text: string) { return { kind: 'text', text }; },
      createElement(tag: string) {
        if (tag !== 'img') throw new Error('Only images permitted');
        const image = { kind: 'image', dataset: {}, handlers: new Map(), addEventListener(event: string, handler: any) { this.handlers.set(event, handler); }, replaceWith() {} };
        created.push(image);
        return image;
      },
    });
    const body = { nodes: [] as any[], replaceChildren(fragment: any) { this.nodes = fragment.nodes; } };
    renderTwitchMessage(body as unknown as Element, { text: '<script>alert(1)</script> Kappa', fragments: [
      { type: 'text', text: '<script>alert(1)</script> ' },
      { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } },
    ] });
    expect(body.nodes[0]).toEqual({ kind: 'text', text: '<script>alert(1)</script> ' });
    expect(body.nodes[1].kind).toBe('image');
    expect(body.nodes[1].src).toBe(twitchEmoteUrl('25'));
    expect(body.nodes[1].alt).toBe('Kappa');
    expect(created).toHaveLength(1);
  });
});
