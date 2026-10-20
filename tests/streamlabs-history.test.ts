import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { normalizeStreamlabsEvents, type StreamlabsEvent } from '../integrations/streamlabs/src/events.js';
import { mergeStreamlabsHistory, normalizeStreamlabsHistory } from '../integrations/streamlabs/src/history.js';

const importedAt = new Date('2026-10-20T15:00:00.000Z');
const laterImport = new Date('2026-10-21T15:00:00.000Z');
type Row = Record<string, unknown>;

function row(type: string, id: number, extra: Row = {}): Row {
  return {
    type, platform: type === 'donation' ? 'streamlabs' : 'twitch_account', id,
    name: `viewer-${id}`, created_at: '2026-10-18 12:00:00', ...extra,
  };
}

function cloud(collection: string, rows: Row[], now = importedAt): StreamlabsEvent[] {
  return normalizeStreamlabsHistory({ data: { [collection]: rows } }, now);
}

function socket(type: string, id: string, date = '2026-10-20T14:00:00.000Z', extra: Row = {}): StreamlabsEvent {
  return normalizeStreamlabsEvents({
    type, for: 'twitch_account', message: [{ _id: id, name: 'Ada', created_at: date, ...extra }],
  }, importedAt)[0];
}

function representativeResponse() {
  let nextId = 1;
  const batch = (type: string, length: number, fields: (index: number) => Row = () => ({})) => Array.from({ length }, (_, index) => {
    const id = nextId++;
    return row(type, id, {
      created_at: new Date(Date.UTC(2026, 9, 18, 12, 0, id)).toISOString().slice(0, 19).replace('T', ' '),
      ...fields(index),
    });
  });
  return {
    data: {
      donations: batch('donation', 6, () => ({ amount: '5.25', formatted_amount: '5,25 €', data: { donor: 'private-donor', points: 42 } })),
      subscriptions: batch('subscription', 58, index => ({
        sub_type: index < 29 ? 'subgift' : index < 49 ? 'resub' : 'sub',
        months: index < 29 ? 1 : 3,
        ...(index < 29 ? { gifter: `gifter-${index}`, gifter_display_name: `Gifter ${index}` } : {}),
      })),
      follows: batch('follow', 10),
      raids: batch('raid', 7, () => ({ raiders: 12 })),
      bits: batch('bits', 10, () => ({ amount: 250 })),
      platforms: [{ platform: 'twitch_account', access_token: 'never-store-platform-token' }],
    },
  };
}

describe('Streamlabs cloud history normalization', () => {
  it('recovers all 91 representative events with stable identities across repeat imports', () => {
    const response = representativeResponse();
    const before = structuredClone(response);
    const first = normalizeStreamlabsHistory(response, importedAt);
    const next = normalizeStreamlabsHistory(response, laterImport);
    assert.equal(first.length, 91);
    assert.equal(new Set(first.map(event => event.id)).size, 91);
    assert.deepEqual(Object.fromEntries(['donation', 'subscription', 'follow', 'raid', 'bits'].map(type => [type, first.filter(event => event.type === type).length])), {
      donation: 6, subscription: 58, follow: 10, raid: 7, bits: 10,
    });
    assert.deepEqual(['subgift', 'resub', 'sub'].map(type => first.filter(event => event.subType === type).length), [29, 20, 9]);
    assert.deepEqual(next.map(event => event.id), first.map(event => event.id));
    assert.ok(first.every(event => event.origin === 'cloud' && event.occurredAt && event.receivedAt === importedAt.toISOString()));
    assert.ok(first.every((event, index) => !index || Date.parse(first[index - 1].occurredAt!) >= Date.parse(event.occurredAt!)));
    assert.deepEqual(response, before);
    const output = JSON.stringify(first);
    assert.ok(!output.includes('never-store-platform-token'));
    assert.ok(!output.includes('private-donor'));
  });

  it('reads only recognized activity groups and never retains raw credentials or nested donor data', () => {
    const result = normalizeStreamlabsHistory({
      access_token: 'root-credential',
      data: {
        donations: [row('donation', 1, {
          name: 'Ada', amount: 5, formatted_amount: '5 €', access_token: 'row-credential',
          data: { donor: 'nested-donor-credential', points: 1 }, platforms: [{ token: 'nested-platform-credential' }],
        }), row('follow', 2)],
        follows: [row('follow', 3, { platform: 'unrecognized_account' }), row('rollendcredits', 4), null, [], 'invalid'],
        subscriptions: { rows: [row('subscription', 5)] },
        platforms: [row('follow', 6, { access_token: 'platform-credential' })],
        platformcredentials: [row('donation', 7, { access_token: 'platform-list-credential' })],
        arbitrary: [row('raid', 8)],
      },
    }, importedAt);
    assert.equal(result.length, 1);
    assert.equal(result[0].displayName, 'Ada');
    assert.ok(!JSON.stringify(result).includes('credential'));
    assert.ok(!('data' in result[0]));
    assert.ok(!('platforms' in result[0]));
    for (const invalid of [null, [], {}, { data: [] }, { data: null }]) {
      assert.deepEqual(normalizeStreamlabsHistory(invalid, importedAt), []);
    }
  });

  it('uses validated UTC cloud dates without changing ambiguous socket timestamps', () => {
    const result = cloud('follows', [
      row('follow', 1, { created_at: '2024-02-29 23:59:59' }),
      row('follow', 2, { created_at: '2026-10-20T14:30:00+02:00' }),
      row('follow', 3, { created_at: '2026-10-20 12:30:00.123' }),
    ]);
    assert.equal(result.find(event => event.displayName === 'viewer-1')?.occurredAt, '2024-02-29T23:59:59.000Z');
    assert.equal(result.find(event => event.displayName === 'viewer-2')?.occurredAt, '2026-10-20T12:30:00.000Z');
    assert.equal(result.find(event => event.displayName === 'viewer-3')?.occurredAt, '2026-10-20T12:30:00.123Z');
    assert.equal(socket('follow', 'socket-naive', '2026-10-20 12:30:00').occurredAt, null);
  });

  it('never invents a date or unstable identity for malformed or missing cloud dates', () => {
    const invalidDates = [undefined, null, '', 'today', '2026-02-29 12:00:00', '2026-02-30 12:00:00', '2026-13-01 12:00:00', '2026-10-20 24:00:00', '2026-10-20 12:60:00', '2026-10-20T12:00:00+25:00'];
    for (const [index, created_at] of invalidDates.entries()) {
      assert.deepEqual(cloud('follows', [row('follow', 1, { created_at })]), []);
      const source = row('follow', 1, { _id: `known-event-${index}`, created_at });
      const first = cloud('follows', [source])[0];
      const next = cloud('follows', [source], laterImport)[0];
      assert.equal(first.occurredAt, null);
      assert.equal(first.id, next.id);
      assert.equal(first.receivedAt, importedAt.toISOString());
    }
    assert.deepEqual(cloud('follows', [row('follow', 1, { id: undefined })]), []);
    assert.equal(cloud('follows', [row('follow', 1, { id: undefined, _id: 'real-event' })]).length, 1);
  });

  it('attributes gifts to the gifter and keeps the subscriber as recipient', () => {
    const gifts = cloud('subscriptions', [
      row('subscription', 1, { name: 'recipient_login', display_name: 'Recipient', from: 'old-gifter-name', gifter: 'gifter_login', gifter_display_name: 'Gifter', sub_type: 'subgift', months: 3 }),
      row('subscription', 2, { name: 'Second recipient', from: 'gifter2_login', from_display_name: 'Second Gifter', sub_type: 'subgift' }),
      row('subscription', 3, { name: 'Third recipient', gifter: { secret: 'not-a-name' }, sub_type: 'subgift' }),
      row('subscription', 4, { name: 'sub_login', display_name: 'Subscriber', gifter: 'irrelevant', sub_type: 'resub', months: 12 }),
    ]);
    const gift = gifts.find(event => event.recipient === 'Recipient')!;
    assert.equal(gift.displayName, 'Gifter');
    assert.equal(gift.months, 3);
    assert.equal(gift.subType, 'subgift');
    assert.equal(gifts.find(event => event.recipient === 'Second recipient')?.displayName, 'Second Gifter');
    assert.equal(gifts.find(event => event.recipient === 'Third recipient')?.displayName, 'Anonyme');
    const resub = gifts.find(event => event.subType === 'resub')!;
    assert.equal(resub.displayName, 'Subscriber');
    assert.equal(resub.months, 12);
    assert.equal(resub.recipient, undefined);
    assert.ok(!JSON.stringify(gifts).includes('not-a-name'));
  });

  it('preserves the supplied donation amount label without inventing a currency', () => {
    const donation = cloud('donations', [row('donation', 1, { amount: '5.25', formatted_amount: '5,25 €', data: { donor: 'secret-donor', points: 1 } })])[0];
    assert.equal(donation.amount, 5.25);
    assert.equal(donation.amountLabel, '5,25 €');
    assert.equal(donation.currency, undefined);
    assert.ok(!JSON.stringify(donation).includes('secret-donor'));
    assert.equal(cloud('donations', [row('donation', 2, { amount: 10, currency: 'EURO', formatted_amount: '10 €' })])[0].currency, undefined);
    assert.equal(cloud('donations', [row('donation', 3, { amount: 10, currency: 'eur' })])[0].currency, 'EUR');
    assert.equal(cloud('bits', [row('bits', 4, { amount: '250' })])[0].count, 250);
    assert.equal(cloud('raids', [row('raid', 5, { raiders: '17' })])[0].count, 17);
    assert.equal(cloud('bits', [row('bits', 6, { amount: true })])[0].count, undefined);
  });

  it('keeps two follows by the same numeric user id when their dates differ', () => {
    const first = row('follow', 123, { created_at: '2026-09-01 12:00:00', name: 'Ada' });
    const second = row('follow', 123, { created_at: '2026-10-01 12:00:00', name: 'Ada' });
    const result = cloud('follows', [first, second, first]);
    assert.equal(result.length, 2);
    assert.notEqual(result[0].id, result[1].id);
    assert.deepEqual(result.map(event => event.occurredAt), ['2026-10-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z']);
  });
});

describe('Streamlabs local/cloud history merge', () => {
  it('sorts backfill by real activity date before retention and preserves the existing cache on repeat imports', () => {
    const local = socket('follow', 'live', '2026-10-20T14:00:00.000Z');
    const old = cloud('follows', [row('follow', 1, { created_at: '2026-09-01 12:00:00' })]);
    const recovered = cloud('follows', [row('follow', 2, { created_at: '2026-10-20 12:00:00' })], laterImport);
    const merged = mergeStreamlabsHistory([local], [...old, ...recovered]);
    assert.deepEqual(merged.map(event => event.id), [local.id, recovered[0].id, old[0].id]);
    assert.deepEqual(mergeStreamlabsHistory([local], [...old, ...recovered], 2).map(event => event.id), [local.id, recovered[0].id]);
    const oldCache = normalizeStreamlabsHistory(representativeResponse(), importedAt);
    const repeatedImport = normalizeStreamlabsHistory(representativeResponse(), laterImport);
    assert.deepEqual(mergeStreamlabsHistory(oldCache, repeatedImport), oldCache);
  });

  it('matches an exact shared _id without overwriting local display fields or receipt time', () => {
    const local = socket('subscription', 'shared-id', '2026-10-20 12:00:00', { name: 'Local name', message: 'Local message', sub_type: 'resub', months: 12 });
    const imported = cloud('subscriptions', [row('subscription', 999, {
      _id: 'shared-id', created_at: '2026-10-20 12:00:00', name: 'Cloud name', message: 'Cloud message', sub_type: 'resub', months: 3,
    })], laterImport)[0];
    assert.equal(local.id, imported.id);
    const merged = mergeStreamlabsHistory([local], [imported]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].displayName, 'Local name');
    assert.equal(merged[0].message, 'Local message');
    assert.equal(merged[0].months, 12);
    assert.equal(merged[0].receivedAt, local.receivedAt);
    assert.equal(merged[0].occurredAt, '2026-10-20T12:00:00.000Z');
    assert.equal(merged[0].origin, undefined);
    assert.deepEqual(mergeStreamlabsHistory([imported], [local]), merged);
  });

  it('retains legacy local entries and avoids unsafe name/amount or cross-platform deduplication', () => {
    const local = normalizeStreamlabsEvents({ type: 'donation', message: [{ id: 5, name: 'Ada', amount: 5, currency: 'EUR', created_at: '2026-10-18T12:00:00Z' }] }, importedAt)[0];
    const imported = cloud('donations', [row('donation', 5, { name: 'Ada', amount: 5, currency: 'EUR' })])[0];
    assert.notEqual(local.id, imported.id);
    assert.equal(mergeStreamlabsHistory([local], [imported]).length, 2);
    const legacy = { ...socket('communitygift', 'legacy'), id: 'legacy-id', occurredAt: null };
    const otherPlatform = { ...legacy, platform: 'youtube' as const };
    const result = mergeStreamlabsHistory([legacy, otherPlatform], [imported]);
    assert.equal(result.length, 3);
    assert.ok(result.some(event => event.id === legacy.id && event.platform === 'twitch'));
    assert.ok(result.some(event => event.id === legacy.id && event.platform === 'youtube'));
  });

  it('keeps undated cloud events at the end rather than using their recent import time', () => {
    const undated = cloud('follows', [row('follow', 1, { _id: 'undated', created_at: undefined })], laterImport)[0];
    const old = cloud('follows', [row('follow', 2, { created_at: '2025-01-01 00:00:00' })])[0];
    const local = { ...socket('follow', 'legacy-undated'), occurredAt: null };
    assert.deepEqual(mergeStreamlabsHistory([local], [undated, old]).map(event => event.id), [local.id, old.id, undated.id]);
  });

  it('filters existing technical traffic before the limit and does not mutate either input', () => {
    const local = Object.freeze(socket('follow', 'legitimate'));
    const imported = Object.freeze(cloud('follows', [row('follow', 2)])[0]);
    const controls = ['rollendcredits', 'sessionreset', 'userstatesessionreset'].map((type, index) => Object.freeze({ ...local, id: `control-${index}`, type }));
    const localItems = Object.freeze([local, ...controls]);
    const cloudItems = Object.freeze([imported]);
    const before = structuredClone([localItems, cloudItems]);
    const result = mergeStreamlabsHistory(localItems, cloudItems, 2);
    assert.deepEqual(result.map(event => event.id), [local.id, imported.id]);
    assert.deepEqual([localItems, cloudItems], before);
    result[0].displayName = 'Only the returned copy changed';
    assert.equal(local.displayName, 'Ada');
    assert.deepEqual(mergeStreamlabsHistory(localItems, cloudItems, 0), []);
  });
});
