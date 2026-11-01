# Lot K — ClipForge offline, troisième vague

Base `81b8878`, branche `streamcockpit/3.0-lot-k`, seul worktree `/home/damien/StreamCockpit-3.0-Lot-K`. PLAN, CONTINUITY, matrice et rapports A–H lus avant implémentation. F00–F10 restent PARTIAL, G2 en cours, G3–G5 OPEN. Matrice et CONTINUITY inchangées ; ticket K préexistant exclu du commit.

## Fichiers livrés

- `packages/core/src/streamcockpit-clipforge-plan.ts` : validation segment/métriques, plan FFmpeg déterministe 9:16 crop/pad, sous-titres WebVTT séparés, limites fixes.
- `apps/server/src/streamcockpit-clipforge-pipeline.ts` : source locale autorisée, réservation exclusive durable, orchestration injectable, annulation, vérification après encodage, manifeste JSON déterministe.
- `apps/server/src/streamcockpit-clipforge-executor.ts` : adaptateur Linux FFmpeg/FFprobe, arguments sans shell, priorité basse, limites noyau CPU/fichier/mémoire, arrêt SIGKILL et attente de fermeture.
- `tests/streamcockpit3-clipforge.test.ts` : 48 cas pipeline/core, fichiers synthétiques temporaires, exécuteur factice.
- `tests/streamcockpit3-clipforge-executor.test.ts` : 8 cas adaptateur avec processus simulé ; lancement réellement absent également testé dans la suite pipeline.
- Le présent rapport.

## Contrat utilisable par intégration explicite

Importer directement `ClipForge` et éventuellement `LinuxClipExecutor`. Aucun entrypoint, route ou barrel partagé n'est modifié. L'hôte fournit deux répertoires existants séparés : sources autorisées en lecture et exports privés (propriétaire UID courant, mode 0700). Les racines ne peuvent se contenir mutuellement. L'adaptateur Linux reçoit les chemins absolus de FFmpeg, FFprobe, prlimit, nice et ionice issus d'une configuration de confiance ; aucun téléchargement ni installation automatique.

`prepare(jobId, { relativePath, sha256 }, segment, abortSignal?)` reçoit un identifiant unique, une autorisation de source fournie par l'hôte et un segment `{ startMs, endMs, fit: 'crop'|'pad', captions? }`. L'empreinte n'est pas un contrôle d'identité : le registre des autorisations doit être construit côté hôte après consentement, jamais depuis un grant auto-déclaré dans une requête client. Le module ouvre la source en lecture seule, vérifie type/taille/SHA-256 avant toute sonde média, puis mesure durée et géométrie via l'exécuteur. Les métadonnées client ne constituent pas une preuve de durée.

Les timestamps sont des offsets en millisecondes entières dans le média, sans horloge live ni minuteur maître. Durée de segment maximale 120 s ; source maximum 512 MiB et durée mesurée maximum 24 h ; dimensions 16–8192. Export 360×640, pixels carrés, 30 fps, H.264/AAC, audio facultatif, métadonnées et chapitres supprimés. Crop centré ou padding centré. Captions : jusqu'à 100 textes de 200 caractères, offsets relatifs au segment, ordonnés sans chevauchement, sans balisage ni contrôles. Export WebVTT séparé uniquement, aucun texte interpolé dans un filtre ou une commande. Sous-titres incrustés/transcription automatique non implémentés.

La traversée est rejetée ; chaque ancêtre est ouvert via un descripteur de répertoire épinglé et O_NOFOLLOW, y compris les racines. Les liens symboliques sont refusés. Le fichier source est transmis par FD en lecture seule ; FFmpeg ne reçoit pas son chemin utilisateur. L'empreinte et les propriétés du fichier (taille, timestamps, nombre de liens) sont revérifiées après encodage. Une modification détectée interdit PREPARED. Les sorties sont créées exclusivement, sans écrasement ni suppression, dans la racine privée épinglée. Les répertoires restent une frontière de confiance contre un autre processus de même UID ; ce module ne prétend pas isoler un attaquant ayant cet UID.

Le plan est une liste d'arguments fixes, sans shell, URL ni interpolation de chemin/texte. Formats d'entrée limités à MOV/MP4 et Matroska/WebM, protocoles file/pipe uniquement. L'adaptateur ne transmet pas l'environnement utilisateur et ignore stderr. Les erreurs publiques sont des codes fixes, jamais les messages des dépendances, chemins, stdout ou credentials. Le manifeste contient empreintes, métriques, segment, captions et nom relatif de sortie ; pas de chemin absolu, heure courante, token ou payload Moments brut. Les captions sont du contenu volontaire de l'utilisateur, pas un canal de diagnostic : l'hôte doit y fournir exclusivement du texte destiné à être exporté.

## Résultats, panne et reprise

- `PREPARED` signifie sortie locale non vide, sous limite, sonde confirmant 360×640 et durée attendue à ±250 ms, source revérifiée, sortie et manifeste synchronisés. Ce n'est ni une publication Twitch, ni une preuve de marqueur distant, ni une qualification de lecture sur appareil.
- `FAILED` signale une validation impossible, un code FFmpeg non nul ou une sortie absente/vide/incohérente. Un fichier vide précréé ne vaut jamais succès.
- `CANCELLED` indique une annulation/expiration observée après arrêt de l'exécuteur ; aucun résultat tardif n'est promu PREPARED.
- `UNKNOWN` couvre perte du reçu d'exécution, exception pendant encode, persistance ambiguë et tout job déjà réservé. Aucun retry automatique.

Avant encode : création exclusive et fsync de `<jobId>.intent` portant UNKNOWN, puis fsync du répertoire. La réservation reste présente après tous les résultats. Un second appel ou redémarrage avec le même ID retourne UNKNOWN, y compris si un manifeste semble complet. Des instances concurrentes ne peuvent encoder deux fois le même job. Une instance refuse également un second job simultané (BUSY).

L'intégrateur doit afficher les codes/statuts et fournir une réconciliation opérateur : vérifier arrêt de l'ancien exécuteur, fichier et manifeste, conserver les preuves. Aucun outil de réconciliation ni promotion automatique n'est livré. Les fichiers partiels sont conservés ; nettoyage/rétention uniquement dans la racine d'exports et sur décision explicite ultérieure. Les recordings sources ne sont jamais modifiés, déplacés ou supprimés.

L'interface `ClipExecutor` impose des sondes fiables et un arrêt effectif avant résolution/rejet. Un adaptateur distant qui perd la connexion doit lever et rester UNKNOWN ; il doit lui-même garantir la terminaison avant libération des descripteurs. Un adaptateur arbitraire non coopératif n'est pas sécurisé par la seule interface TypeScript. Celui livré utilise SIGKILL et attend `close`.

## Ressources

Un thread de décodage/filtrage/encodage ; nice +15 et ionice idle ; prlimit CPU 120 s, espace adressable 1 GiB, fichier 64 MiB, core dumps interdits. Délai de garde 180 s avec annulation ; ce délai concerne seulement le travail offline, aucune autorité d'horloge live. Espace disque libre d'au moins 65 MiB requis avant réservation. FFmpeg reçoit aussi `-fs` ; atteindre la limite exacte est un échec, pas un clip complet. Outils de limitation absents : échec fermé, aucun fallback sans limites.

Ces limites sont par processus/job, pas un quota global ni une garantie de débit CPU. Avant déploiement, sérialiser les instances de la file d'exports et prévoir quotas/rétention du volume privé ; le préflight disque seul n'empêche pas un autre logiciel de consommer l'espace. Le plafonnement noyau et le débit réel n'ont pas été mesurés avec FFmpeg. L'adaptateur n'est pas une sandbox de sécurité pour vulnérabilités de codecs ; confinement OS supplémentaire à prévoir pour médias hostiles.

## Vérifications et codes de sortie

Commandes finales dans ce worktree (priorité CPU/I/O basse, au plus trois contrôles indépendants simultanés, Vitest un seul worker) :

| Commande | Code / résultat |
|---|---|
| `nice -n 15 ionice -c 3 bash -c 'command -v ffmpeg'` | 1, aucun chemin trouvé |
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-clipforge*.test.ts tests/streamcockpit3-moments.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 0, 89/89 PASS, 3 fichiers (56 nouveaux + 33 Moments) |
| `nice -n 15 ionice -c 3 npm run build:types` | 0, typage global sans émission |
| `nice -n 15 ionice -c 3 npm run security:check` | 1, EPERM socket IPC `/tmp/tsx-1000/26.pipe`, avant exécution du contrôle |
| `nice -n 15 ionice -c 3 node --import tsx scripts/security-check.ts` | 0, même script, 649 fichiers vérifiés |
| `nice -n 15 ionice -c 3 git diff --check` | 0 |
| `nice -n 15 ionice -c 3 git add <les six fichiers livrés ci-dessus>` | 128, index Git sur filesystem en lecture seule ; aucun staging/commit |
| `git diff --no-index --check /dev/null <fichier>` sur chacun des six nouveaux fichiers, sous nice/ionice | 1 pour chaque fichier (diff nouveau), aucun diagnostic whitespace |

Passes intermédiaires : 75 tests PASS (code 0), puis 86 PASS / 1 FAIL (code 1). Le test de remplacement de source avait révélé que ctime/mtime seuls peuvent manquer un unlink sur un filesystem à précision limitée ; contrôle du nombre de liens ajouté. Ensuite 87/87 PASS (code 0), puis ajout concurrence inter-instances et échec de persistance : 89/89 PASS. Une passe intermédiaire de 89 tests a été lancée sans préfixe nice/ionice explicite ; la vérification finale ci-dessus a été relancée avec le préfixe requis. Aucun échec masqué.

Couverture : traversée/chemins absolus/protocole/injection, symlinks feuille/ancêtre/racine/sortie, source absente ou non autorisée, métriques/durées/captions invalides, source modifiée/remplacée, collisions et reprise UNKNOWN, concurrence, code FFmpeg non nul, absence de sortie utile, sortie trop grosse, mauvais ratio/durée, déconnexion avant sonde et pendant encode, annulation avant/pendant, persistance en échec, disque insuffisant et source trop grosse. Adaptateur : commande sans shell/env sensible, limites et FD, timeout, annulation en attente de close, sortie diagnostic bornée, métriques invalides, outil absent. Fixtures uniquement sous `/tmp`, aucun média utilisateur encodé.

## Limites et branchements non faits

**Encodage réel NON VALIDÉ** : FFmpeg absent du PATH, aucun binaire installé/téléchargé. Les fixtures de succès sont synthétiques et l'exécuteur factice ; aucun MP4 réel n'est revendiqué. L'adaptateur Linux et ses arguments doivent être vérifiés avec les versions installées de FFmpeg/FFprobe avant activation. Pas de validation Windows, Android, lecture audiovisuelle, CPU réel, panne électrique, ni crash système réel dans les nouveaux tests.

Restent : authentification et registre de grants côté hôte, association explicite segment/source aux Moments existants, file de travail et annulation UI, réconciliation/rétention, transport et intégration serveur/mobile, déploiement privé de l'exécuteur avec tests média réels. Aucun branchement à `index.ts`, Moments, Twitch, agent ou `mobile/control.js`. Aucun marqueur Twitch créé ou confirmé ; le manifeste indique explicitement `not-created-or-confirmed` et ne transforme aucun statut Moments en confirmation. Toute future commande OBS ou minuteur reste exclusivement sur FIXE ; ce module n'en possède aucun.

Aucun push, déploiement, mise à jour utilisateur, accès à des secrets, installation npm, build Windows/APK ou changement hors propriété K. Aucune modification des autres lots, de RC2, WorldPrep, Director ou Crafty.

## Blocage du commit — preuve

La tentative de staging explicite des seuls six fichiers K a échoué avec le code 128 :

```text
fatal: Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-K/index.lock': Read-only file system
```

Les métadonnées de ce worktree pointent hors de sa racine vers un stockage Git en lecture seule dans cette session. Aucun contournement, modification de permissions, écriture hors worktree ou branche alternative tenté. **Aucun commit créé.** Les six nouveaux fichiers restent non suivis et prêts à être ajoutés explicitement par l'intégrateur dans une session où l'index est accessible en écriture. Le ticket préexistant `docs/streamcockpit-3/LOT_K_TICKET.md` reste également non suivi, à exclure de cet ajout. La livraison demandée avec commit n'est donc pas entièrement accomplie, malgré les vérifications logicielles réussies.
