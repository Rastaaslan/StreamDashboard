# CB-16 — Planning Desktop / Android

## Corrections

- Les résultats des mutations provider Android font partie du journal durable, y compris les suppressions. Une réponse PC en vol ne peut pas acquitter une mutation provider ajoutée ensuite.
- Le protocole convertit explicitement `providerLinks.revision` en `providers.remoteRevision`, et conserve remoteId, calendarId, fingerprint et dates de synchronisation. Un état d'affichage masqué ne remplace plus les identités du cache.
- Les créations déjà publiées sur Android ne sont pas recréées au retour du PC. Les projections externes importées avant le journal sont retirées lorsque l'identité canonique Android et les liens provider permettent de les reconnaître.
- Les éditions hors ligne génèrent une file provider persistante. Les ACK du journal arrivent après écriture atomique ; un échec d'écriture restaure l'état mémoire précédent.
- La file conserve séparément les échecs Twitch et Google, les suppressions et leurs identités. Les retries ciblent un seul provider. Un DELETE déjà accompli (404, et 410 Google) est un succès idempotent.
- Une création interrompue sans identifiant distant reste explicitement incertaine. Elle n'est pas répétée automatiquement : il faut d'abord réconcilier le provider pour récupérer son identité.
- Les conflits bloquent les opérations dépendantes. Le choix Android applique aussi les suppressions et les collections ; le choix PC restaure un événement masqué par une tombstone Android rejetée. La résolution est rejouable.
- Les empreintes Twitch SHA-256 provenant du bridge Android sont contrôlées avant une mise à jour Desktop. Une modification concurrente produit un conflit explicite.
- Les métadonnées privées Google créées par Android sont reconnues par le Desktop.
- Les séries locales restent refusées avant publication provider : aucune publication silencieuse de la seule occurrence initiale. Une suppression distante détectée exige une action explicite.

## Validation

Les tests utilisent le véritable store JavaScript Android, le réconciliateur Desktop, les adaptateurs de test, des contrats HTTP provider simulés et un serveur HTTP local avec persistance réelle. Ils couvrent créations, éditions et suppressions dans les deux sens, édition hors ligne, liens acquis en standalone, réponse perdue, journal rejoué, échec disque, redémarrage serveur, conflits/résolutions, retries ciblés et garde-fous récurrents.

Commandes (TMPDIR est placé dans le worktree pour respecter le sandbox) :

```sh
TMPDIR=$PWD/node_modules/.cache/cb16-tmp npm run build
TMPDIR=$PWD/node_modules/.cache/cb16-tmp npm test
node --test tests/node/cb7-integration.test.mjs tests/mobile-offline.node.test.mjs tests/cb3-sync-center.test.mjs
git diff --check
```

Pas de publication réelle Twitch/Google ni de validation sur appareil Android physique. Les contrats réseau et les pannes sont simulés ; le redémarrage Desktop est testé sur le serveur local réel.


## Revue 1 — publications en vol et conflits de suppression

- Chaque résultat de publication porte désormais une identité déterministe du contenu envoyé, distincte des révisions du journal et des métadonnées provider. Une ancienne réponse conserve son remoteId mais ne peut acquitter la publication d'une édition plus récente.
- La flight Android relit le store après chaque réponse et publie la dernière édition avec l'identifiant obtenu par la création initiale. Le test retarde séparément create et update et vérifie le contenu distant, l'absence de seconde création et la file Desktop intermédiaire.
- Les suppressions tombstonées disposent d'une résolution sur l'endpoint planning existant, accessible aux appareils appairés. Le choix local relit le provider, persiste le nouvel ETag puis permet un retry ciblé ; le choix distant annule la suppression et restaure l'événement dans le Desktop et le cache Android.
- Les conflits restent visibles après un retry refusé. Les contrôles Android proposent explicitement de confirmer la suppression ou de conserver la version distante.
- Le test HTTP Google 412 utilise le serveur réel, son journal sur disque, un redémarrage, l'authentification appairée, la résolution réelle et un DELETE conditionnel avec l'ETag rafraîchi. Les deux stratégies sont couvertes. Seules les réponses Google sont simulées.

## Revue 2 — conflits Google actifs et dépublication standalone

- La résolution d'un conflit sur un événement encore présent relit le contenu distant et son ETag avant les deux choix. Le choix local utilise cet ETag dans le PATCH conditionnel ; le choix distant adopte le contenu relu. Une lecture en échec laisse le conflit ouvert.
- Le test HTTP 412 actif redémarre le serveur avant la résolution, vérifie un échec de lecture sans écrasement, puis les stratégies locale et distante par l'endpoint appairé réel. Un second redémarrage vérifie la persistance de la résolution.
- La réconciliation standalone traite désormais les providers liés même lorsque leur publication est désactivée. Un DELETE réussi efface remoteId, révision, empreinte et ancien snapshot, mais conserve le calendrier. Un DELETE échoué conserve les identifiants nécessaires au retry.
- La réactivation recrée une seule publication avec une nouvelle identité, y compris si elle survient pendant le DELETE. Le retour sur Desktop ne republie pas l'événement désactivé et ne duplique pas la nouvelle publication.
- Le lien legacy twitchSegmentId est également retiré du Desktop après une dépublication Android confirmée.
- Validation finale de cette revue : compilation réussie, 479 tests Vitest (70 fichiers), 17 tests Node CB-7/offline/centre de synchronisation, et git diff --check réussi. Les appels provider sont simulés ; les endpoints HTTP, la persistance et les redémarrages serveur sont réels.

## Revue 3 — créations Android incertaines et conflits transférés

- Avant tout CREATE natif, Android persiste le contenu original et un marqueur uncertainCreate. Une réponse perdue, un résultat sans ID ou un redémarrage ne permettent plus un second CREATE aveugle.
- Le bridge fournit une réconciliation en lecture seule : recherche Google paginée par identifiant privé streamDashboardEventId, recherche Twitch paginée sur le contenu original. Une correspondance unique rend l'identité réutilisable ; aucune correspondance, plusieurs correspondances ou une lecture incomplète maintiennent l'incertitude.
- Les éditions effectuées pendant l'incertitude sont publiées en UPDATE après récupération de l'identité. Un refus du diagnostic avant mutation reste distingué d'une réponse de mutation perdue.
- Le Desktop conserve ce marqueur et bloque la recréation. Une réponse de récupération du même CREATE peut compléter le journal malgré les changements de statut opérationnel effectués par le Desktop.
- Les conflits stockés par Android dans providerLinks peuvent être résolus directement : le Desktop matérialise le conflit depuis le statut provider puis relit le contenu et la révision distants avant d'appliquer le choix.
- Régressions : Google et Twitch avec réponse CREATE perdue, redémarrage Android, absence temporaire de correspondance, récupération et retour Desktop ; arrêt pendant l'appel natif ; édition pendant l'incertitude ; refus avant mutation ; quatre résolutions Android vers Desktop (Google/Twitch × local/distant) via les endpoints réels après redémarrage.
- Validation : compilation TypeScript réussie, 488 tests Vitest (72 fichiers), 18 tests Node incluant la compilation ProviderBridge par javac avec stubs de signatures Android/JSON, git diff --check réussi. La compilation avec stubs ne remplace pas une exécution Android physique ; les réponses provider restent simulées.

## Revue 4 — garde-fou Desktop commun et DELETE natif idempotent

- Les chemins de création Desktop partagent maintenant un garde-fou sur uncertainCreate : édition courante, retry, orchestrateur, file compagnon, création Google directe et création Twitch lors d'une synchronisation provider. Changer le titre ou cliquer sur Réessayer ne constitue pas une preuve d'échec du CREATE initial.
- Les créations de l'orchestrateur et de la file compagnon écrivent également leur propre intention incertaine avant l'I/O. Une seule invocation autorisée reçoit la copie destinée au provider ; une réponse perdue laisse le marqueur durable.
- Les tests font accepter un CREATE Android sans réponse, transfèrent le journal, redémarrent le serveur, puis passent par une édition HTTP Desktop, le retry HTTP et le retry direct du cœur. Le nombre de publications reste à un pour Google et Twitch.
- Le bridge natif accepte Twitch HTTP 404 et Google HTTP 404/410 comme achèvement d'un DELETE. L'adaptateur JavaScript traite aussi ces réponses provenant d'une ancienne version du bridge. Cette règle ne s'applique ni au diagnostic préalable, ni aux autres mutations.
- Les tests couvrent un DELETE accompli sans réponse, le redémarrage Android, la réponse « déjà absent », le nettoyage des identifiants et le transfert au Desktop sans mutation supplémentaire. Les refus 403, 500, conflits et Twitch 410 restent des erreurs.
- Le test javac exécute également la matrice de statuts de la règle Java ; il utilise toujours des stubs Android/JSON et ne constitue pas un test sur appareil physique.
- Validation finale revue 4 : compilation réussie, 499 tests Vitest (74 fichiers), 18 tests Node, dont compilation du bridge Java et exécution de sa matrice de statuts DELETE, et git diff --check réussi. Aucun test sur appareil physique ni appel réel de publication provider.

## Revue 5 — conflits de suppression transférés et refus de création certains

- Le snapshot convertit les métadonnées des tombstones comme celles des événements actifs : remoteRevision devient revision pour le bridge Android, et lastSyncedAt devient lastProviderSyncAt.
- Le standalone bloque aussi les suppressions liées en conflit. Le test Google 412 couvre le transfert, le redémarrage Android, l'absence d'appel natif avant résolution, la résolution via le véritable endpoint après redémarrage Desktop, puis la transmission du nouvel ETag au DELETE natif et le retour Desktop sans nouvel appel.
- Les validations et lectures préalables à une création signalent explicitement qu'aucune mutation n'a commencé. Les refus HTTP définitifs retirent durablement l'intention de création incertaine ; la file compagnon retire également son indicateur uncertain. Les timeouts, erreurs serveur et réponses perdues conservent la protection contre les doublons.
- Les tests utilisent le vrai client Twitch pour une durée invalide sans aucune requête réseau, puis une correction après redémarrage, ainsi qu'un refus HTTP 403 suivi d'un retry ciblé. La file persistée couvre aussi un refus 429 et un redémarrage. Une matrice distingue les refus certains des erreurs 408/500/503.
- Validation finale : build TypeScript et copie runtime réussis ; 510 tests Vitest dans 75 fichiers ; 18 tests Node ; git diff --check réussi. Les erreurs initiales de syntaxe/types des nouveaux tests ont été corrigées avant ces validations. Les providers sont simulés ; aucune publication réelle ni exécution sur appareil Android physique.

## Revue 6 — refus certains de CREATE Android

- Le bridge transmet une preuve nonCreation pour les validations locales et les refus HTTP définitifs. L'adaptateur reconnaît également les codes des anciens bridges. Une date ou un JSON invalide est classé comme validation ; la durée Twitch est validée au lieu d'être silencieusement portée à 30 minutes.
- Le standalone retire durablement uncertainCreate et conserve createNotStarted après un refus certain, ce qui autorise le retry ciblé après correction et permet le transfert au Desktop. Les réponses perdues, 408, 5xx et conflits d'identité restent incertains.
- Régressions avec le vrai store et l'adaptateur natif pour Google et Twitch : refus 403/429/validation, redémarrage, permissions ou entrée corrigées, retry sans réconciliation ni appel à l'autre provider, une publication, métadonnées préservées et transfert Desktop avant/après retry sans création supplémentaire. Les réponses du bridge sont simulées.
- Validation : build réussi ; 518 tests Vitest (75 fichiers) ; 18 tests Node. Le test javac exécute la classification des refus et une validation de date en plus des règles DELETE. Le scénario renforcé de transfert avant/après retry a été relancé avec succès (13 tests ciblés). Aucun test sur appareil Android physique ; aucune publication réelle.

## Revue 7 — calendrier Google cible absent

- Correction limitée au prérequis de création Google : l'absence de calendrier cible signale mutationNotStarted, ce qui retire durablement uncertainCreate et l'incertitude de la file Companion sans modifier le traitement des résultats ambigus.
- Régression HTTP Desktop et Companion : création sans cible, aucune requête événement provider, échec certain persistant après redémarrage, sélection du calendrier, retry Google ciblé et une seule création réussie. Le test Desktop utilise l'identifiant généré par l'API (corrigé après le premier lancement).
- Validation : 16 tests ciblés réussis, suite complète 520 tests dans 76 fichiers, build réussi, git diff --check réussi. Providers simulés.
