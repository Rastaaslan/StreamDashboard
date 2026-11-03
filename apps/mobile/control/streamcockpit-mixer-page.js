import { mountMixerControl } from './streamcockpit-mixer-control.js';
import { mountMixerTable } from './streamcockpit-mixer.js';

/** One FIXE master; routing is an explicit OBS read, not client-side audio or output inference. */
export function mountMixerPage(root, { online, request, controls = undefined }) {
  const doc = root.ownerDocument;
  const caption = doc.createElement('p');
  caption.setAttribute('role', 'status');
  caption.textContent = online
    ? 'Mixeur OBS du fixe · gain/muet et mètres observés si disponibles. Pistes OBS consultables ; piste VOD non identifiée.'
    : 'Fixe indisponible : aucun niveau ni routage confirmé.';
  root.append(caption);
  if (!online) return { unavailable() {}, destroy() { caption.remove(); } };
  let control, available = true, inspection = 0, inspecting = false;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', 'Pistes et monitoring OBS — observation manuelle');
  section.setAttribute('style', 'width:100%;max-width:100%;min-width:0;overflow-wrap:anywhere');
  const hint = doc.createElement('p');
  hint.textContent = 'Pistes cochées dans OBS (1 à 6). Le choix du numéro de piste VOD Twitch et le son PC jeu restent à vérifier dans OBS.';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Source audio OBS à vérifier');
  select.setAttribute('style', 'width:100%;max-width:100%;min-width:0');
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Lire les pistes OBS';
  button.setAttribute('style', 'max-width:100%;white-space:normal');
  button.disabled = true;
  const observation = doc.createElement('p');
  observation.setAttribute('aria-live', 'polite');
  observation.textContent = 'Lecture manuelle uniquement ; aucun réglage appliqué.';
  section.append(hint, select, button, observation);
  // Preserve the standard mixer layout before this optional inspect-only panel.
  const table = mountMixerTable(root, {
    read: () => request('/api/v1/streamcockpit-mixer'),
    onData: data => {
      control?.sources(data.sources);
      if (!available) return;
      const previous = select.value;
      select.replaceChildren();
      for (const source of data.sources) {
        if (typeof source.id !== 'string' || !source.id ||
            typeof source.name !== 'string') continue;
        const option = doc.createElement('option');
        option.value = source.id; option.textContent = source.name; select.append(option);
      }
      if ([...select.options || []].some(option => option.value === previous)) select.value = previous;
      inspection++; observation.textContent = 'Pistes non relues depuis cette actualisation.';
      button.disabled = inspecting || !select.options?.length;
    },
  });
  root.append(section);
  if (controls) control = mountMixerControl(root, { request, ...controls });
  button.addEventListener?.('click', async () => {
    if (!available || inspecting || !select.value) return;
    const sourceId = select.value, stamp = ++inspection;
    inspecting = true; button.disabled = true;
    observation.textContent = 'Lecture directe des pistes OBS…';
    try {
      const route = await request('/api/v1/streamcockpit-mixer/routing?sourceId=' + encodeURIComponent(sourceId));
      if (!available || stamp !== inspection || sourceId !== select.value) return;
      if (route?.schemaVersion !== 1 || route.kind !== 'streamcockpit-obs-audio-routing' ||
          route.sourceId !== sourceId || route.vodTrack !== 'unverified' ||
          !Array.isArray(route.tracks) || route.tracks.length !== 6 ||
          route.tracks.some((track, i) => track.number !== i+1 || typeof track.enabled !== 'boolean') ||
          !['OBS_MONITORING_TYPE_NONE','OBS_MONITORING_TYPE_MONITOR_ONLY',
            'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'].includes(route.monitorType)) {
        throw new Error('INVALID_ROUTING');
      }
      const tracks = route.tracks.filter(track => track.enabled).map(track => track.number);
      const labels = {
        OBS_MONITORING_TYPE_NONE: 'Sans retour monitoring',
        OBS_MONITORING_TYPE_MONITOR_ONLY: 'Retour monitoring uniquement',
        OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT: 'Retour monitoring et sortie',
      };
      observation.textContent = 'Pistes OBS activées : ' + (tracks.join(', ') || 'aucune') +
        ' · ' + labels[route.monitorType] +
        ' · Correspondance piste VOD Twitch : non vérifiée.';
    } catch {
      if (available && stamp === inspection) observation.textContent =
        'Pistes OBS indisponibles : connexion, source ou droits à revérifier. Aucun changement appliqué.';
    } finally {
      inspecting = false;
      if (available) button.disabled = !select.options?.length;
    }
  });
  return {
    isAvailable(authority) { return available && controls?.authorityKey === authority; },
    refresh() {
      if (!available) return;
      inspection++; observation.textContent = 'Pistes non relues depuis cette actualisation.';
      return table.refresh();
    },
    unavailable() {
      available = false; inspection++;
      table.destroy(); control?.unavailable(); section.remove();
      caption.textContent = 'Fixe déconnecté : données du mixeur périmées, actualisation nécessaire.';
    },
    destroy() { available = false; inspection++; table.destroy(); control?.destroy(); section.remove(); caption.remove(); },
  };
}
