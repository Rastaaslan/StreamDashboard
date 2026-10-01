# CB-18 — fiabilité Desktop en live

Audit du worktree fourni, référence du ticket : CB-7 `9213aecbd8dff01523e9ba164780e319c82e7076`.
Pas de changement d’UI, de déploiement ni de publication.

## Défauts corrigés et preuves

| Chemin | Défaillance | Correction / preuve |
| --- | --- | --- |
| OBS | Une commande sans réponse bloque la file ; la perte de transport ne termine pas nécessairement les promesses de la bibliothèque. | Requêtes et handshake bornés à 10 s, déconnexion et erreur explicite, aucun rejeu automatique. `obs-recovery.test.ts` : réponse perdue à StopStream, un seul envoi. |
| OBS | Connect/close et refresh/close peuvent restaurer un état périmé. | Connexions coalescées, lifecycle sérialisé, générations de configuration et contrôles après les attentes. Tests de connexion et télémétrie tardives après close. |
| OBS | La dernière valeur de streaming peut confirmer une commande alors que le transport est déconnecté. | Confirmation exigeant un état connecté et connu ; test de télémétrie périmée. |
| Twitch EventSub | Le close de l’ancien socket annule le watchdog du nouveau pendant une migration ; aucun watchdog avant welcome. | Callbacks liés au socket courant, watchdog dès connexion, abonnements tardifs ignorés. Tests de migration, absence de welcome et arrêt pendant abonnement. |
| Twitch EventSub | Une trame JSON `null` déclenche une exception ; une URL de reconnexion arbitraire est suivie. | Validation de l’enveloppe et restriction à l’hôte EventSub en WSS ; tests de trames malformées et URL étrangère. |
| Streamlabs | Timeout d’authentification laissant le socket actif ; connexion tardive réactivant un provider arrêté ; échec initial sans recovery. | Fermeture après timeout, coalescence, générations et reconnexion exponentielle plafonnée à 30 s. Tests de shutdown pendant connexion, événements tardifs et 5 minutes de panne simulée. |
| Streamlabs heartbeat (revue 1) | Engine.IO v3 attend des pings client ; après authentification, aucun timer ne détectait une connexion silencieuse. | Lecture de la trame d’ouverture, ping client puis délai de pong ; fermeture locale et reconnexion même sans événement close distant. Nettoyage sur shutdown, close et error. Tests du cycle ping/pong, pong absent, reconnexion et shutdown après authentification. |
| Journal durable (revue 1) | Les clés numériques sont triées par `Object.keys` : à capacité maximale, le nouveau reçu numérique était évincé immédiatement. | Ordre chronologique persisté séparément dans `commandReceiptOrder`. Test API avec 5 000 anciens reçus, insertion de `12345678`, restart, nouvelle insertion et replay refusé. |
| Commandes | Journal volatil : un retry avec le même commandId après restart réexécute une mutation. Une rafale peut évincer une commande encore en cours. | Intention persistée avant effet externe ; 409 `COMMAND_ALREADY_RECEIVED` après restart ; aucune éviction des promesses en cours. Test API : 30 requêtes concurrentes, un seul ajout au timer, état préservé et replay refusé après restart. |
| Shutdown | Providers fermés et sauvegarde finale avant la fin des handlers HTTP et commandes acceptées. | Arrêt de l’admission HTTP, drainage des handlers et files avant fermeture des providers et sauvegarde finale ; suppression des timers recréés pendant le drainage. Test unitaire du drainage de commandes et intégration restart. |
| Electron | Une erreur de log dans un handler de crash crée une nouvelle promesse rejetée ; destruction de la fenêtre pendant Réessayer déclenche Quitter. | Rejets terminaux traités, fermeture automatique suspendue pendant boot ; arrêt runtime partageant la même promesse. Revue statique et compilation, sans session Electron Windows dans cet environnement. |
| WebSocket LAN | Erreur socket sans listener pouvant remonter au processus. | Listener d’erreur branché au diagnostic existant. |

## Autres chemins examinés

- JSON et secrets : écritures sérialisées, snapshot avant écriture, fichier temporaire + fsync + rename ; tests existants de concurrence, corruption et migration des secrets.
- Twitch/Google HTTP : timeouts existants ; absence de retry automatique des commandes sensibles. Les tests existants couvrent OAuth, scopes, contrôle live et erreurs réseau.
- Mobile : contrôleur de commandes avec verrou par ressource et réconciliation sans renvoi ; reconnexion du transport sans file de commandes live hors ligne. Suites existantes de transport, authentification, redaction et politique remote.
- Start/stop live : file unique, vérification de l’état OBS avant commande et confirmation après commande ; suites `command-service` et `live-stabilization`.
- Remote/secrets : contrôle des surfaces publiques, authentification LAN, scopes et absence de secrets dans les snapshots couverts par les suites existantes et `security:check`.

## Bornes et limites explicites

- Reconnexions de transport continues tant que le provider est actif, avec un seul timer et délai exponentiel plafonné à 30 s ; arrêt annulant les retries. Ce plafond borne la fréquence, pas la durée totale d’une panne.
- Heartbeat Streamlabs : intervalle annoncé borné entre 1 et 60 s, timeout de pong entre 1 et 30 s ; silence détecté en 90 s maximum après le dernier pong (hors suspension du processus). Handshake incomplet borné par le timeout de connexion existant de 15 s.
- Migration du journal : les fichiers sans liste chronologique conservent leurs reçus, avec l’ordre d’énumération historique comme ordre initial ; leur chronologie numérique passée ne peut pas être reconstruite. Toute nouvelle insertion utilise la liste persistée.
- Journal durable : 5 000 derniers identifiants de commandes dashboard ; cache de réponses en mémoire : 500 opérations terminées, plus opérations en cours. Un résultat incertain exige une vérification de l’état et une nouvelle action explicite. Ce n’est pas une garantie exactly-once universelle : les anciennes API sans commandId et les endpoints spécialisés gardent leurs propres règles de déduplication. Aucun replay automatique n’est ajouté côté client.
- Tests réseau avec doubles déterministes et API locale réelle. Pas de live Twitch, OBS réel, panne électrique ni validation visuelle Electron Windows. L’atomicité applicative ne garantit pas la résistance à toutes les défaillances du matériel de stockage.

## Validation

Commandes depuis la racine, avec `TMPDIR` dans le worktree car `/tmp` est inaccessible dans le sandbox :

- `TMPDIR="$PWD/.tmp" npm test` : 468 tests réussis dans 68 fichiers, dont 20 nouveaux tests de recovery/stress (8 ajoutés après la revue 1).
- `TMPDIR="$PWD/.tmp" npm test -- --run tests/desktop-recovery.test.ts tests/streamlabs-transport.test.ts tests/api-v1.test.ts tests/obs-recovery.test.ts` : 43 tests réussis dans 4 fichiers.
- `npm run build` : réussi (TypeScript et copie des assets runtime).
- `TMPDIR="$PWD/.tmp" npm run security:check` : réussi, 192 fichiers contrôlés (Electron, secrets, remote et mobile).

- `git diff --check` : réussi.

Les premières exécutions sans TMPDIR ont échoué avant les tests / le contrôle de sécurité (création de répertoire dans `/tmp`). Les relances utilisent un répertoire autorisé.
