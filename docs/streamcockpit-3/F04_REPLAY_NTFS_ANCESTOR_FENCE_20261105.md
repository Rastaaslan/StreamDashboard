# F04 — Replays sous jonction NTFS : refus avant inspection du fichier (05/11/2026)

## Préflight et propriété
- Exécution exclusivement via Remote Desktop Commander sur FIXE Windows 11, dépôt canonique et branche `streamcockpit/3.0-full-experience`. Au départ HEAD `0409516e493adac7eb10e7fd405e029a164580d0`, upstream aligné, origin `Rastaaslan/StreamDashboard.git`. PLAN, matrice, CONTINUITY et MIGRATION lus avant toute modification. Aucun index.lock/merge/rebase ni verrou Flow actif ; Node, Java et OBS utilisateur observés sans interruption.
- Les fichiers modifiés par un autre propriétaire (les trois `streamcockpit-mixer*.js`, `tests/streamcockpit3-mixer-browser.test.ts` et `CONTINUITY.md`) sont restés intacts, non indexés. Le présent rapport tient lieu de continuité F04 en attendant la libération de `CONTINUITY.md`. Aucun accès à d'autres machines, à RC2, à F09-Q, à WorldPrep/Director/Crafty ou aux installations, secrets et profils utilisateur.

## Défaut reproduit, correction minimale
- Le refus lexical UNC/device/ADS avant `lstat` était déjà intégré, mais un chemin local `C:\…\linked\clip.mkv` traversant une **jonction NTFS parent** passait la validation. `lstat` du fichier enfant suit le parent redirigé ; cette inspection peut atteindre une cible hors du chemin local attesté. Le garde de source ClipForge possède déjà sa propre marche d'ancêtres, mais l'adaptateur OBS passif et `saveReplay()` inspectaient encore la feuille directement.
- Régression **avec véritable jonction Windows dans un dossier temporaire uniquement** : fichier synthétique dans le répertoire cible, lien de type `junction`, événement OBS WebSocket simulé. Avant correction, le chemin enfant a été remis à `lstat` : RED **0 PASS / 1 FAIL / 24 skipped** (`.git/sc3-f04-junction-red-20261105.log`). Aucun accès réseau UNC réel ni commande OBS publique.
- Correctif concentré dans `integrations/obs/src/client.ts` : nouveau `localReplayFileStat`, commun à `ReplayBufferSaved` et à la sauvegarde explicite, contrôle `lstat` de chaque répertoire parent sur Windows et refuse toute jonction/symlink ou parent non répertoire **avant la lecture de métadonnées du fichier final**. Le fichier final doit rester régulier, non vide et non symlink. Aucun retry OBS ni acceptation silencieuse. Test de la sauvegarde explicite vérifiant le refus, le résultat ACTION_UNCERTAIN et un seul `SaveReplayBuffer`.
- Garde volontairement restrictive : un répertoire OBS configuré à travers une jonction NTFS ne sera pas déclaré confirmé. Il faudra choisir un chemin local non redirigé ; aucune modification automatique des paramètres OBS.

## Qualification finale
- Régression isolée après correction : **1 PASS / 0 FAIL / 24 skipped** (`.git/sc3-f04-junction-green-20261105.log`).
- Trois suites ciblées (`obs-runtime`, `moments-obs-replay`, `replay-status-route`) : **43 PASS / 0 FAIL / 0 skipped** (`.git/sc3-f04-junction-TARGETED-20261105.log`).
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6750 fichiers avant présent document**) ; `git diff --check` PASS, avertissements CRLF uniquement. Logs `.git/sc3-f04-junction-{TYPES,BROWSER_TYPES,SECURITY}-20261105.log`.
- Revue ciblée `client.ts` + `obs-runtime.test.ts` : un garde asynchrone réutilisé dans les deux chemins et une régression couvrant une jonction réelle. Pas de build distribution ni tests généraux, pour ne pas concurrencer `dist` et les tâches existantes.

## Limites et suites
- Cette marche refuse les jonctions connues à l'instant des `lstat`, **sans garantir l'absence d'une race TOCTOU, ni caractériser tous les types de points de réanalyse ou les lecteurs mappés SMB** ; la validation matérielle réelle reste obligatoire. Le fournisseur OBS est simulé ; les accès au disque concernent uniquement une jonction créée et nettoyée en TEMP.
- `F04 partial`, `G2 in_progress`, `G3/G4/G5 open`. Aucun stream démarré/arrêté, aucune action Twitch publique, installation, signature, publication ni promotion de gate. Suite prioritaire : correction F05 par son propriétaire et réception physique G3 / preuves G4, sans rouvrir ClipForge avancé (V4).
