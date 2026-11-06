# SC3 SETTINGS — garde serveur OBS : remplacer OU effacer (06/11/2026)

## Défaillance reproduite et correction

La modification du formulaire du 06/11 empêchait de demander simultanément une substitution du mot de passe OBS et son effacement. Cependant le backend historique `PUT /api/v1/settings` acceptait les deux champs, puis effaçait le secret **sans avertissement** en ignorant la nouvelle valeur. L'API v2 rejette déjà cette combinaison en amont, mais la v1 restait exposée.

RED sur FIXE, tests HTTP avec serveur éphémère et OBS explicitement désactivé : **1 PASS / 1 FAIL**. L'échec attendu constatait un HTTP 200 au lieu du HTTP 400 en cas de commande v1 contradictoire. Aucun serveur de production n'a été modifié.

Correction minimale : dans `apps/server/src/index.ts`, le handler partagé `settingsUpdate` refuse la combinaison `clearObsPassword === true` + `obsPassword` non vide **avant de modifier les autres paramètres**. Aucun changement de règle d'autorité, de route, de schéma, de secret ou de logique d'OBS. La chaîne vide reste explicitement « conserver », un clear isolé conserve son effet intentionnel.

## Qualification du code source — FIXE seul

- Suite dédiée : `tests/streamcockpit3-settings-obs-password-server.test.ts` démarre un serveur HTTP temporaire (`obsEnabled:false`), vérifie le refus atomique v1 sans mutation d'autres réglages, la conservation sur champ vide, la protection v2 par révision, l'effacement isolé accepté et le refus des révisions obsolètes. Aucun appel vers une régie ni un fournisseur public.
- Campagne GREEN **4 fichiers, 26 PASS / 0 FAIL / 0 skipped** : tests serveur nouveaux, UI OBS password, topologie Settings, intégrations Settings. **5 scénarios Edge réels** en headless contre des fixtures locales ; 2 vrais tests HTTP locaux utilisent leur propre port éphémère. Ce ne sont pas des essais sur les installations.
- `npm run build:types` **PASS**, `npm run check:browser-types` **PASS**, `npm run security:check` **PASS (6 766 fichiers)** et `git diff --check` **PASS**. Warnings non bloquants : `node:sqlite` experimental et conversion LF/CRLF. Pas de build de distribution ni de suite générale.
- Préflight : PLAN, matrice, CONTINUITY, MIGRATION lus ; branche `streamcockpit/3.0-full-experience` et remote GitHub vérifiés ; HEAD initial `7526b5f` égal upstream, pas de `index.lock`, pas de processus éditeur node/git actif ; manifeste historique `lotComplete:true`, `missionDelivered:false`, `publicationAuthorized:false`. Aucun lancement OBS, OBS/Twitch public, signature, publication, accès laptop/Android, RC2, WorldPrep, Director, Crafty, ni modification des profils/secret réels.
- Cinq fichiers déjà modifiés par un **autre propriétaire F05**, dont `docs/streamcockpit-3/CONTINUITY.md`, sont maintenus inchangés et hors index par ce chantier ; ce journal de lot distinct vaut handoff jusqu'à libération du propriétaire.

## Prochain travail sans confusion de gates

Vérifier, dans une future passe désignée, que l'ancien endpoint v1 suit la même politique pour les valeurs non booléennes de `clearObsPassword` et les charges malformées, sans rompre les intégrations existantes. Puis auditer les doubles parcours OBS/agent et les réglages avancés non utilisés. La décision de PLAN prime : **ClipForge avancé/FFmpeg reste V4**. F00 reste `partial`, G2 `in_progress`, G3/G4/G5 `open`, G0/G1 historiquement qualifiés. Aucune RC ni APK/EXE à déployer sans réception et accord opérateur.
