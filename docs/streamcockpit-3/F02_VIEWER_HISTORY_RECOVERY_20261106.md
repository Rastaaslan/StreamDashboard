# F02 — Activité AutoMod observée : recherche manuelle et reconnexion contrôlée

**06/11/2026 — FIXE seulement**, base vérifiée `c8828ac`, branche `streamcockpit/3.0-full-experience`. L'interface Desktop/Android peut désormais lire les observations AutoMod d'un viewer **par son identifiant numérique**, même quand aucun message n'est actuellement retenu. Le serveur garde uniquement les issues déjà observées en mémoire pendant **15 minutes** lors d'une interruption/reconnexion EventSub **du même broadcaster**. Les messages retenus sont immédiatement retirés à toute déconnexion : aucune ancienne retenue ne peut redevenir actionnable. Une reconnexion à un compte différent efface cet historique privé.

Le parcours ne lit que `GET /api/v1/twitch/advanced/moderation/viewer/:userId` avec l'authentification et les droits appairés existants. La liste ne contient ni texte des messages, ni pseudonyme, ni jeton, ni promesse d'historique complet Twitch. Une modification d'ID, de régie ou de compte pendant une lecture annule l'affichage de l'ancienne réponse. Aucune nouvelle API publique, mutation Twitch ou publication automatique.

## Preuves
- RED initial : **1 PASS / 3 FAIL / 0 skipped** sur le nouveau parcours de recherche manuelle et conservation à la reconnexion (une sélection navigateur + deux cas unitaires) ; RED supplémentaire **1 FAIL / 0 PASS / 1 skipped** sur la modification d'ID pendant un GET en vol. Journaux `.git/sc3-f02-viewer-red.log`, `.git/sc3-f02-edit-while-pending-red.log`.
- Sur le code final : **11 suites, 48 PASS / 0 FAIL / 0 skipped** (`.git/sc3-f02-viewer-final-tests.log`) : observations unitaires, API HTTP appairée, refus de scope/hôte, AutoMod décisions et persistance d'intentions, et **8 parcours Edge headless 320 px**, tous avec Twitch synthétique.
- `npm run build:types` : PASS ; `npm run check:browser-types` : PASS ; `npm run security:check` : PASS (**6 814 fichiers**) ; `git diff --check` : PASS. Logs `.git/sc3-f02-viewer-{types,browser-types,security,diff}.log`.

## Limites
L'historique observé est **volatile** : il ne survit pas au redémarrage du processus FIXE, ne couvre pas les événements manqués pendant la déconnexion et expire après 15 minutes. Il ne prétend pas représenter l'historique Twitch complet ni confirmer une action AutoMod par un HTTP 204. Pas de réception OAuth réelle, Android physique, laptop, OBS/Twitch public, installation, signature ou rollback. F02 reste **partial**, G2 **in_progress**, G3–G5 **open**. F05/mixeur et CONTINUITY concurrents conservés intacts.

**Suite utile :** qualification des scopes et de la présence EventSub sur un vrai compte, et traitement du stockage d'historique si une rétention au-delà de la session est décidée ; priorité globale de livraison maintenue à F10 installateur/repli, puis réception G3 autorisée.
