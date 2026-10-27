/*!
Third-party dependency: crypto-js
# License

[The MIT License (MIT)](http://opensource.org/licenses/MIT)

Copyright (c) 2009-2013 Jeff Mott
Copyright (c) 2013-2016 Evan Vosberg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


Third-party dependency: entities
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/
import "./generated/chunk-4PA44XFR.js";
import {
  defaultProductProfile,
  validateProductProfile
} from "./generated/chunk-FDSEGT56.js";
import {
  randomUuid
} from "./generated/chunk-UG4HWAPN.js";
import {
  assertGoogleMaterializedAllDay,
  generateTwitchTags,
  googleRecurrence,
  mergeStreamlabsHistory,
  normalizeStreamlabsHistory,
  parseGoogleRecurrence,
  parseWizeBotCatalog
} from "./generated/chunk-VBREQPCP.js";
import {
  createBinaryHash,
  createHash
} from "./generated/chunk-Y3BQ3A62.js";
import "./generated/chunk-N7R4DDI7.js";

// apps/mobile/shared/recurrence.js
function migrateRecurrence(rule) {
  if (!rule || ![void 0, 1, 2].includes(rule.version) || !["daily", "weekly", "monthly"].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1 || rule.version !== 2 && !(rule.interval === 1 || rule.interval === 2) || rule.custom && (rule.version !== 2 || typeof rule.custom.engine !== "string" || !rule.custom.engine || !Number.isSafeInteger(rule.custom.version) || rule.custom.version < 1 || !rule.custom.parameters || typeof rule.custom.parameters !== "object" || Array.isArray(rule.custom.parameters))) {
    throw new Error("Version ou r\xE8gle de r\xE9currence non prise en charge.");
  }
  return { ...structuredClone(rule), version: 2 };
}
var DAY = 864e5;
var pad = (value) => String(value).padStart(2, "0");
var wallKey = (v) => `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}`;
var wallEpoch = (v) => Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
function instant(value) {
  const result = +new Date(value);
  if (!Number.isFinite(result))
    throw new Error("Invalid recurrence date");
  return result;
}
function bounds(window) {
  const start = instant(window.windowStart), end = instant(window.windowEnd);
  if (end <= start)
    throw new Error("Invalid projection window");
  return [start, end];
}
function clock(zone) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (at) => Object.fromEntries(formatter.formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const resolve = (wall) => {
    const target = wallEpoch(wall);
    const offsets = new Set([-2, -1, 0, 1, 2].map((days) => {
      const probe = target + days * DAY;
      return wallEpoch(parts(probe)) - probe;
    }));
    const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
    return candidates.find((at) => wallEpoch(parts(at)) === target) ?? Math.max(...candidates);
  };
  return { parts, resolve };
}
function schedule(anchor, rule) {
  if (!["daily", "weekly", "monthly"].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1)
    throw new Error("Invalid recurrence cadence");
  const stride = rule.interval * (rule.frequency === "weekly" ? 7 : 1);
  return (step) => {
    if (rule.frequency === "monthly") {
      const monthIndex = anchor.year * 12 + anchor.month - 1 + step * stride;
      const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
      return { ...anchor, year, month, day: Math.min(anchor.day, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
    }
    const date = new Date(wallEpoch(anchor) + step * stride * DAY);
    return { ...anchor, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  };
}
function projectRecurrence(source, window) {
  if (source.deletionPending) return [];
  const counted = window.nextCount !== void 0;
  if (counted && (!Number.isSafeInteger(window.nextCount) || window.nextCount < 1 || window.nextCount > 1e4))
    throw new Error("Invalid nextCount (1\u201310000 required)");
  const [from, to] = counted ? [instant(window.windowStart), Infinity] : bounds(window);
  if (!source.recurrence || source.occurrenceKey)
    throw new Error("Expected a canonical recurring master");
  const rule = migrateRecurrence(source.recurrence);
  if (rule.custom)
    throw new Error("Moteur de r\xE9currence requis : " + rule.custom.engine);
  const start = instant(source.startAtUtc), duration = instant(source.endAtUtc) - start;
  if (duration <= 0)
    throw new Error("Invalid recurrence duration");
  const until = rule.until == null ? Infinity : instant(rule.until);
  const { parts, resolve } = clock(rule.timeZone || "Europe/Paris");
  const anchor = parts(start), at = schedule(anchor, rule);
  const seriesId = source.localId || source.id;
  if (!seriesId)
    throw new Error("Missing series identity");
  const key = (wall) => `${seriesId}:${wallKey(wall)}`;
  const seek = (target) => {
    let low = 0, high = 1;
    while (resolve(at(high)) < target)
      high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (resolve(at(mid)) < target)
        low = mid + 1;
      else
        high = mid;
    }
    return low;
  };
  const candidates = /* @__PURE__ */ new Map();
  for (const exceptionKey of Object.keys(rule.exceptions ?? {})) {
    const prefix = `${seriesId}:`;
    if (!exceptionKey.startsWith(prefix))
      continue;
    const local = exceptionKey.slice(prefix.length);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
      continue;
    const target = Date.parse(`${local}Z`);
    if (!Number.isFinite(target))
      continue;
    let low = 0, high = 1;
    while (wallEpoch(at(high)) < target)
      high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (wallEpoch(at(mid)) < target)
        low = mid + 1;
      else
        high = mid;
    }
    const wall = at(low);
    if (key(wall) === exceptionKey && resolve(wall) <= until)
      candidates.set(exceptionKey, wall);
  }
  const output = /* @__PURE__ */ new Map();
  const add = (occurrenceKey, wall) => {
    const exception = rule.exceptions?.[occurrenceKey];
    if (exception?.cancelled)
      return;
    const original = resolve(wall);
    const item = {
      ...structuredClone(source),
      ...structuredClone(exception?.patch ?? {}),
      id: `${source.id}::${wallKey(wall)}`,
      seriesId: source.id,
      occurrenceKey,
      recurrence: structuredClone(source.recurrence),
      startAtUtc: exception?.patch?.startAtUtc ?? new Date(original).toISOString(),
      endAtUtc: exception?.patch?.endAtUtc ?? new Date(original + duration).toISOString()
    };
    const effectiveStart = instant(item.startAtUtc), effectiveEnd = instant(item.endAtUtc);
    if (effectiveEnd <= effectiveStart)
      throw new Error("Invalid occurrence duration");
    if (effectiveStart < to && effectiveEnd > from && (!window.accept || window.accept(item)))
      output.set(occurrenceKey, item);
  };
  for (const [occurrenceKey, wall] of candidates) add(occurrenceKey, wall);
  const sorted = () => [...output.values()].sort((a, b) => instant(a.startAtUtc) - instant(b.startAtUtc) || (a.occurrenceKey < b.occurrenceKey ? -1 : a.occurrenceKey > b.occurrenceKey ? 1 : 0));
  let scanned = 0;
  for (let step = seek(from - duration - 2 * DAY); ; step++) {
    if (++scanned > 1e5) throw new Error("Recurrence scan limit exceeded");
    const wall = at(step), original = resolve(wall);
    if (!Number.isFinite(original)) throw new Error("Invalid recurrence cadence range");
    if (original >= to || original > until) break;
    if (counted && output.size >= window.nextCount && original > instant(sorted()[window.nextCount - 1].startAtUtc)) break;
    add(key(wall), wall);
  }
  return counted ? sorted().slice(0, window.nextCount) : sorted();
}
function expandRecurringItems(items, { from, to, nextCount, accept }) {
  const [start, end] = nextCount === void 0 ? bounds({ windowStart: from, windowEnd: to }) : [instant(from), Infinity];
  return (items || []).flatMap((item) => item.deletionPending ? [structuredClone(item)] : item.recurrence && !item.occurrenceKey ? projectRecurrence(item, { windowStart: from, windowEnd: to, nextCount, accept }) : Date.parse(item.startAtUtc) < end && (Number.isFinite(Date.parse(item.endAtUtc)) ? Date.parse(item.endAtUtc) > start : Date.parse(item.startAtUtc) >= start) ? [structuredClone(item)] : []).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
}
function recurrenceForNewSeries(rule, id) {
  if (!rule) return rule;
  const copy = structuredClone(rule);
  if (copy.exceptions) copy.exceptions = Object.fromEntries(Object.entries(copy.exceptions).map(([key, value]) => {
    const match = key.match(/:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/);
    return [match ? `${id}:${match[1]}` : key, value];
  }));
  return copy;
}

// scripts/mobile-sync-shim.js
var syncBatch = (work) => work();
var measureSync = (_provider, _phase, work) => work();
async function boundedMap(values, work) {
  for (const value of values) await work(value);
}

// packages/core/src/series-deletion.ts
async function recoverIdentity(identity, name, provider, persist) {
  if (!identity.uncertainCreate) return;
  if (!provider?.recoverCreation) throw new Error(`${name} : r\xE9cup\xE9ration en lecture seule indisponible. Reconnectez le provider puis r\xE9essayez la suppression.`);
  const original = structuredClone(identity.uncertainCreate.event);
  const recovered = await provider.recoverCreation({ ...original, providers: { [name]: identity } });
  if (!recovered.id || recovered.owned !== true) throw new Error(`${name} : ownership non \xE9tabli. V\xE9rifiez l\u2019identit\xE9 distante avant de r\xE9essayer.`);
  identity.remoteId = recovered.id;
  identity.remoteRevision = recovered.revision;
  identity.fingerprint = recovered.fingerprint;
  identity.calendarId = recovered.calendarId ?? identity.calendarId;
  identity.projectionOwned = true;
  identity.status = "pending";
  if ("event" in identity) identity.event = original;
  delete identity.uncertainCreate;
  delete identity.lastError;
  await persist();
}
async function recoverSeriesDeletionIdentities(item, providers, persist) {
  for (const name of ["twitch", "google"]) {
    const link = item.providers?.[name];
    if (!link) continue;
    let recovered = false;
    for (const identity of [link, ...Object.values(link.projections ?? {}).filter((entry) => entry.managedBy === "StreamDashboard" && entry.projectionOwned !== false)]) {
      if (!identity.uncertainCreate) continue;
      try {
        await recoverIdentity(identity, name, providers[name], persist);
        recovered = true;
      } catch (error) {
        identity.status = "error";
        identity.lastError = error.message;
        link.status = "error";
        link.lastError = `Suppression en attente : ${identity.lastError}`;
        await persist();
      }
    }
    if (recovered && ![link, ...Object.values(link.projections ?? {})].some((identity) => identity.uncertainCreate)) {
      link.status = "error";
      link.lastError = "Suppression en attente : identit\xE9 retrouv\xE9e. R\xE9essayez la suppression pour terminer le nettoyage distant.";
      await persist();
    }
  }
}
async function deleteSeriesProjections(item, providers, save, retry = false) {
  let saves = Promise.resolve();
  let queued;
  const persist = () => {
    if (!queued) {
      queued = saves.then(() => {
        queued = void 0;
        return save();
      });
      saves = queued;
    }
    return queued;
  };
  const failures = [];
  for (const name of ["twitch", "google"]) {
    const link = item.providers?.[name];
    if (!link) continue;
    if (name === "twitch" && link.projectionOwned && !link.remoteId) link.remoteId = item.twitchSegmentId;
    const remove = async (identity, event) => {
      if (identity.uncertainCreate) {
        const original = structuredClone(identity.uncertainCreate.event);
        await recoverIdentity(identity, name, providers[name], persist);
        event = { ...original, providers: { [name]: identity } };
      }
      if (!identity.remoteId) return;
      const provider = providers[name];
      if (!provider) throw new Error(`${name} non connect\xE9.`);
      if (identity.status === "conflict") {
        if (!retry) throw Object.assign(new Error("Conflit distant : r\xE9essayez explicitement la suppression pour confirmer le retrait courant."), { status: 412 });
        if (!provider.read) throw new Error("Lecture distante requise pour confirmer la suppression en conflit.");
        const latest = await provider.read(identity.remoteId, event, { resolveConflict: true });
        if (latest.deleted) {
          delete identity.remoteId;
          delete identity.remoteRevision;
          await persist();
          return;
        }
        if (name === "google" && !latest.revision) throw new Error("ETag courant requis pour supprimer.");
        if (name === "twitch" && !latest.fingerprint) throw new Error("Empreinte courante requise pour supprimer.");
        identity.remoteRevision = latest.revision;
        identity.fingerprint = latest.fingerprint;
      }
      identity.status = "pending";
      try {
        await provider.delete(identity.remoteId, event, identity.remoteRevision);
      } catch (error) {
        const failure = error;
        if (![404, 410].includes(failure.status ?? 0) && failure.code !== "DELETED_REMOTELY") throw error;
      }
      delete identity.remoteId;
      delete identity.remoteRevision;
      delete identity.fingerprint;
      identity.status = "not-published";
      delete identity.lastError;
      await persist();
    };
    const attempt = async (identity, event) => {
      try {
        await remove(identity, event);
        return true;
      } catch (error) {
        const failure = error;
        identity.status = identity.status === "conflict" || failure.status === 412 || ["CONFLICT", "GOOGLE_PROJECTION_CONFLICT"].includes(failure.code ?? "") ? "conflict" : "error";
        identity.lastError = error.message;
        failures.push(`${name}: ${identity.lastError}`);
        await persist();
        return false;
      }
    };
    if (link.projectionOwned === true || link.uncertainCreate) {
      if (await attempt(link, { ...item, providers: { [name]: link } })) {
        if (name === "twitch") delete item.twitchSegmentId;
      }
    }
    await boundedMap(Object.entries(link.projections ?? {}), async ([key, entry]) => {
      if (entry.managedBy !== "StreamDashboard" || entry.projectionOwned === false) return;
      entry.pendingDeletion = true;
      const { recurrence, seriesId, occurrenceKey, providers: ignored, conflict, twitchSegmentId, ...body } = entry.event;
      const event = { ...body, twitchRecurring: false, providers: { [name]: entry } };
      if (await attempt(entry, event)) delete link.projections[key];
    });
    if (failures.some((value) => value.startsWith(name + ":"))) {
      if (link.status !== "conflict") link.status = "error";
      link.lastError = `Suppression de s\xE9rie en attente. R\xE9essayez la suppression : ${failures.filter((value) => value.startsWith(name + ":")).join("; ")}`;
    } else {
      delete item.providers[name];
      if (item.conflict?.provider === name) delete item.conflict;
    }
    await persist();
  }
  if (failures.length) throw new Error(`Suppression de s\xE9rie incompl\xE8te. R\xE9essayez la suppression : ${failures.join("; ")}`);
}

// integrations/twitch/src/recurrence.ts
function assertTwitchRecurrence(item) {
  const rule = item.recurrence;
  const fail = () => {
    throw Object.assign(new Error("Twitch : r\xE9currence non repr\xE9sentable ; seules les s\xE9ries weekly-1 sans fin ni exceptions sont accept\xE9es."), { mutationNotStarted: true });
  };
  if (item.seriesId || item.occurrenceKey) fail();
  if (!rule) {
    if (item.ownership === "LOCAL" && item.twitchRecurring && item.providers?.twitch?.projectionOwned && item.providers.twitch.projectionMode === "native") fail();
    return;
  }
  if (rule.custom || ![void 0, 1, 2].includes(rule.version) || rule.frequency !== "weekly" || rule.interval !== 1 || rule.until || Object.keys(rule.exceptions ?? {}).length || !rule.timeZone) fail();
  try {
    new Intl.DateTimeFormat("en", { timeZone: rule.timeZone });
  } catch {
    fail();
  }
}

// integrations/twitch/src/create-request.ts
var prepared = /* @__PURE__ */ new WeakSet();
function twitchCreateRequest(item, now = Date.now()) {
  if (item.deletionPending)
    throw Object.assign(new Error("Suppression en attente : cr\xE9ation Twitch interdite."), { mutationNotStarted: true });
  if (prepared.has(item))
    return item;
  assertTwitchRecurrence(item);
  const request3 = structuredClone(item);
  if (item.recurrence && Date.parse(item.startAtUtc) <= now) {
    const next = expandRecurringItems([item], { from: now, nextCount: 1, accept: (value) => Date.parse(value.startAtUtc) > now })[0];
    if (!next)
      throw Object.assign(new Error("Aucune occurrence Twitch future valide."), { mutationNotStarted: true });
    request3.startAtUtc = next.startAtUtc;
    request3.endAtUtc = next.endAtUtc;
  }
  prepared.add(request3);
  return request3;
}

// apps/mobile/shared/publication-content.js
function publicationContent(event, provider) {
  const fields = provider === "twitch" ? [event.title || "", event.startAtUtc || "", event.endAtUtc || "", event.twitchCategoryId || ""] : [event.title || "", event.description || "", event.startAtUtc || "", event.endAtUtc || "", Boolean(event.allDay)];
  return JSON.stringify([
    ...fields,
    event.recurrence || null,
    event.seriesId || null,
    event.occurrenceKey || null,
    event.desiredPublication?.[provider] === true
  ], (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
}

// packages/core/src/provider-identity.ts
function assertProviderCreationCertain(item, provider) {
  if (item.providers?.[provider]?.uncertainCreate) {
    throw Object.assign(new Error("Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier."), {
      code: "PROVIDER_CREATE_UNCERTAIN"
    });
  }
}
function isDefinitiveCreateFailure(error) {
  const failure = error;
  return failure?.mutationNotStarted === true || [400, 401, 403, 404, 405, 410, 412, 413, 415, 422, 429].includes(failure?.status ?? 0);
}
async function createWithDurableIntent(item, provider, persist, create, prepare) {
  assertProviderCreationCertain(item, provider);
  if (item.deletionPending) throw Object.assign(new Error("Suppression en attente : cr\xE9ation interdite."), { mutationNotStarted: true });
  const link = (item.providers ??= {})[provider] ??= { status: "pending" };
  if (prepare) {
    const destination = await prepare(item);
    if (destination.calendarId) link.calendarId = destination.calendarId;
    if (link.accountId && destination.accountId && link.accountId !== destination.accountId) throw Object.assign(new Error("Reconnectez le compte propri\xE9taire de cette publication."), { mutationNotStarted: true });
    if (destination.accountId) link.accountId = destination.accountId;
  }
  const request3 = provider === "twitch" ? twitchCreateRequest(item) : structuredClone(item);
  const { providers: _providers, conflict: _conflict, ...original } = request3;
  link.uncertainCreate = {
    event: structuredClone(original),
    publishedContent: publicationContent(item, provider)
  };
  await persist();
  delete request3.providers[provider].uncertainCreate;
  let result;
  try {
    result = await create(request3);
  } catch (error) {
    if (isDefinitiveCreateFailure(error)) {
      delete link.uncertainCreate;
      await persist();
    }
    throw error;
  }
  if (!result.id) throw new Error("Cr\xE9ation distante accept\xE9e sans identit\xE9. R\xE9conciliation requise.");
  link.remoteId = result.id;
  link.remoteRevision = result.revision;
  link.fingerprint = result.fingerprint;
  link.calendarId = result.calendarId ?? link.calendarId;
  delete link.uncertainCreate;
  return result;
}

// packages/core/src/provider-projection.ts
function projectionContent(item, name) {
  return JSON.stringify(name === "twitch" ? [item.title, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? ""] : [item.title, item.description, item.allDay, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? ""]);
}
function request(event, link, name) {
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  if (name === "google" && body.projection?.mode === "materialized") body.projection = { ...body.projection, creationId: link.creationId };
  return { ...body, twitchRecurring: false, providers: { [name]: link } };
}
function reconcileProviderProjection(...args) {
  const [item, original, save, options] = args;
  if (item.deletionPending) return Promise.resolve(true);
  if (!options.materialized && !item.providers?.[options.name]?.projections && !item.providers?.[options.name]?.nativeReplacementRequested && !(options.name === "google" && item.providers?.google?.nativeRetained)) return Promise.resolve(false);
  let saves = Promise.resolve();
  let queued;
  const persist = () => {
    if (!queued) {
      queued = saves.then(() => {
        queued = void 0;
        return save();
      });
      saves = queued;
    }
    return queued;
  };
  const provider = original && {
    prepareCreate: original.prepareCreate && ((item2) => original.prepareCreate(item2)),
    read: original.read && ((...values) => measureSync(options.name, "read", () => original.read(...values))),
    create: (...values) => measureSync(options.name, "create", () => original.create(...values)),
    update: (...values) => measureSync(options.name, "update", () => original.update(...values)),
    delete: (...values) => measureSync(options.name, "delete", () => original.delete(...values))
  };
  return measureSync(options.name, "total", () => syncBatch(() => measureSync(options.name, "rolling", () => reconcileProjection(item, provider, persist, options))));
}
async function reconcileProjection(item, provider, persist, options) {
  const { name, materialized } = options;
  if (name === "google" && item.providers?.google?.nativeRetained && item.providers.google.remoteId && item.desiredPublication?.google) return true;
  if (!materialized && !item.providers?.[name]?.projections && !item.providers?.[name]?.nativeReplacementRequested) return false;
  if (item.ownership !== "LOCAL") return true;
  const link = (item.providers ??= {})[name] ??= { status: "pending" };
  if (name === "google" && options.explicitWithdrawal && item.desiredPublication?.google === false) {
    link.nativeWithdrawalRequested = true;
    await persist();
  }
  const desired = item.desiredPublication?.[name] === true;
  const fail = (target, error) => {
    const failure = error;
    target.status = failure.code === "CONFLICT" || failure.code === "GOOGLE_PROJECTION_CONFLICT" || failure.status === 412 ? "conflict" : "error";
    target.lastError = error instanceof Error ? error.message : String(error);
    if (failure.code === "GOOGLE_PROJECTION_RETIRED" || failure.code === "DELETED_REMOTELY" || [404, 410].includes(failure.status ?? 0)) target.deletedRemotely = true;
  };
  if (link.uncertainCreate || desired && link.deletedRemotely && !options.retry) {
    fail(link, new Error(link.uncertainCreate ? `Cr\xE9ation native distante incertaine : ${name === "twitch" ? "v\xE9rifiez le planning dans Twitch. Aucune identit\xE9 candidate ne sera adopt\xE9e ou republi\xE9e automatiquement." : "r\xE9conciliez son identit\xE9 avant de mat\xE9rialiser."}` : "S\xE9rie supprim\xE9e \xE0 distance \u2014 retry explicite requis."));
    await persist();
    return true;
  }
  const entries = link.projections ??= {};
  const now = options.now ?? Date.now();
  const bounds2 = { from: new Date(now).toISOString(), nextCount: 7 };
  link.projectionWindow = bounds2;
  const recover = async (entry) => {
    if (!provider || !entry.uncertainCreate || name !== "google" || entry.event.projection?.mode !== "materialized") return;
    const original = request(entry.uncertainCreate.event, { ...entry, uncertainCreate: void 0 }, name);
    try {
      const recovered = await provider.create(original);
      entry.remoteId = recovered.id;
      entry.remoteRevision = recovered.revision;
      entry.calendarId = recovered.calendarId ?? entry.calendarId;
    } catch (error) {
      if (error.code !== "GOOGLE_PROJECTION_RETIRED") throw error;
      entry.deletedRemotely = true;
      delete entry.remoteId;
      delete entry.remoteRevision;
    }
    delete entry.uncertainCreate;
    await persist();
  };
  const expected = /* @__PURE__ */ new Map();
  if (desired && materialized) {
    for (const occurrence of (options.expand ?? expandRecurringItems)([{ ...item, providers: void 0 }], {
      ...bounds2,
      accept: (occurrence2) => occurrence2.desiredPublication?.[name] !== false && !(name === "google" && link.projectionRetirements?.[occurrence2.occurrenceKey]?.retained)
    })) {
      if (occurrence.occurrenceKey && expected.has(occurrence.occurrenceKey)) throw new Error("Duplicate projected occurrence identity");
      if (!occurrence.occurrenceKey) throw new Error("Le moteur doit fournir une occurrenceKey stable.");
      if (name === "google" && link.projectionRetirements?.[occurrence.occurrenceKey]?.retained) continue;
      if (occurrence.desiredPublication?.[name] !== false && Date.parse(occurrence.endAtUtc) > now) {
        expected.set(occurrence.occurrenceKey, request(occurrence, { status: "pending", projectionOwned: true, calendarId: link.calendarId }, name));
      }
    }
  }
  if (link.remoteId || name === "twitch" && item.twitchSegmentId) {
    if (link.status === "conflict" || item.conflict?.provider === name) return true;
    if (!link.projectionOwned && !(name === "google" && !desired && link.nativeWithdrawalRequested) || !provider) {
      fail(link, new Error(`Retirez explicitement la publication ${name} existante avant de mat\xE9rialiser cette s\xE9rie.`));
      await persist();
      return true;
    }
    try {
      if (name === "google") {
        link.nativeWithdrawalRequested = true;
        await persist();
      }
      if (name === "twitch" && provider.read) {
        const remote = await provider.read(link.remoteId ?? item.twitchSegmentId, item);
        if (!remote.deleted && link.fingerprint && remote.fingerprint !== link.fingerprint) {
          throw Object.assign(new Error("La s\xE9rie Twitch a chang\xE9 \xE0 distance. R\xE9solvez le conflit avant son remplacement."), { code: "CONFLICT" });
        }
      }
      await provider.delete(link.remoteId ?? item.twitchSegmentId, item, link.remoteRevision);
      delete link.remoteId;
      delete link.remoteRevision;
      delete link.fingerprint;
      delete link.nativeWithdrawalRequested;
      if (name === "twitch") {
        delete item.twitchSegmentId;
        item.twitchRecurring = false;
        if (materialized || !desired) delete link.nativeReplacementRequested;
      }
      await persist();
    } catch (error) {
      fail(link, error);
      await persist();
      return true;
    }
  }
  await boundedMap(Object.entries(entries), async ([key, entry]) => {
    if (expected.has(key) && !entry.pendingDeletion || entry.managedBy !== "StreamDashboard") return;
    try {
      if (name === "google") {
        entry.pendingDeletion = true;
        await persist();
        if (entry.status === "conflict") return;
      }
      await recover(entry);
      if (entry.uncertainCreate) throw new Error("Cr\xE9ation distante incertaine : identit\xE9 \xE0 r\xE9concilier avant nettoyage.");
      if (entry.remoteId) {
        if (!provider) throw new Error(`${name} non connect\xE9.`);
        try {
          await provider.delete(entry.remoteId, request(entry.event, entry, name), entry.remoteRevision);
        } catch (error) {
          if (![404, 410].includes(error.status ?? 0) && error.code !== "DELETED_REMOTELY") throw error;
        }
      }
      if (name === "google") (link.projectionRetirements ??= {})[key] = { calendarId: entry.calendarId, creationId: randomUuid() };
      delete entries[key];
      expected.delete(key);
    } catch (error) {
      fail(entry, error);
    }
    await persist();
  });
  await boundedMap([...expected], async ([key, event]) => {
    let entry = entries[key];
    if (entry && entry.managedBy !== "StreamDashboard") return;
    if (!entry) {
      const retired = name === "google" ? link.projectionRetirements?.[key] : void 0;
      entry = entries[key] = {
        occurrenceKey: key,
        managedBy: "StreamDashboard",
        event,
        status: "pending",
        projectionOwned: true,
        calendarId: retired?.calendarId ?? link.calendarId,
        accountId: link.accountId ?? Object.values(entries).find((value) => value.accountId)?.accountId,
        creationId: retired?.creationId
      };
      if (retired) delete link.projectionRetirements[key];
    }
    try {
      if (entry.pendingDeletion) return;
      if (entry.status === "conflict") return;
      if (!provider) throw new Error(`${name} non connect\xE9.`);
      await recover(entry);
      if (entry.uncertainCreate) throw new Error("Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier.");
      let observed;
      if (entry.remoteId && provider.read) {
        const remote = observed = await provider.read(entry.remoteId, request(entry.event, entry, name));
        if (remote.deleted) entry.deletedRemotely = true;
        else if (entry.fingerprint && remote.fingerprint && entry.fingerprint !== remote.fingerprint || name === "google" && entry.remoteRevision && remote.revision && entry.remoteRevision !== remote.revision) {
          throw Object.assign(new Error(`Occurrence modifi\xE9e \xE0 distance : conflit ${name}.`), { code: "CONFLICT" });
        }
      }
      if (entry.deletedRemotely) {
        if (!options.retry) throw new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis.");
        if (entry.remoteId && !provider.read) throw new Error("Lecture distante requise avant republication.");
        const remote = entry.remoteId ? observed ?? await provider.read(entry.remoteId, request(entry.event, entry, name)) : void 0;
        if (!remote || remote.deleted) {
          delete entry.remoteId;
          delete entry.fingerprint;
          delete entry.remoteRevision;
          if (name === "google") entry.creationId = randomUuid();
        }
        entry.deletedRemotely = false;
      }
      const content = projectionContent(event, name);
      const sameAppliedContent = entry.appliedContent === content || name === "twitch" && entry.appliedContent === projectionContent(entry.event) && projectionContent(entry.event, name) === content;
      if (!entry.remoteId || !sameAppliedContent || entry.status !== "synced") {
        entry.status = "pending";
        if (entry.remoteId) await persist();
        const body = request(event, entry, name);
        if (entry.remoteId) {
          const result = await provider.update(entry.remoteId, body, entry.remoteRevision);
          entry.fingerprint = result.fingerprint;
          entry.remoteRevision = result.revision;
        } else {
          const result = await createWithDurableIntent(body, name, persist, (value) => provider.create(value), provider.prepareCreate);
          entry.calendarId = result.calendarId ?? entry.calendarId;
          entry.remoteId = result.id;
          entry.fingerprint = result.fingerprint;
          entry.remoteRevision = result.revision;
        }
        entry.event = { ...event, projection: body.projection };
        entry.appliedContent = content;
        entry.status = "synced";
        entry.lastSyncedAt = new Date(now).toISOString();
        delete entry.lastError;
      } else {
        entry.event = { ...event, projection: entry.event.projection ?? event.projection };
        entry.appliedContent = content;
        return;
      }
    } catch (error) {
      fail(entry, error);
    }
    await persist();
  });
  summarizeProjection(item, name, now);
  await persist();
  if (!materialized && !Object.keys(entries).length) {
    delete link.projections;
    delete link.projectionWindow;
    await persist();
    return false;
  }
  return true;
}
function summarizeProjection(item, name, now = Date.now()) {
  const link = item.providers[name];
  const desired = item.desiredPublication?.[name] === true;
  link.projectionMode = "materialized";
  const failures = Object.values(link.projections ?? {}).filter((entry) => entry.status === "error" || entry.status === "conflict");
  link.status = failures.length ? "error" : Object.values(link.projections ?? {}).some((entry) => entry.status === "pending") ? "pending" : desired ? "synced" : "not-published";
  if (failures.length) link.lastError = `${failures.length} occurrence(s) ${name} en erreur : ${failures[0].lastError}`;
  else {
    delete link.lastError;
    link.deletedRemotely = false;
    link.lastSyncedAt = new Date(now).toISOString();
  }
  if (name === "twitch" && ["synced", "not-published"].includes(link.status)) delete item.syncError;
}

// integrations/google-calendar/src/projection.ts
function googleProjectionLocalId(identity) {
  return identity.mode === "master" ? identity.seriesLocalId : `sd-occ-${createHash("sha256").update(JSON.stringify([identity.seriesLocalId, identity.occurrenceKey])).digest("hex")}`;
}
function projectGoogleSeries(item, window, source = { expand: expandRecurringItems }) {
  if (item.seriesId || item.occurrenceKey) throw new Error("Une projection exige une s\xE9rie canonique.");
  const seriesLocalId = item.localId || item.id;
  if (!seriesLocalId) throw new Error("Identit\xE9 de s\xE9rie manquante.");
  if (item.recurrence) migrateRecurrence(item.recurrence);
  if (!Number.isFinite(Date.parse(item.startAtUtc)) || !Number.isFinite(Date.parse(item.endAtUtc)) || Date.parse(item.endAtUtc) <= Date.parse(item.startAtUtc)) throw new Error("Dates de s\xE9rie invalides.");
  if (item.recurrence) {
    if (!item.recurrence.timeZone) throw new Error("Fuseau de s\xE9rie requis.");
    new Intl.DateTimeFormat("en", { timeZone: item.recurrence.timeZone });
    if (item.recurrence.until && (!Number.isFinite(Date.parse(item.recurrence.until)) || Date.parse(item.recurrence.until) < Date.parse(item.startAtUtc))) throw new Error("Fin de s\xE9rie invalide.");
  }
  try {
    googleRecurrence(item);
    const identity = { mode: "master", seriesLocalId };
    return { mode: "master", entries: [{ identity, input: { ...item, localId: seriesLocalId, projection: identity } }] };
  } catch (error) {
    if (!item.recurrence) throw error;
  }
  const from = +new Date(window.from);
  const to = window.nextCount === void 0 ? +new Date(window.to) : Infinity;
  if (!Number.isFinite(from) || window.nextCount === void 0 && !Number.isFinite(to) || to <= from) throw new Error("Fen\xEAtre de projection invalide.");
  const keys = /* @__PURE__ */ new Set();
  const entries = source.expand([structuredClone(item)], window).map((occurrence) => {
    const key = occurrence.occurrenceKey;
    const start = Date.parse(occurrence.startAtUtc);
    const end = Date.parse(occurrence.endAtUtc);
    if (!key || occurrence.seriesId !== item.id || keys.has(key) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= to || end <= from) {
      throw new Error("Occurrence de projection invalide ou dupliqu\xE9e.");
    }
    keys.add(key);
    assertGoogleMaterializedAllDay(occurrence);
    const identity = { mode: "materialized", seriesLocalId, occurrenceKey: key };
    const input = {
      localId: googleProjectionLocalId(identity),
      projection: identity,
      desiredPublication: structuredClone(occurrence.desiredPublication),
      title: occurrence.title,
      description: occurrence.description,
      startAtUtc: occurrence.startAtUtc,
      endAtUtc: occurrence.endAtUtc,
      allDay: occurrence.allDay
    };
    return { identity, input };
  });
  return { mode: "materialized", window: { from: window.from, to: window.to, nextCount: window.nextCount }, entries };
}
function needsGoogleMaterialization(item) {
  if (!item.recurrence) return false;
  try {
    googleRecurrence(item);
    return false;
  } catch {
    return true;
  }
}
async function reconcileGoogleProjection(item, provider, persist, options = {}) {
  try {
    return await reconcileProviderProjection(item, provider, persist, {
      ...options,
      name: "google",
      materialized: needsGoogleMaterialization(item),
      expand: (items, window) => items.flatMap((master) => projectGoogleSeries(master, window).entries.map(({ input, identity }) => ({
        ...master,
        ...input,
        recurrence: void 0,
        seriesId: void 0,
        occurrenceKey: identity.mode === "materialized" ? identity.occurrenceKey : void 0
      })))
    });
  } catch (error) {
    const link = (item.providers ??= {}).google ??= { status: "error" };
    link.status = "error";
    link.lastError = error.message;
    await persist();
    return true;
  }
}
async function resolveGoogleOccurrenceConflict(item, key, strategy, provider, persist, restore) {
  const link = item.providers?.google;
  const entry = link?.projections?.[key];
  if (item.ownership !== "LOCAL" || !entry || entry.managedBy !== "StreamDashboard" || entry.status !== "conflict") throw new Error("Aucun conflit Google pour cette occurrence.");
  try {
    if (entry.pendingDeletion) {
      if (!entry.remoteId || !provider?.read) throw new Error("Lecture Google requise pour r\xE9soudre le retrait.");
      const body = { ...entry.event, providers: { google: entry } };
      if (body.projection?.mode === "materialized") body.projection = { ...body.projection, creationId: entry.creationId };
      const latest2 = await provider.read(entry.remoteId, body);
      if (!latest2.deleted && (!latest2.remote || !latest2.revision)) throw new Error("Version Google distante indisponible.");
      if (strategy === "remote") {
        if (latest2.deleted) throw new Error("Occurrence d\xE9j\xE0 supprim\xE9e : confirmez le retrait local.");
        if (!restore) throw new Error("Restauration locale indisponible.");
        const restored = {
          ...entry.event,
          ...latest2.remote,
          id: `${item.id}::google-retained::${key}`,
          projection: body.projection,
          recurrence: void 0,
          seriesId: void 0,
          occurrenceKey: void 0,
          desiredPublication: { local: true, twitch: false, google: true },
          ownership: "LOCAL",
          editable: true,
          providers: { google: { status: "synced", remoteId: entry.remoteId, calendarId: entry.calendarId, remoteRevision: latest2.revision } }
        };
        restore(restored);
        (link.projectionRetirements ??= {})[key] = { calendarId: entry.calendarId, creationId: entry.creationId ?? randomUuid(), retained: true };
        delete link.projections[key];
      } else {
        entry.remoteRevision = latest2.revision ?? entry.remoteRevision;
        entry.deletionDecision = "delete";
        entry.status = "pending";
        delete entry.lastError;
      }
      summarizeProjection(item, "google");
      await persist();
      return;
    }
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.google || !entry.remoteId || !provider?.read) throw new Error("Occurrence Google inactive ou lecture indisponible.");
    const latest = await provider.read(entry.remoteId, { ...entry.event, providers: { google: entry } });
    if (latest.deleted) throw Object.assign(new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis."), { code: "DELETED_REMOTELY" });
    if (!latest.remote || !latest.revision) throw new Error("Version Google distante indisponible.");
    const projected = projectGoogleSeries(item, { ...link.projectionWindow, accept: (occurrence) => occurrence.desiredPublication?.google !== false && !link.projectionRetirements?.[occurrence.occurrenceKey]?.retained }).entries.find((value) => value.identity.mode === "materialized" && value.identity.occurrenceKey === key);
    if (!projected) throw new Error("Occurrence hors fen\xEAtre : actualisez la projection.");
    let event = { ...entry.event, ...projected.input };
    if (event.projection?.mode === "materialized") event.projection = { ...event.projection, creationId: entry.creationId };
    entry.remoteRevision = latest.revision;
    await persist();
    if (strategy === "local") {
      const result = await provider.update(entry.remoteId, { ...event, providers: { google: entry } }, latest.revision);
      entry.remoteRevision = result.revision;
    } else {
      const patch = {
        title: latest.remote.title,
        description: latest.remote.description,
        startAtUtc: latest.remote.startAtUtc,
        endAtUtc: latest.remote.endAtUtc,
        allDay: latest.remote.allDay
      };
      assertGoogleMaterializedAllDay({ ...event, ...patch });
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key] = { ...exceptions[key], patch: { ...exceptions[key]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event;
    entry.appliedContent = projectionContent(event);
    entry.status = "synced";
    entry.deletedRemotely = false;
    delete entry.lastError;
    summarizeProjection(item, "google");
    await persist();
  } catch (error) {
    entry.deletedRemotely = error.code === "DELETED_REMOTELY";
    entry.status = entry.deletedRemotely ? "error" : "conflict";
    entry.lastError = error.message;
    summarizeProjection(item, "google");
    await persist();
    throw error;
  }
}

// integrations/twitch/src/projection.ts
function needsTwitchMaterialization(item) {
  if (!item.recurrence) return false;
  try {
    assertTwitchRecurrence(item);
    return false;
  } catch {
    return true;
  }
}
function request2(event, link) {
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  return { ...body, twitchRecurring: false, providers: { twitch: link } };
}
async function reconcileTwitchProjection(item, provider, persist, options = {}) {
  try {
    return await reconcileProviderProjection(item, provider, persist, { ...options, name: "twitch", materialized: needsTwitchMaterialization(item), expand: options.expand ?? expandRecurringItems });
  } catch (error) {
    const link = (item.providers ??= {}).twitch ??= { status: "error" };
    link.status = "error";
    link.lastError = error.message;
    await persist();
    return true;
  }
}
async function resolveTwitchOccurrenceConflict(item, key, strategy, provider, persist) {
  const link = item.providers?.twitch;
  const entry = link?.projections?.[key];
  if (item.ownership !== "LOCAL" || !entry || entry.managedBy !== "StreamDashboard" || entry.status !== "conflict") {
    throw new Error("Aucun conflit Twitch \xE0 r\xE9soudre pour cette occurrence.");
  }
  try {
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.twitch) throw new Error("Occurrence inactive : actualisez la projection Twitch.");
    if (!provider?.read || !entry.remoteId) throw new Error("Lecture distante Twitch requise pour r\xE9soudre cette occurrence.");
    const latest = await provider.read(entry.remoteId, request2(entry.event, entry));
    if (latest.deleted) throw Object.assign(new Error("Occurrence supprim\xE9e \xE0 distance \u2014 retry explicite requis."), { code: "DELETED_REMOTELY" });
    if (!latest.remote || !latest.fingerprint) throw new Error("Version ou empreinte distante indisponible.");
    const occurrence = expandRecurringItems([{ ...item, providers: void 0 }], { ...link.projectionWindow, accept: (occurrence2) => occurrence2.desiredPublication?.twitch !== false }).find((value) => value.occurrenceKey === key);
    if (!occurrence) throw new Error("Occurrence hors fen\xEAtre : actualisez la projection Twitch.");
    entry.fingerprint = latest.fingerprint;
    entry.remoteRevision = latest.revision;
    await persist();
    let event = request2(occurrence, { status: "pending", projectionOwned: true });
    if (strategy === "local") {
      const result = await provider.update(entry.remoteId, request2(event, entry), entry.remoteRevision);
      entry.fingerprint = result.fingerprint;
      entry.remoteRevision = result.revision;
    } else {
      const remote = latest.remote;
      const patch = {
        title: remote.title,
        startAtUtc: remote.startAtUtc,
        endAtUtc: remote.endAtUtc,
        twitchCategoryId: remote.twitchCategoryId ?? "",
        twitchCategoryName: remote.twitchCategoryName ?? ""
      };
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key] = { ...exceptions[key], patch: { ...exceptions[key]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event;
    entry.appliedContent = projectionContent(event, "twitch");
    entry.status = "synced";
    entry.deletedRemotely = false;
    entry.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
    delete entry.lastError;
    summarizeProjection(item, "twitch");
    await persist();
  } catch (error) {
    const deleted = error.code === "DELETED_REMOTELY";
    entry.status = deleted ? "error" : "conflict";
    if (deleted) entry.deletedRemotely = true;
    entry.lastError = error instanceof Error ? error.message : String(error);
    summarizeProjection(item, "twitch");
    await persist();
    throw error;
  }
}

// packages/core/src/planning.ts
function providerSupportsRecurrence(provider, item) {
  if (provider === "google") {
    try {
      googleRecurrence(item);
      return true;
    } catch {
      return false;
    }
  }
  try {
    assertTwitchRecurrence(item);
    return true;
  } catch {
    return false;
  }
}
var PlanningOrchestrator = class {
  constructor(items, providers, persist) {
    this.items = items;
    this.providers = providers;
    this.persist = persist;
  }
  items;
  providers;
  persist;
  queue = Promise.resolve();
  refreshTwitch(now = Date.now(), ids) {
    return this.serial(async () => {
      for (const item of this.items.filter((item2) => !item2.transferredTo && !item2.transferId && item2.deletionPending && (!ids || ids.includes(item2.id)))) {
        await recoverSeriesDeletionIdentities(item, this.providers, () => this.persist(this.items));
      }
      for (const item of this.items.filter((item2) => !ids || ids.includes(item2.id))) {
        if (item.deletionPending || item.transferredTo || item.transferId) continue;
        const transitioning = (item.providers?.twitch?.projectionMode === "materialized" || Boolean(item.providers?.twitch?.nativeReplacementRequested)) && !needsTwitchMaterialization(item);
        const handled = await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === "LOCAL" && item.desiredPublication?.twitch && !this.remoteId(item, "twitch") && item.conflict?.provider !== "twitch") {
          await this.publishOne(item, "twitch");
        }
      }
      for (const item of this.items.filter((item2) => !ids || ids.includes(item2.id))) {
        if (item.deletionPending || item.transferredTo || item.transferId) continue;
        const transitioning = item.providers?.google?.projectionMode === "materialized" && !needsGoogleMaterialization(item);
        const handled = await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === "LOCAL" && item.desiredPublication?.google && !this.remoteId(item, "google")) await this.publishOne(item, "google");
      }
      return this.all();
    });
  }
  all() {
    return structuredClone(this.items);
  }
  create(input) {
    return this.serial(async () => {
      const id = input.id ?? randomUuid();
      if (this.items.some((item2) => item2.id === id)) throw new Error("Un \xE9v\xE9nement de m\xEAme identit\xE9 existe d\xE9j\xE0.");
      const item = {
        ...input,
        recurrence: recurrenceForNewSeries(input.recurrence, input.localId ?? id),
        id,
        localId: input.localId ?? id,
        ownership: "LOCAL",
        editable: true,
        desiredPublication: input.desiredPublication ?? { local: true, twitch: false, google: false },
        providers: input.providers ?? {}
      };
      this.items.push(item);
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item);
      return structuredClone(item);
    });
  }
  update(id, changes, options = {}) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) throw new Error("Suppression de s\xE9rie en attente. R\xE9essayez la suppression.");
      const twitchLink = item.providers?.twitch;
      const next = { ...item, ...changes };
      if (twitchLink?.remoteId && twitchLink.projectionOwned && twitchLink.projectionMode === "native" && (Boolean(item.recurrence) !== Boolean(next.recurrence) || item.recurrence && (Date.parse(item.startAtUtc) !== Date.parse(next.startAtUtc) || item.recurrence.timeZone !== next.recurrence?.timeZone) || needsTwitchMaterialization(next))) {
        twitchLink.nativeReplacementRequested ??= { recurrence: structuredClone(item.recurrence) };
      }
      Object.assign(item, changes);
      if (item.providers?.google) delete item.providers.google.nativeRetained;
      if (options.desiredPublication) {
        item.desiredPublication = {
          local: true,
          twitch: options.desiredPublication.twitch ?? item.desiredPublication?.twitch ?? false,
          google: options.desiredPublication.google ?? item.desiredPublication?.google ?? false
        };
      }
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item, options.confirmRecurring === true, true);
      return structuredClone(item);
    });
  }
  remove(id, destinations) {
    return this.serial(async () => {
      const item = this.items.find((value) => value.id === id);
      if (!item) return this.all();
      this.assertOwned(item);
      if (destinations.local && (item.recurrence || item.deletionPending)) {
        if (item.twitchRecurring && !destinations.confirmRecurring && !item.deletionPending) throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        const retry = item.deletionPending === true;
        item.deletionPending = true;
        item.desiredPublication = { local: true, twitch: false, google: false };
        await this.persist(this.items);
        await this.finishSeriesDeletion(item, retry);
        return this.all();
      }
      const failed = [];
      for (const name of ["twitch", "google"]) {
        if (!destinations[name]) continue;
        const remoteId = this.remoteId(item, name);
        if (!remoteId) {
          if (!await this.unpublishOne(item, name)) failed.push(name);
          continue;
        }
        if (name === "twitch" && item.twitchRecurring && !destinations.confirmRecurring) {
          throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        }
        if (!await this.unpublishOne(item, name)) failed.push(name);
      }
      if (failed.length && destinations.local) {
        await this.persist(this.items);
        throw new Error(`Suppression distante incompl\xE8te (${failed.join(", ")}). L\u2019\xE9v\xE9nement local est conserv\xE9 pour permettre un retry.`);
      }
      if (destinations.local) this.items = this.items.filter((value) => value.id !== id);
      await this.persist(this.items);
      return this.all();
    });
  }
  retry(id, provider, options = {}) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) {
        await this.finishSeriesDeletion(item, true);
        return structuredClone(item);
      }
      if (provider === "twitch" && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { retry: true })) {
        if (["error", "conflict"].includes(item.providers?.twitch?.status ?? "")) throw new Error(item.providers?.twitch?.lastError);
        return structuredClone(item);
      }
      if (provider === "google" && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { retry: true })) {
        if (["error", "conflict"].includes(item.providers?.google?.status ?? "")) throw new Error(item.providers?.google?.lastError);
        return structuredClone(item);
      }
      if (!this.remoteId(item, provider)) assertProviderCreationCertain(item, provider);
      const desired = item.desiredPublication?.[provider] ?? false;
      if (desired && !providerSupportsRecurrence(provider, item)) {
        item.providers ??= {};
        const link = item.providers[provider] ??= { status: "error" };
        link.status = "error";
        link.lastError = `La r\xE9currence locale ne peut pas encore \xEAtre repr\xE9sent\xE9e fid\xE8lement sur ${provider}. L\u2019\xE9v\xE9nement local est conserv\xE9.`;
        await this.persist(this.items);
        throw new Error(link.lastError);
      }
      if (desired && (item.conflict?.provider === provider || item.providers?.[provider]?.status === "conflict")) {
        throw new Error(`Conflit ${provider} non r\xE9solu \u2014 choisissez d\u2019abord la version locale ou distante.`);
      }
      if (!desired) {
        const remoteId = this.remoteId(item, provider);
        if (!remoteId) {
          item.providers ??= {};
          const link = item.providers[provider] ??= { status: "not-published" };
          link.status = "not-published";
          link.deletedRemotely = false;
          delete link.lastError;
          await this.persist(this.items);
          return structuredClone(item);
        }
        if (provider === "twitch" && item.twitchRecurring && !options.confirmRecurring) {
          throw new Error("Suppression explicite de la s\xE9rie Twitch r\xE9currente requise.");
        }
        if (!await this.unpublishOne(item, provider)) {
          throw new Error(item.providers?.[provider]?.lastError ?? `Impossible de retirer la publication ${provider}.`);
        }
        return structuredClone(item);
      }
      await this.publishOne(item, provider, true);
      const currentLink = item.providers?.[provider];
      if (currentLink?.status !== "synced") {
        throw new Error(currentLink?.lastError ?? `Impossible de republier sur ${provider}.`);
      }
      return structuredClone(item);
    });
  }
  resolveConflict(id, provider, strategy, occurrenceKey) {
    return this.serial(async () => {
      const item = this.required(id);
      if (item.deletionPending) throw new Error("Suppression de s\xE9rie en attente : r\xE9essayez la suppression pour confirmer le retrait de la version distante courante.");
      if (occurrenceKey !== void 0) {
        if (provider === "google") await resolveGoogleOccurrenceConflict(item, occurrenceKey, strategy, this.providers.google, () => this.persist(this.items), (restored) => this.items.push(restored));
        else await resolveTwitchOccurrenceConflict(item, occurrenceKey, strategy, this.providers.twitch, () => this.persist(this.items));
        return structuredClone(item);
      }
      const conflict = item.conflict?.provider === provider ? item.conflict : item.providers?.[provider]?.status === "conflict" ? { provider, detectedAt: (/* @__PURE__ */ new Date()).toISOString() } : void 0;
      if (conflict) item.conflict = conflict;
      if (!conflict || conflict.provider !== provider) throw new Error(`Aucun conflit ${provider} \xE0 r\xE9soudre.`);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "conflict" };
      const remoteId = this.remoteId(item, provider);
      const remoteProvider = this.providers[provider];
      if (remoteId && remoteProvider?.read) {
        try {
          const latest = await remoteProvider.read(remoteId, item, { resolveConflict: true });
          if (latest.deleted) {
            link.deletedRemotely = true;
            throw new Error("\xC9v\xE9nement supprim\xE9 \xE0 distance. Confirmez explicitement sa republication.");
          }
          if (!latest.remote) throw new Error("Version distante indisponible pour r\xE9soudre ce conflit.");
          if (provider === "google" && link.nativeWithdrawalRequested && !latest.revision) throw new Error("ETag Google courant indisponible.");
          conflict.remote = latest.remote;
          if (latest.revision !== void 0) link.remoteRevision = latest.revision;
          if (latest.fingerprint !== void 0) link.fingerprint = latest.fingerprint;
          await this.persist(this.items);
        } catch (error) {
          link.status = "conflict";
          link.lastError = error instanceof Error ? error.message : String(error);
          await this.persist(this.items);
          throw error;
        }
      }
      if (provider === "twitch" && link.nativeReplacementRequested) {
        if (strategy === "remote") {
          if (!conflict.remote) throw new Error("Version distante indisponible.");
          Object.assign(item, conflict.remote);
          item.recurrence = link.nativeReplacementRequested.recurrence;
          item.desiredPublication = { local: true, google: false, ...item.desiredPublication, twitch: true };
          delete link.nativeReplacementRequested;
          delete link.projections;
          delete link.projectionWindow;
          link.status = "synced";
        } else link.status = "pending";
        delete item.conflict;
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (provider === "google" && link.nativeWithdrawalRequested) {
        if (!remoteId || !remoteProvider?.read || !link.remoteRevision) throw new Error("Identit\xE9 et ETag Google requis pour r\xE9soudre le retrait.");
        if (strategy === "remote") {
          if (!conflict.remote) throw new Error("Version distante indisponible.");
          Object.assign(item, conflict.remote);
          item.desiredPublication = { local: true, twitch: false, ...item.desiredPublication, google: true };
          delete link.nativeWithdrawalRequested;
          link.nativeRetained = true;
          link.projectionMode = "native";
          if (!Object.keys(link.projections ?? {}).length) {
            delete link.projections;
            delete link.projectionWindow;
          }
          link.status = "synced";
        } else {
          link.status = "pending";
        }
        delete item.conflict;
        delete link.lastError;
        link.deletedRemotely = false;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (strategy === "remote") {
        if (!conflict.remote) throw new Error("Version distante indisponible pour r\xE9soudre ce conflit.");
        Object.assign(item, conflict.remote);
        delete link.uncertainCreate;
        delete item.conflict;
        link.status = "synced";
        link.deletedRemotely = false;
        link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }
      if (!remoteId) throw new Error(`Objet distant ${provider} introuvable pour appliquer la version locale.`);
      if (!remoteProvider) {
        link.status = "conflict";
        link.lastError = `${provider} non connect\xE9. Le conflit reste ouvert.`;
        await this.persist(this.items);
        throw new Error(link.lastError);
      }
      link.deletedRemotely = false;
      link.status = "pending";
      await this.persist(this.items);
      try {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (provider === "twitch") link.fingerprint = result.fingerprint;
        link.status = "synced";
        link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
        link.deletedRemotely = false;
        delete link.lastError;
        delete item.conflict;
        await this.persist(this.items);
      } catch (error) {
        link.status = "conflict";
        link.lastError = error instanceof Error ? error.message : String(error);
        await this.persist(this.items);
        throw error;
      }
      return structuredClone(item);
    });
  }
  markRemoteDeleted(id, provider) {
    return this.serial(async () => {
      const item = this.required(id);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "error" };
      link.deletedRemotely = true;
      link.status = "error";
      link.lastError = "\xC9v\xE9nement supprim\xE9 \xE0 distance \u2014 action utilisateur requise.";
      await this.persist(this.items);
      return structuredClone(item);
    });
  }
  markConflict(id, provider, remote) {
    return this.serial(async () => {
      const item = this.required(id);
      item.conflict = { provider, detectedAt: (/* @__PURE__ */ new Date()).toISOString(), remote };
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: "conflict" };
      link.status = "conflict";
      link.lastError = "Conflit avec une modification distante.";
      await this.persist(this.items);
      return structuredClone(item);
    });
  }
  async finishSeriesDeletion(item, retry = false) {
    await deleteSeriesProjections(item, this.providers, () => this.persist(this.items), retry);
    this.items = this.items.filter((value) => value.id !== item.id);
    await this.persist(this.items);
  }
  async reconcileDesiredPublication(item, confirmRecurring = false, updateLinked = false) {
    for (const name of ["twitch", "google"]) {
      const desired = item.desiredPublication?.[name] ?? false;
      if (name === "twitch" && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items))) continue;
      if (name === "google" && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { explicitWithdrawal: !desired })) continue;
      const remoteId = this.remoteId(item, name);
      if (!remoteId && item.providers?.[name]?.uncertainCreate) {
        const link2 = item.providers[name];
        link2.status = "error";
        link2.lastError = "Cr\xE9ation distante incertaine. R\xE9conciliez son identit\xE9 avant de republier.";
        await this.persist(this.items);
        continue;
      }
      if (desired && !providerSupportsRecurrence(name, item)) {
        item.providers ??= {};
        const link2 = item.providers[name] ??= { status: "error" };
        link2.status = "error";
        link2.lastError = `La r\xE9currence locale ne peut pas encore \xEAtre repr\xE9sent\xE9e fid\xE8lement sur ${name}. L\u2019\xE9v\xE9nement local est conserv\xE9.`;
        await this.persist(this.items);
        continue;
      }
      if (!desired) {
        if (!remoteId) {
          item.providers ??= {};
          const link2 = item.providers[name] ??= { status: "not-published" };
          link2.status = "not-published";
          link2.deletedRemotely = false;
          delete link2.lastError;
          await this.persist(this.items);
          continue;
        }
        if (name === "twitch" && item.twitchRecurring && !confirmRecurring) {
          const link2 = this.ensureLink(item, name, remoteId);
          link2.status = "error";
          link2.lastError = "Cette publication Twitch appartient \xE0 une s\xE9rie r\xE9currente. Confirmation requise pour la retirer.";
          await this.persist(this.items);
          continue;
        }
        await this.unpublishOne(item, name);
        continue;
      }
      const link = item.providers?.[name];
      if (item.conflict?.provider === name) {
        if (link) {
          link.status = "conflict";
          link.lastError = "Conflit distant non r\xE9solu \u2014 choisissez la version \xE0 conserver.";
          await this.persist(this.items);
        }
        continue;
      }
      if (!remoteId) {
        await this.publishOne(item, name, name !== "twitch");
        continue;
      }
      if (updateLinked) await this.publishOne(item, name);
    }
  }
  async publishOne(item, name, explicitRetry = false) {
    const desired = item.desiredPublication?.[name] ?? false;
    item.providers ??= {};
    const existingRemoteId = this.remoteId(item, name);
    const link = item.providers[name] ??= { status: desired ? "pending" : "not-published" };
    if (existingRemoteId && !link.remoteId) link.remoteId = existingRemoteId;
    if (!desired) {
      if (!existingRemoteId) link.status = "not-published";
      return;
    }
    if (link.deletedRemotely && !explicitRetry) return;
    if (!this.remoteId(item, name)) {
      try {
        assertProviderCreationCertain(item, name);
      } catch (error) {
        link.status = "error";
        link.lastError = error.message;
        await this.persist(this.items);
        return;
      }
    }
    link.status = "pending";
    if (explicitRetry) delete link.lastError;
    await this.persist(this.items);
    await this.attempt(item, name, async (remoteProvider) => {
      if (explicitRetry && link.deletedRemotely) {
        const previousId = this.remoteId(item, name);
        const remote = previousId && remoteProvider.read ? await remoteProvider.read(previousId, item) : void 0;
        if (!remote || remote.deleted) this.clearRemoteIdentity(item, name);
        link.deletedRemotely = false;
        await this.persist(this.items);
      }
      const remoteId = this.remoteId(item, name);
      if (remoteId) {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (name === "twitch") link.fingerprint = result.fingerprint;
      } else {
        const result = await createWithDurableIntent(item, name, () => this.persist(this.items), (request3) => remoteProvider.create(request3), remoteProvider.prepareCreate);
        delete link.nativeReplacementRequested;
        link.projectionOwned = result.owned !== false;
        link.projectionMode = "native";
        link.remoteId = result.id;
        if (result.revision !== void 0) link.remoteRevision = result.revision;
        if (name === "twitch") link.fingerprint = result.fingerprint;
        link.calendarId = result.calendarId ?? link.calendarId;
        if (name === "twitch") {
          link.projectionMode = "native";
          link.projectionOwned = result.owned !== false;
          item.twitchSegmentId = result.id;
          item.twitchRecurring = item.recurrence ? item.recurrence.frequency === "weekly" && item.recurrence.interval === 1 : item.twitchRecurring === true;
        }
      }
    });
  }
  async unpublishOne(item, name) {
    const remoteId = this.remoteId(item, name);
    if (name === "google") {
      const link2 = this.ensureLink(item, name, remoteId);
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.google = false;
      link2.nativeWithdrawalRequested = true;
      delete link2.nativeRetained;
      await this.persist(this.items);
    }
    if (name === "twitch") {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.twitch = false;
      await this.persist(this.items);
    }
    if (name === "twitch" && (!remoteId || item.providers?.twitch?.projectionOwned) && (needsTwitchMaterialization(item) || item.providers?.twitch?.projections)) {
      await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
      return !["error", "conflict"].includes(item.providers?.twitch?.status ?? "");
    }
    if (name === "google" && item.providers?.google?.projections) {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.google = false;
      await this.persist(this.items);
      await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { explicitWithdrawal: true });
      return !["error", "conflict"].includes(item.providers.google.status);
    }
    if (!remoteId) {
      if (name === "twitch") {
        assertProviderCreationCertain(item, name);
        item.twitchRecurring = false;
      }
      return true;
    }
    const link = this.ensureLink(item, name, remoteId);
    if (name === "google" && link.status === "conflict") return false;
    link.status = "pending";
    await this.persist(this.items);
    const ok = await this.attempt(item, name, (remoteProvider) => remoteProvider.delete(remoteId, item, link.remoteRevision));
    if (ok) {
      delete link.deletionPeriod;
      delete link.nativeWithdrawalRequested;
      if (name === "twitch") item.twitchRecurring = false;
      this.clearRemoteIdentity(item, name);
      link.status = "not-published";
      link.deletedRemotely = false;
      delete link.lastError;
      if (item.conflict?.provider === name) delete item.conflict;
      await this.persist(this.items);
      if (name === "twitch" && item.providers?.twitch?.projections) {
        await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
        return !["error", "conflict"].includes(item.providers.twitch.status);
      }
    }
    return ok;
  }
  async attempt(item, name, operation) {
    const link = item.providers[name];
    const provider = this.providers[name];
    if (!provider) {
      link.status = "error";
      link.lastError = `${name} non connect\xE9.`;
      await this.persist(this.items);
      return false;
    }
    try {
      await operation(provider);
      link.status = "synced";
      link.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      link.deletedRemotely = false;
      delete link.lastError;
      if (name === "twitch") delete item.syncError;
      await this.persist(this.items);
      return true;
    } catch (error) {
      const failure = error;
      link.status = failure.code === "CONFLICT" || failure.status === 412 ? "conflict" : "error";
      if (link.status === "conflict") {
        item.conflict = { provider: name, detectedAt: (/* @__PURE__ */ new Date()).toISOString(), remote: failure.remote };
        if (failure.fingerprint) link.fingerprint = failure.fingerprint;
      }
      if ((failure.code === "DELETED_REMOTELY" || failure.status === 404 || failure.status === 410) && (name !== "twitch" || this.remoteId(item, name))) link.deletedRemotely = true;
      link.lastError = error instanceof Error ? error.message : String(error);
      await this.persist(this.items);
      return false;
    }
  }
  remoteId(item, name) {
    return item.providers?.[name]?.remoteId ?? (name === "twitch" ? item.twitchSegmentId : void 0);
  }
  ensureLink(item, name, remoteId) {
    item.providers ??= {};
    const link = item.providers[name] ??= { status: remoteId ? "synced" : "not-published" };
    if (remoteId && !link.remoteId) link.remoteId = remoteId;
    return link;
  }
  clearRemoteIdentity(item, name) {
    const link = item.providers?.[name];
    if (link) {
      delete link.remoteId;
      delete link.remoteRevision;
    }
    if (name === "twitch") {
      delete item.twitchSegmentId;
      delete link?.fingerprint;
    }
  }
  required(id) {
    const item = this.items.find((value) => value.id === id);
    if (!item) throw new Error("\xC9v\xE9nement introuvable.");
    this.assertOwned(item);
    return item;
  }
  assertOwned(item) {
    if (item.transferredTo || item.transferId) throw new Error("\xC9v\xE9nement transf\xE9r\xE9 : g\xE9rez-le sur son appareil propri\xE9taire.");
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.then(() => void 0, () => void 0);
    return result;
  }
};
export {
  PlanningOrchestrator,
  createBinaryHash,
  createHash as createIdentityHash,
  defaultProductProfile,
  generateTwitchTags,
  googleRecurrence,
  mergeStreamlabsHistory,
  normalizeStreamlabsHistory,
  parseGoogleRecurrence,
  parseWizeBotCatalog,
  randomUuid,
  validateProductProfile
};
