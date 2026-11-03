# F08 — Verrouillage volontaire d'une prédiction Twitch (FIXE, 2026-11-03)

## Contrat implémenté dans les sources de développement
- Propriétaire unique : régie FIXE Windows 11, jamais le laptop ou Android. Twitch only, aucune commande OBS de live/stop, aucun compte Twitch manipulé pendant les tests.
- Parcours Live Monitor Desktop/Android dans les sources : « Vérifier la prédiction à verrouiller », lecture du **seul ID durable déjà stocké** sur FIXE et contrôle OAuth `channel:manage:predictions`, statut provider `ACTIVE`, même broadcaster, même époque OBS et appairage de gestion `chat+cloud`. Preview **ne modifie jamais Twitch**.
- Second clic après case de consentement obligatoire, UUID à usage unique (max 30 s selon fraîcheur OAuth), relecture Twitch avant écriture, recontrôle propriétaire/appairage/époque OBS après toute attente asynchrone. Aucune tentative basée sur un titre ou une « prédiction récente ».
- Journal SQLite `prediction_intents` v3, migrations transactionnelles v1/v2->v3 avec réservations conservées, nouveau `lock_attempted` initialement 0, transition 0->1 en transaction DELETE/EXTRA sur FIXE **avant** la requête `PATCH /helix/predictions` (`{broadcaster_id,id,status:'LOCKED'}`). Une tentative échouée ou incertaine avant la réponse ne peut plus être recommencée par un nouvel appairage, une réouverture du journal ou un redémarrage du service.
- Un succès ne prétend que le reçu Twitch `LOCKED` pour l'ID exact ; perte de réponse, changement de token/OBS après PATCH, erreur 4xx/5xx, échec SQLite ou résultat malformé = blocage conservateur, `retryable:false` ; aucune nouvelle mutation, relance automatique, outbox ou génération de seconde régie.
- Routes `POST /api/v1/twitch/advanced/prediction/lock/{preview,confirm}` autorisées uniquement à une identité appairée de gestion ; aucune invocation sur localhost non autorisé. Le nouveau panneau mobile gère absence de source, mise en veille, changement de compte, déconnexion, réponse tardive et accusé perdu sans autoriser une deuxième tentative.

## Limites de qualification non franchies
- Tests sur serveur Express HTTP local, SQLite temporaire du FIXE et Edge 320 px tactile avec **Twitch/OBS/OAuth simulés**. Aucune prédiction publique verrouillée, aucune émission PATCH sur le vrai réseau Twitch, aucune installation sur téléphone/laptop.
- `node:sqlite` reste expérimental. `PRAGMA synchronous=EXTRA` sur NTFS est testé comme barrière logicielle, **pas une preuve physique de perte électrique**. Les migrations v1/v2->v3 sont testées sur fichiers temporaires, **pas sur une installation existante**. Le signe d'incertitude peut immobiliser une prédiction même si le PATCH n'a jamais quitté FIXE ; c'est volontaire et exigera une procédure de récupération qualifiée.
- Le verrouillage a été ajouté au parcours de développement, mais la résolution/annulation Twitch reste à concevoir et à tester, ainsi que la vraie validation OAuth, le trio FIXE/laptop/Android, les signatures de production, le retour arrière et la candidate Windows x64+APK issue du même commit.
- **F08 partiel, G2 en cours, G3–G5 ouverts. Aucune RC/installation.**

## Validation finale en développement sur FIXE
- SQLite v3 et réconciliations existantes 14/14 + 11/11 PASS ; tests spécifiques du LOCK 11/11 HTTP PASS, comprenant une route réellement montée sur le serveur FIXE local et refus de loopback non appairé.
- Quatre scénarios Microsoft Edge tactile 320 px **4/4 PASS** : consentement explicite, refus hors live, résultat PATCH perdu, changement de régie pendant envoi.
- Dernière validation ciblée avec roadmap : **32/32 PASS / 0 skipped / 0 FAIL** sur quatre suites, après l'ajout du scénario d'API montée.
- Suite Vitest générale séquentielle (avant la dernière variante de test de montage, ensuite ciblée) : **2177 PASS / 97 skipped / 0 FAIL**, 270 fichiers, exit 0 ; log `%TEMP%\sc3-f08-lock-full-vitest-20261103.log`.
- `build:types`, `check:browser-types`, `security:check` **880 fichiers** et `git diff --check` PASS. Build de développement **135 fichiers publics**, syntaxe JavaScript livré **142 PASS** ; Node construit **349 PASS / 6 skipped / 0 FAIL** sur 355 ; Playwright réseau **35/35 PASS**. Logs `%TEMP%\sc3-f08-lock-build-node-20261103.log`, `%TEMP%\sc3-f08-lock-playwright-20261103.log`.
- **Aucune mutation Twitch réelle**, pas d'OBS live ni d'appareil physique, pas de preuve électrique, de vraie migration utilisateur ou de signature/rollback. Les skips restent non qualifiés. G0/G1 histor. qualifiés, G2 en cours, G3–G5 ouverts.
