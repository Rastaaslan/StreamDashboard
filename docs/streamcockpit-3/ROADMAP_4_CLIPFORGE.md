# StreamCockpit V4 — ClipForge et montage
Décision produit SC3-FINAL-DELIVERY-001, 03/11/2026. Hors livraison 3.0.

Le code, les tests et les journaux existants sont conservés. Leur existence ne constitue pas une qualification de production. Aucun traitement ClipForge supplémentaire ne doit être engagé pour fermer les gates 3.0.

| Travail reporté | Preuves et limites à reprendre en V4 |
| --- | --- |
| Montage et exports verticaux | Plan de segments, légendes, prévisualisation et consentement explicite |
| FFmpeg/ffprobe et codecs avancés | Provenance, versions approuvées, chaîne de signature disponible, limites CPU/mémoire/E/S |
| Superviseur Windows | Job Object, arrêt descendants, packaging et provenance du helper |
| Staging et sources | Fichiers privés, identité de source OBS, durabilité NTFS, panne électrique, course de chemins |
| Pipeline de rendus | Réservations durables, reçus incertains, annulation, reprise sans double encodage |
| Interfaces Desktop et Android | API appairées et UX de montage, autorisations et tests réels |

Références conservées : GATES_BEFORE_SCOPE_20261103.md, F04_WINDOWS_OFFLINE_LAB_20261102.md, F04_WINDOWS_PROVENANCE_ACL_FIXE_20261103.md et historique F04 de CONTINUITY.md / feature-matrix.json.

En 3.0, seuls les marqueurs, le tampon/replay OBS et les clips Twitch simples sont inclus. F09 reçoit leurs événements sans dépendance au montage. SC31-LAYOUT-001 reste distinct, en V3.1.
