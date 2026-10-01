# CB-13 — Résilience du runtime OBS

Corrections réalisées sans changement visuel global :

- Une perte de connexion invalide les réponses en vol et les commandes en attente. La connexion devient disponible après lecture de l'état OBS.
- Reconnexion automatique après 2, 4, 8, 16 puis 30 secondes maximum ; une seule tentative à la fois. Les mutations ne sont jamais réessayées automatiquement.
- Timeout de 5 secondes par requête/handshake et lecture de contrôle toutes les 10 secondes. La fermeture arrête les reprises et le polling.
- Publication atomique des snapshots, ignorés si un événement plus récent ou une autre connexion les a remplacés.
- À la déconnexion, scènes et sources sont vidées. Le dernier état de diffusion reste accompagné de `streamingKnown: false` : une perte de télémétrie ne confirme pas un arrêt. Les états de connexion sont propagés au mobile.
- Préparation/démarrage/arrêt : lecture OBS préalable et confirmations liées à la même connexion. Un redémarrage pendant la scène End ne peut pas arrêter un nouveau stream.
- Contrôles des scènes, capacités audio, sources média et Browser Source timer. Le micro principal absent/renommé ne bascule pas sur un autre input.
- Inclusion des périphériques audio globaux OBS. Fin de la lecture soundboard et libération des listeners si OBS disparaît.
- Erreurs publiques et logs du client expurgés des messages serveur arbitraires ; authentification, indisponibilité et timeout restent identifiables.

Validation finale :

- `npm run build` : succès.
- `TMPDIR=$PWD/.tmp npm test` : 68 fichiers, 466 tests réussis.
- `TMPDIR=$PWD/.tmp node --test tests/node/*.test.mjs` : 64 tests réussis.
- `git diff --check` : succès.

Créer `.tmp` avant ces commandes : ce répertoire contourne l'indisponibilité de `/tmp` dans l'environnement. Les dépendances ont été installées avec `npm ci --ignore-scripts`.

Les tests utilisent des transports simulés avec horloge contrôlée et le véritable client `obs-websocket-js` face à un serveur local parlant OBS v5 MessagePack avec authentification. Ils vérifient notamment disparition pendant le live, reconnexion et absence de renvoi de StartStream. OBS Studio/Electron et une diffusion réelle n'ont pas été lancés ; la validation matérielle audio/vidéo reste à effectuer sur un poste OBS.

## Revue 1 — cohérence mobile

- La réconciliation start/stop exige `connected: true`, `streamingKnown: true` et la valeur de diffusion attendue dans les deux interfaces et dans le contrôleur partagé. Une valeur conservée après perte OBS ne peut plus transformer un échec en succès apparent.
- Les affichages distinguent « OBS : état du live inconnu », connexion en cours, erreur et déconnexion. Une confirmation indépendante est libellée « En direct · Twitch » ; elle ne sélectionne pas l'action start/stop OBS.
- Les boutons de diffusion restent désactivés tant que la télémétrie OBS n'est pas confirmée. La version du cache mobile est incrémentée.
- Dix tests Node supplémentaires exécutent les fonctions de rendu et les handlers des deux interfaces avec un DOM simulé : live → perte → connexion → retour confirmé, Twitch indépendant, start/stop échoués avec valeur conservée et refus de télémétrie manquante.
- Vérifications supplémentaires : `node --check` sur `mobile.js`, `preview.js` et `command-controller.js`, réussies.
