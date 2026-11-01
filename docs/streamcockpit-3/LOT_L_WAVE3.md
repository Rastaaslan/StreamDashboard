# Lot L — vague 3, protections de l’Agent OBS

Base `81b8878`, branche `streamcockpit/3.0-lot-l`, worktree exclusif `/home/damien/StreamCockpit-3.0-Lot-L`. PLAN, CONTINUITY, matrice et rapports A–H lus avant modification. F00–F10 restent PARTIAL, G2 en cours, G3–G5 OPEN. Matrice et CONTINUITY inchangées.

## Correction livrée

- `apps/agent/src/real-obs-transport.ts` : les RPC sont maintenant des callbacks invoqués **après** contrôle des signaux. Avant correction, `bounded(client.call(...))` envoyait le RPC avant de constater une connexion invalidée. Toute erreur RPC/timeout invalide définitivement cette connexion ; une réponse tardive ne la réhabilite pas. Contrôle également après résolution du RPC, avant restitution du résultat.
- `apps/agent/src/production-obs-writer.ts` : une perte de connexion invalide aussi le signal d’exécution. Détection d’un peer déjà déconnecté au démarrage, refus de publication après perte ou avec état invalide, contrôle de perte après les lectures de préflight et avant réservation. Une perte pendant la persistance de réservation interdit l’effet et laisse le reçu incertain.
- `tests/streamcockpit3-agent-fencing.test.ts` : 16 tests nouveaux, transports injectés, journaux exclusivement temporaires. Aucun socket OBS ou HTTP ouvert.
- Le présent rapport.

Ces corrections ciblées de fichiers existants sont nécessaires : ajouter une façade indépendante laisserait le chemin de production vulnérable. Aucun nouvel exécuteur, aucune nouvelle autorité ni minuterie. `windows-readonly-service.ts` appelle déjà `ProductionObsWriter.open` avant de publier sa gateway ; il hérite donc du refus au démarrage. Ce chemin a été contrôlé par lecture, pas en démarrant le service réel.

## Audit et portée de la preuve

| Composant audité | Protection constatée / limite |
|---|---|
| `production-obs-writer.ts` | Identité contrôleur épinglée par l’appelant authentifié, cible locale, capacités, confirmation critique, révision fraîche, une commande en vol, verrou exclusif du journal, epoch persistante au redémarrage, relecture OBS avant confirmation. Verrou limité au chemin du journal : plusieurs répertoires peuvent créer plusieurs autorités. |
| `command-guard.ts` | Validation identité syntaxique/capacité/confirmation/âge/révision ; déduplication en mémoire. Ce garde seul n’est ni une authentification ni un exécuteur durable. |
| `command-reservation.ts` | Réservation `uncertain / PRE_EXECUTION_RESERVED` persistée avant permission d’effet ; doublon persistant et panne journal refusés. L’authentification reste responsabilité de l’appelant. |
| `durable-receipts.ts` | Relecture sous verrou exclusif, écriture atomique, fsync fichier et répertoire sous Linux, doublons/corruption refusés. Incertitude bloque le writer au redémarrage. Verrous résiduels non supprimés automatiquement. Durabilité du rename sur coupure électrique Windows non prouvée. |
| `windows-readonly-service.ts` | Mode read-only par défaut, opt-in écriture explicite, contrôleur/grants configurés, mTLS requis avant writer, chemin de journal sous APPDATA. Pas d’attestation autonome du rôle physique FIXE : config locale et identité doivent être provisionnées correctement. |

Les tests refusent les acteurs non épinglés `laptop` et `android`, l’identité vide et la capacité absente. Ils ne prouvent **pas** qu’un laptop configuré frauduleusement comme contrôleur/Agent ne pourrait pas utiliser ces identités. La gateway existante dérive l’acteur du certificat épinglé et de sa configuration ; aucune autorisation n’est ajoutée depuis un rôle auto-déclaré dans une commande. Attestation du rôle FIXE et exclusion globale des autres exécuteurs restent un travail d’intégration avec l’autorité existante, sans ajouter de seconde couche d’autorité.

La relecture est celle d’OBS local ; elle ne prouve pas que Twitch diffuse publiquement. Une observation absente/périmée reste indisponible, et une action sans preuve reste `uncertain`, jamais `confirmed`. Aucune UI n’est modifiée ici : vérifier son affichage UNKNOWN/échec dans le parcours intégré. Le minuteur maître n’est pas modifié ni instancié ; aucun intervalle supplémentaire.

## Scénarios exécutés

Déconnexion/abort/close avant RPC : zéro appel au client, y compris lectures et changement de scène. Timeout : réponse tardive ignorée, deuxième envoi interdit. Ack simultané à une perte : rejet. Writer : perte pendant startup, préflight ou réservation ; double commande concurrente ; faux ack sans changement relu ; observation périmée ; identité/capacité refusées ; deuxième writer sur même journal ; révision ancienne après restart ; reçu confirmé ancien non rejoué ; reçu incertain empêchant restart ; journal corrompu et verrou de crash préservés.

Crash réel de processus Linux : sous-processus Node important le vrai writer avec peer factice, arrêt `process.exit(73)` à l’entrée de l’effet, donc après réservation durable et avant toute mutation. Le parent constate le reçu incertain et le refus de restart avec verrou. Après retrait **explicite dans la fixture temporaire** du verrou du processus mort, restart toujours refusé avec `RECONCILIATION_REQUIRED`, avant ouverture du peer. Ce n’est pas un test de coupure électrique ni du Service Control Manager Windows.

## Commandes et résultats

Toutes exécutées dans ce worktree. Processus Codex constaté nice 15 et ionice idle ; commandes de vérification préfixées `nice -n 15 ionice -c 3` (priorité effective au moins aussi basse), au plus trois commandes de vérification simultanées et un worker Vitest. Aucun npm install ni build de distribution.

Commande de suite finale (préfixe de priorité ci-dessus) :

```sh
node node_modules/vitest/vitest.mjs run tests/streamcockpit3-agent-fencing.test.ts tests/streamcockpit-production-obs-writer.test.ts tests/agent-v2-reservation.test.ts tests/agent-v2-durable-receipts.test.ts tests/agent-v2-contract.test.ts tests/agent-v2-windows-readonly.test.ts tests/agent-v2-managed-runtime.test.ts --maxWorkers=1 --configLoader runner --no-cache
```

- Premier passage avant ajout du crash processus : code 0, 50/50 tests, 7 fichiers (`/tmp/lot-l-wave3-tests.log`).
- Passage intermédiaire avec crash : code 1, 51 PASS / 1 FAIL, `spawnSync EPERM` sur les pipes du sous-processus (`/tmp/lot-l-wave3-tests-final.log`). Fixture adaptée à `stdio: 'ignore'`, code de sortie et journal toujours vérifiés ; aucune permission étendue.
- Reprise ciblée du nouveau fichier : code 0, 16/16 (`/tmp/lot-l-wave3-crash.log`).
- Suite finale : code 0, 52/52 tests, 7 fichiers (`/tmp/lot-l-wave3-tests-verified.log`).
- `npm run build:types` : premier passage code 0 ; passage intermédiaire code 2 sur annotation `this` manquante dans le spy ajouté, corrigée ; dernier passage code 0 (`/tmp/lot-l-wave3-types-verified.log`).
- `npm run security:check` : code 1 avant analyse, socket IPC tsx interdit `listen EPERM` (`/tmp/lot-l-wave3-security.log`).
- `node --import tsx scripts/security-check.ts` : même script, lanceur sans socket IPC ; code 0, 645 fichiers (`/tmp/lot-l-wave3-security-direct.log`).
- `git diff --check` : code 0. Contrôle du diff indexé et commit non exécutés : échec préalable de `git add` (voir ci-dessous).

## Non branché / non qualifié

Aucun OBS/Twitch réel, secret réel, installation Windows, profil ou machine utilisatrice consulté ou modifié. Aucun push/deploy, écoute réseau, build Windows/APK, modification Electron/server/mobile/ClipForge. Les mots de passe des fixtures sont des chaînes synthétiques. Ticket préexistant `docs/streamcockpit-3/LOT_L_TICKET.md` conservé hors commit.

Le writer reste volontairement bloqué après incertitude : pas de retry silencieux ni reprise automatique à la reconnexion. Un restart sûr exige une réconciliation opérateur ; aucun outil de réconciliation ni suppression de reçu n’est livré. Une commande déjà partie peut produire son effet après timeout : le correctif empêche le rejeu, il ne peut annuler un RPC distant.

Restent à prouver : unicité de l’autorité sur FIXE entre configurations/processus distincts et avec les chemins legacy, attestation du rôle local, service Windows réel startup/restart/crash, durabilité disque Windows, refus et rendu sur laptop/Android réellement connectés, synchronisation du minuteur existant et parcours mTLS complet. Le redémarrage de l’observateur read-only ne réarme pas le writer fautif. **G3 reste explicitement OPEN**, ainsi que G4/G5 ; ce lot ne qualifie pas F00 autonome complet.

## Commit bloqué par le montage Git

Tentative : `git add apps/agent/src/production-obs-writer.ts apps/agent/src/real-obs-transport.ts tests/streamcockpit3-agent-fencing.test.ts docs/streamcockpit-3/LOT_L_WAVE3.md`, puis contrôles indexés et `git commit -m "fix(agent): fence OBS dispatch after disconnect and timeout"` prévus en chaîne conditionnelle. `git add` sort avec **128** :

```text
fatal: Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-L/index.lock': Read-only file system
```

Le commit n’a donc pas été lancé et **aucun commit n’est revendiqué**. Les quatre fichiers restent dans le worktree ; le ticket reste hors index. Aucun contournement du montage, aucune copie de dépôt ni écriture hors worktree tentée. L’intégrateur devra effectuer l’indexation/commit sur cette branche avec des métadonnées Git accessibles en écriture.
