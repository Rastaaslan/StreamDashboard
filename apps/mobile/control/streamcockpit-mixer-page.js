import { mountMixerControl } from './streamcockpit-mixer-control.js';
import { mountMixerTable } from './streamcockpit-mixer.js';

/** Host observations plus explicit gain/mute consent; no client-side OBS connection. */
export function mountMixerPage(root, { online, request, controls = undefined }) {
  const doc = root.ownerDocument;
  const caption = doc.createElement('p');
  caption.setAttribute('role', 'status');
  caption.textContent = online
    ? 'Mixeur OBS du fixe · gain et muet observés, routage/VOD/mètres non prouvés.'
    : 'Fixe indisponible : aucun niveau ni routage confirmé.';
  root.append(caption);
  if (!online) return { unavailable() {}, destroy() { caption.remove(); } };
  let control, available = true;
  const table = mountMixerTable(root, { read: () => request('/api/v1/streamcockpit-mixer'), onData: data => control?.sources(data.sources) });
  if (controls) control = mountMixerControl(root, { request, ...controls });
  return {
    isAvailable(authority) { return available && controls?.authorityKey === authority; },
    refresh() { if (available) return table.refresh(); },
    unavailable() {
      available = false;
      table.destroy();control?.unavailable();
      caption.textContent = 'Fixe déconnecté : données du mixeur périmées, actualisation nécessaire.';
    },
    destroy() { table.destroy(); control?.destroy(); caption.remove(); },
  };
}
