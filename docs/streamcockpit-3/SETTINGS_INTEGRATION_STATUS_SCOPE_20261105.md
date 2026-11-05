# SC3-SETTINGS-P03 — Statut des intégrations sans connexion fictive

**Date :** 05/11/2026, FIXE Windows 11 via Remote Desktop Commander exclusivement. **HEAD initial :** `f797dad`. **Périmètre :** sources de rendu Windows Administration/Android Plus, tests synthétiques, aucun appareil/installateur/profil utilisateur.

## Préflight et propriété
- `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` lus avant opération ; branche `streamcockpit/3.0-full-experience` sur `origin` GitHub attendu.
- Modifications préexistantes d'un autre propriétaire : les trois JS de mixeur F05, son test navigateur et `CONTINUITY.md`. Ces cinq fichiers sont **exclus du lot, de toute indexation et de toute réécriture**. Aucun verrou Git, merge ni rebase signalé ; verrou Flow non actif. OBS utilisateur présent, non manipulé.
- Aucune action Twitch/OBS, WebSocket, compte, installation, signature, sortie `dist`, autre appareil ou projet. Aucun passage G2–G5.

## Source factuelle et correction UX unique
- Le serveur FIXE produit `controlHub.integrations.discord`, `streamlabs`, `wizebot` sous `/api/v2/state` ; les états possibles sont CONNECTED, CONNECTING, DISCONNECTED, NOT_CONFIGURED, DEGRADED, ERROR, NOT_SUPPORTED. La page Connexions affichait trois boutons sans état, rendant indiscernables « configuré », « disponible » et « réellement connecté ».
- Nouvelle lecture **pure de l'instantané déjà reçu** dans `settings-view.js`, sans nouvelle API et sans requête. Un client sans FIXE associé affiche « inconnu » ; une régie hors ligne affiche « non vérifiable » même si un instantané ancien annonce CONNECTED ; une régie joignable affiche seulement le **dernier état communiqué**, avec réserves sur les droits et capacités OAuth. État manquant/inconnu -> « non communiqué », sans afficher de chaîne non contrôlée.
- WizeBot indique clairement que le connecteur API et une commande fonctionnant dans le chat Twitch ne sont pas la même chose. Boutons/actions originaux préservés, aucune connexion déclenchée. Configuration de comptes et statut fournisseur restent séparés.
- Ce lot touche le statut d'intégration uniquement. Le cas Google hors ligne a été traité en P02 et demeure intact. Regroupement OBS, Twitch, audio, planning, appareils, avancé déjà décrit dans `SETTINGS_OFFLINE_GOOGLE_SCOPE_20261105.md`.

## Qualification sur source de cette passe
- **RED avant correction : 0 PASS / 4 FAIL / 0 skipped** sur la suite nouvellement ajoutée (le test Edge a expiré faute d'élément ; ce n'est pas une erreur du navigateur lui-même), log `.git/sc3-settings-integrations-red-20261105.log`.
- Première campagne après correction : **23 PASS / 1 FAIL / 0 skipped** ; le sélecteur du test Google préexistant était ambigu car plusieurs paragraphes de statut existaient désormais. L'assertion a été rendue **spécifique à la carte Google** sans diminuer sa vérification.
- Campagne finale **5 suites / 24 PASS / 0 FAIL / 0 skipped**, tests de toutes les pages Settings avec **Microsoft Edge réel 320px**, et rendu d'états fournisseur synthétiques. Log `.git/sc3-settings-integrations-green-final-20261105.log`.
- `npm run build:types`, `npm run check:browser-types`, `node --check settings-view.js`, `npm run security:check` : PASS ; sécurité **6761 fichiers** ; `git diff --check` ciblé : PASS avec avertissement de conversion LF/CRLF uniquement. Log `.git/sc3-settings-integrations-static-20261105.log`.
- Tests du code et du vrai moteur Edge, **aucun** token réel, intégration WizeBot/Discord/Streamlabs live, parcours Android physique, migration, signature ou rollback. Pas de campagne générale et aucun PASS attribué aux sources F05 parallèles.

## Écarts restants
- Qualifier en G2 la fraîcheur des états au niveau des autres panneaux et distinguer configuration/scopes Twitch/Google des commandes réellement autorisées.
- Recevoir les états sur vrais FIXE/laptop/Android en G3 avec reconnexions, puis packaging identique et rollback/signatures G4 avant décision G5.
- F00–F10 **partial** ; G2 **in_progress** ; G3/G4/G5 **open**. `CONTINUITY.md` appartient encore au chantier F05 : la présente note fait office de continuité de ce lot, à reporter seulement quand la propriété est libérée. ClipForge avancé reste V4 selon `PLAN.md`.
