# StreamCockpit 3.0 — F04 : vérification du journal avant toute prévisualisation

**Lot du 06/11/2026 sur FIXE, source uniquement.** Branche `streamcockpit/3.0-full-experience` ; HEAD de départ `22af6ee` sur `origin` `https://github.com/Rastaaslan/StreamDashboard.git`. Sources d'autorité lues : PLAN.md, feature-matrix.json, CONTINUITY.md et MIGRATION_TO_FIXE_20261101.md. Ni lock d'index Git, ni rebase/merge, ni écrivain Node du dépôt constatés avant intervention. Fichiers F05 mixeur, test F05 et CONTINUITY.md déjà modifiés par un propriétaire distinct : **intouchés et non indexés**. OBS présent au niveau processus, sans action ni consultation d'installation.

## Défaut réel reproduit

La page de marqueurs/clips désactivait le bouton « Vérifier » lorsqu'un journal local de reçus Twitch était corrompu, mais le gestionnaire `submit` ne recontrôlait pas `storageBlocked`. Un événement `submit` synthétique passait la barrière du bouton désactivé et envoyait un `POST /api/v1/twitch/advanced/moment/preview` vers la fonction de requête. **Test RED dans vrai Microsoft Edge à 320 px : 0 PASS / 1 FAIL**, avec un appel inattendu au preview. Pas d'appel réseau Twitch réel (fournisseur mocké).

## Correction étroite

`apps/mobile/control/streamcockpit-twitch-moments.js` : refus immédiat d'un formulaire lorsque le stockage est déjà bloqué, puis diagnostic local en lecture seule **au moment même de la soumission**. Si un indice incertain ou une corruption est découvert sans événement `storage` (même fenêtre ou WebView repris), le code reconstitue l'état bloqué/GET-only, invalide l'ancien consentement et n'appelle pas la prévisualisation. Aucun traitement automatique des références, aucune mutation de journal, aucun retry, aucun nouveau droit d'action Twitch/OBS. Le `POST /confirm` continue de passer exclusivement par son verrou et ses gardes propres.

## Qualification du code final

- Cinq suites Vitest ciblées : **56 PASS / 0 FAIL / 0 skipped** ; **14 scénarios Microsoft Edge réels** en navigateur isolé 320 px, dont deux nouveaux tests de contournement d'un formulaire désactivé et de corruption injectée sans événement de stockage. Les autres tests HTTP se servent de fournisseurs simulés.
- TypeScript `npm run build:types` **PASS** ; JS navigateur `npm run check:browser-types` **PASS** ; `node --check` module F04 **PASS** ; `npm run security:check` **PASS (6 773 fichiers avant cette documentation)** ; `git diff --check` **PASS** (avertissement de fin de ligne LF/CRLF seulement).
- Nouveaux tests : `tests/streamcockpit3-f04-blocked-submit-guard.test.ts` ; les tests préexistants de requêtes, stockage, reprise mono/multionglets restent PASS.
- Diff revu : une seule fonction de production plus un nouveau fichier de tests, ce rapport et la référence dans la matrice ; pas de refonte, de build/package général, d'installation ni de signature.

## Limites et prochain pas

Les deux nouveaux scénarios sont du vrai Edge sur FIXE mais restent **synthétiques** : corruption artificielle de `localStorage`, requête mockée, pas de WebView Android physique ni de reprise secteur. Aucune commande Twitch publique, commande OBS, clip/marker réel, installation, secret, RC2, F09-Q ou autre machine/projet touchés. **F04 reste partial ; G2 in_progress ; G3–G5 open.** ClipForge avancé reste V4 selon le PLAN actuel ; prochaine priorité à la réception G3 réellement autorisée et aux écarts G2 pertinents, sans accumulation artificielle de gardes F04.
