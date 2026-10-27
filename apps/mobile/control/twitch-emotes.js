// Safe Twitch emote rendering: EventSub message fragments (desktop) and IRC emotes tags (Android).
// Never create markup from a chat message or accept a remote image URL.
const VALID_EMOTE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_EMOTES = 100;

function textPart(text) { return { type: 'text', text }; }
function emotePart(text, id, animated = false) {
  return { type: 'emote', text, id, animated };
}
export function twitchEmoteUrl(id, animated = false) {
  if (typeof id !== 'string' || !VALID_EMOTE_ID.test(id)) return '';
  return 'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(id)
    + '/' + (animated ? 'animated' : 'default') + '/dark/2.0';
}
function fromEventSub(text, fragments) {
  if (!Array.isArray(fragments) || fragments.length < 1 || fragments.length > 500) return null;
  const result = [];
  let combined = '';
  for (const fragment of fragments) {
    if (!fragment || typeof fragment.text !== 'string') return null;
    combined += fragment.text;
    if (combined.length > MAX_MESSAGE_LENGTH) return null;
    const emote = fragment.type === 'emote' ? fragment.emote : null;
    if (emote && twitchEmoteUrl(emote.id)) {
      result.push(emotePart(fragment.text, emote.id, Array.isArray(emote.format) && emote.format.includes('animated')));
    } else {
      result.push(textPart(fragment.text));
    }
  }
  return combined === text ? result : null;
}
function fromIrc(text, emotes) {
  if (typeof emotes !== 'string' || !emotes || emotes.length > 3_000) return null;
  const characters = Array.from(text); // IRC emote offsets refer to characters, not HTML or words.
  const ranges = [];
  for (const group of emotes.split('/')) {
    const match = /^([A-Za-z0-9_-]{1,100}):([0-9,-]+)$/.exec(group);
    if (!match || !twitchEmoteUrl(match[1])) continue;
    for (const positions of match[2].split(',')) {
      const span = /^(\d+)-(\d+)$/.exec(positions);
      if (!span) continue;
      const first = Number(span[1]), last = Number(span[2]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)
        || last < first || last >= characters.length || ranges.length >= MAX_EMOTES) continue;
      const name = characters.slice(first, last + 1).join('');
      if (!name.trim()) continue;
      ranges.push({ first, last, id: match[1], name });
    }
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a.first - b.first || a.last - b.last);
  const pieces = [], pushText = (start, end) => {
    if (end > start) pieces.push(textPart(characters.slice(start, end).join('')));
  };
  let at = 0;
  for (const part of ranges) {
    if (part.first < at) continue;
    pushText(at, part.first);
    pieces.push(emotePart(part.name, part.id));
    at = part.last + 1;
  }
  pushText(at, characters.length);
  return pieces;
}
export function twitchMessageParts(message) {
  const text = typeof message?.text === 'string' ? message.text.slice(0, MAX_MESSAGE_LENGTH) : '';
  return fromEventSub(text, message?.fragments)
    || fromIrc(text, message?.emotes)
    || [textPart(text)];
}
export function renderTwitchMessage(body, message, onLayout = () => {}) {
  const parts = twitchMessageParts(message);
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.type !== 'emote') {
      fragment.append(document.createTextNode(part.text));
      continue;
    }
    const src = twitchEmoteUrl(part.id, part.animated);
    if (!src) { fragment.append(document.createTextNode(part.text)); continue; }
    const img = document.createElement('img');
    img.className = 'twitch-chat-emote';
    img.src = src;
    img.alt = part.text;
    img.title = part.text;
    img.loading = 'eager';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', onLayout, { once: true });
    img.addEventListener('error', () => {
      // Twitch may not serve the animated asset for every emote. Fall back to
      // the default asset, then to the original text if both fail.
      if (part.animated && !img.dataset.emoteFallback) {
        img.dataset.emoteFallback = '1';
        img.src = twitchEmoteUrl(part.id);
        return;
      }
      img.replaceWith(document.createTextNode(part.text));
      onLayout();
    });
    fragment.append(img);
  }
  body.replaceChildren(fragment);
}
