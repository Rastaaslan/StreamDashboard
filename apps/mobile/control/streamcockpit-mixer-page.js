import { mountMixerTable } from './streamcockpit-mixer.js';

/** F05 read-only. No client-side OBS authority, volume setter or speculative retry. */
export function mountMixerPage(root, { online, request }) {
  const doc = root.ownerDocument;
  const caption = doc.createElement('p');
  caption.setAttribute('role', 'status');
  caption.textContent = online
    ? 'Mixeur OBS du fixe · gain et muet observés, routage/VOD/mètres non prouvés.'
    : 'Fixe indisponible : aucun niveau ni routage confirmé.';
  root.append(caption);
  if (!online) return { unavailable() {}, destroy() { caption.remove(); } };
  const table = mountMixerTable(root, { read: () => request('/api/v1/streamcockpit-mixer') });
  return {
    unavailable() {
      table.destroy();
      caption.textContent = 'Fixe déconnecté : données du mixeur périmées, actualisation nécessaire.';
    },
    destroy() { table.destroy(); caption.remove(); },
  };
}
