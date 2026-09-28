import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { providerDiagnostic, capabilityAvailability, wizardState, planningPublicationPermissions } from '../../apps/mobile/provider-diagnostics.js';
import { CompanionMode } from '../../apps/mobile/companion-store.js';

// Exercise the actual UI functions with a small DOM stand-in, without npm or a browser.
const source = readFileSync(new URL('../../apps/mobile/mobile.js', import.meta.url), 'utf8');
function uiFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function setup() {
  const elements = new Map();
  const node = () => ({
    children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    closest() { return { after: child => elements.set(child.id, child) }; },
  });
  const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  $('slot-form').elements = { twitch: node(), google: node() };
  const context = vm.createContext({
    $, document: { createElement: node },
    text: (tag, textContent) => Object.assign(node(), { tag, textContent }),
    CompanionMode, providerDiagnostic, capabilityAvailability, wizardState, planningPublicationPermissions,
    companionMode: CompanionMode.ONLINE_STANDALONE,
    state: null, moderationCapabilities: null, phoneProviderSnapshots: {},
    providerPending: new Set(), providerBusy: new Set(), providerAccounts: {}, renderSyncCenter() {}, renderPlanning() {},
    companion: { snapshot: () => ({}) }, remoteButtons() {},
    testPhoneProvider() {},
  });
  vm.runInContext(['applyPlanningProviderCapabilities', 'updatePlanningProviderReadiness', 'setConnectionMode', 'renderPhoneProvider'].map(uiFunction).join('\n'), context);
  return { context, $, publish: $('slot-form').elements };
}
for (const provider of ['twitch', 'google']) {
  test(`${provider}: cancelled reauthorization without callback keeps OAuth relaunch available`, () => {
    const { context, $ } = setup();
    // The native bridge still has the previous session after leaving the browser.
    const oldSession = { configured: true, connected: true, capabilities: ['connect', 'disconnect', 'test'] };
    context.providerPending.add(provider);
    context.renderPhoneProvider(provider, oldSession);
    const auth = $(`${provider}-standalone-auth`);
    assert.equal(auth.hidden, false);
    assert.equal(auth.disabled, false);
    assert.equal(auth.textContent, 'Relancer OAuth');
    assert.equal($(`${provider}-standalone-status`).textContent, 'OAuth');
    assert.equal($(`${provider}-assistant`).children.find(child => child.tag === 'button').disabled, true);
    // Re-rendering on visibilitychange must not hide the recovery action.
    context.renderPhoneProvider(provider, oldSession);
    assert.equal(auth.hidden, false);
    // Completion of the relaunched OAuth enables testing the account again.
    context.providerPending.delete(provider);
    context.renderPhoneProvider(provider, oldSession);
    assert.equal($(`${provider}-standalone-status`).textContent, 'Test');
    assert.equal($(`${provider}-assistant`).children.find(child => child.tag === 'button').disabled, false);
  });
}

test('unavailable phone → connected PC recalculates both publication controls and reasons', () => {
  const { context, publish, $ } = setup();
  for (const provider of ['twitch', 'google']) context.renderPhoneProvider(provider, { configured: false });
  assert.equal(publish.twitch.disabled, true);
  assert.equal(publish.google.disabled, true);
  context.state = { twitch: { connected: true }, google: { configured: true, connected: true, targetConfigured: true } };
  context.moderationCapabilities = { schedule: true };
  context.setConnectionMode(CompanionMode.ONLINE_PC);
  for (const provider of ['twitch', 'google']) {
    assert.equal(publish[provider].disabled, false);
    assert.equal(publish[provider].title, '');
    // A late phone diagnostic cannot overwrite the active PC permissions.
    context.renderPhoneProvider(provider, { configured: false });
    assert.equal(publish[provider].disabled, false);
  }
  context.moderationCapabilities.schedule = false;
  context.state.google.targetConfigured = false;
  context.updatePlanningProviderReadiness();
  assert.equal(publish.twitch.disabled, true);
  assert.match(publish.twitch.title, /Reconnecte Twitch sur le PC/);
  assert.equal(publish.google.disabled, true);
  assert.match(publish.google.title, /cible à choisir/);
  assert.match($('planning-provider-readiness').textContent, /Reconnecte Twitch.*cible à choisir/);
  context.setConnectionMode(CompanionMode.ONLINE_STANDALONE);
  for (const provider of ['twitch', 'google']) assert.match(publish[provider].title, /Client ID absent/);
});

test('PC permissions pending and offline mode do not enable publication', () => {
  const { context, publish } = setup();
  context.state = { twitch: { connected: true }, google: { configured: true, connected: true, targetConfigured: true } };
  context.setConnectionMode(CompanionMode.ONLINE_PC);
  assert.equal(publish.twitch.disabled, true);
  assert.match(publish.twitch.title, /vérification/);
  context.moderationCapabilities = { schedule: true };
  context.updatePlanningProviderReadiness();
  assert.equal(publish.twitch.disabled, false);
  context.setConnectionMode(CompanionMode.OFFLINE);
  for (const provider of ['twitch', 'google']) {
    assert.equal(publish[provider].disabled, true);
    assert.match(publish[provider].title, /Connexion/);
  }
});
