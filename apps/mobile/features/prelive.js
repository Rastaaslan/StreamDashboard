import { getMobileContext } from '../mobile-context.js';
import { diagnosePrelive, diagnosticLabels } from '../prelive-diagnostic.js';

const context = getMobileContext();
const root = document.getElementById('prelive-result');
const button = document.getElementById('run-prelive');
let running = false;
async function run() {
  if (running) return;
  running = true;
  button.disabled = true;
  root.textContent = 'Vérification en cours…';
  let capabilities = null, failed = false;
  const mode = context.getMode();
  if (mode === 'ONLINE_PC') {
    try {
      await context.ensureCredential();
      context.applyState(await context.transport.state());
    } catch { failed = true; }
    if (!failed && context.getState()?.twitch?.connected) {
      try { capabilities = await context.transport.twitchModerationCapabilities(); }
      catch { /* Missing scopes telemetry must not invalidate freshly received OBS state. */ }
    }
  }
  if (mode === 'ONLINE_STANDALONE') await context.refreshProviderDiagnostics?.();
  const result = diagnosePrelive({ state: context.getState() || {}, mode: failed ? 'OFFLINE' : mode, cache: context.companion.snapshot(), phone: context.getProviderDiagnostics?.() || {}, capabilities });
  root.replaceChildren();
  const heading = document.createElement('p');
  heading.textContent = `${diagnosticLabels[result.status]} · ${new Date(result.checkedAt).toLocaleTimeString('fr-FR')} · Les protections au démarrage restent actives.`;
  root.append(heading);
  const targets = { connections: ['tab', 'settings'], audio: ['tool', 'audio'], scenes: ['tool', 'scenes'], timer: ['tool', 'timer'], twitch: ['tool', 'twitch'], planning: ['tab', 'planning'] };
  for (const check of result.checks) {
    const row = document.createElement('p');
    row.textContent = `${check.applicable ? diagnosticLabels[check.status] : 'Non applicable'} — ${check.message} `;
    if (check.action && check.status !== 'ok') {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = 'Ouvrir la correction';
      const [kind, target] = targets[check.action];
      if (kind === 'tool') action.dataset.openLiveTool = target;
      else { action.dataset.openTab = target; if (target === 'settings') action.dataset.settingsTarget = 'connections'; }
      row.append(action);
    }
    root.append(row);
  }
  running = false;
  button.disabled = false;
}
button.addEventListener('click', () => void run());
document.querySelectorAll('[data-open-diagnostic]').forEach(button => button.addEventListener('click', () => { void run(); }));
void run();
