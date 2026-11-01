# Lot D — première passe F04/F09

Base : `79c7de3`. Branche propriétaire : `streamcockpit/3.0-lot-d`.
Ce résultat est un module isolé à intégrer, pas une livraison finale ni une qualification F04/F09 ou G1–G5. Plan et matrice lus ; matrice inchangée. Aucun service OBS/Twitch réel, profil utilisateur, secret, WorldPrep, Director ou Crafty utilisé. Aucun build Windows/Android.

## Nouveaux fichiers réellement écrits dans cette passe

- `packages/core/src/streamcockpit-moments.ts` : schéma, validation, ordre et contrat JSON d'export.
- `apps/server/src/streamcockpit-moments.ts` : pipeline injecté, journal contrôlé, idempotence et déduplication.
- `apps/server/src/streamcockpit-moments-file.ts` : adaptateur fichier atomique local.
- `apps/mobile/control/streamcockpit-moments.js` : composant timeline en lecture seule.
- `tests/streamcockpit3-moments.test.ts` : contrats, concurrence CAS, stockage, corruption et interruptions.
- `tests/streamcockpit3-moments-mobile.test.ts` : contrat DOM minimal, erreurs et réponses désordonnées.
- `docs/streamcockpit-3/LOT_D_FIRST_PASS.md` : ce rapport.

`LOT_D_TICKET.md` était déjà présent et non suivi au démarrage : il n'est ni modifié ni inclus au commit. Aucun fichier partagé ou interdit modifié. Ces nouveaux fichiers restent propriété du lot D ; les branchements doivent être effectués par l'intégrateur dans ses propres fichiers après revue.

## Contrats et branchements

`MomentInput` exige `sessionId`, `instant` (millisecondes Unix UTC entières), `source` (`obs`, `twitch`, `manual`, `streamlabs`), `correlationId`, `title`, `status` (`observed`, `confirmed`, `failed`, `uncertain`). `sourceEventId` facultatif désigne un événement stable du producteur. `clip` facultatif contient seulement `provider: obs|twitch` et une `reference` opaque, sans URL ni chemin. Il n'est pas une preuve d'existence ou de téléchargement d'un clip.

L'intégrateur doit créer une instance `MomentsPipeline(storage)` dans le propriétaire serveur/Agent, choisir explicitement un fichier dans son répertoire de données et injecter un `MomentsStorage`. L'adaptateur fourni n'a aucun chemin par défaut et ne crée pas de répertoire. Les routes, imports des points d'entrée, transports et scripts mobiles ne sont pas branchés ici.

Avant `record(input)`, l'adaptateur d'entrée doit authentifier le producteur, autoriser la session et la capacité d'écriture, établir la provenance/source et traduire une observation en champs autorisés. Le pipeline ne constitue pas une frontière d'authentification. Il ne demande aucun scope OAuth et n'émet aucune commande, création de clip ou marqueur distant. Les confirmations externes restent responsabilité de la régie unique.

- Idempotence : `(sessionId, correlationId)` ; même entrée normalisée => `replayed`, contenu différent => conflit, aucune écriture.
- Déduplication : `(sessionId, source, sourceEventId)` ; contenu identique hors correlationId => `deduplicated`, alias de corrélation persisté ; contenu différent => conflit. Sans identifiant source, pas de déduplication heuristique sur titre/instant. Ne pas réutiliser une corrélation pour deux sources.
- Observations immuables : aucun changement de statut en place. Une observation ultérieure reçoit une nouvelle corrélation et un nouvel identifiant d'événement source. La consolidation d'un cycle de vie reste à définir avec l'intégrateur.
- `sequence` : ordre de première insertion, global au journal ; pas d'horloge secondaire. La timeline/export trie par `instant`, puis `sequence`, même pour les événements tardifs.
- `pipeline.export(sessionId)` : `MarkerExport` v1 `{ schemaVersion: 1, kind: 'streamcockpit-markers', sessionId, timebase: 'unix-ms', markers: Moment[] }`. Inclut les statuts incertains/échoués sans les transformer en marqueurs confirmés. Export de données uniquement ; aucun MP4, vertical, montage ou export ClipForge.
- Mobile : `mountMomentsTimeline(root, { sessionId, read })`, où `read(sessionId)` retourne une promesse de `MarkerExport`. L'intégrateur fournit une lecture autorisée et filtrée par session, appelle `refresh()` sur son cycle de rafraîchissement et `destroy()` au démontage. Aucun polling ni commande dans ce composant. Texte via `textContent`, état vide/indisponible, réponses anciennes ignorées, aucune URL de clip rendue.

## Durabilité et récupération

`MomentsStorage.read()` renvoie une révision opaque ou `null` uniquement en cas d'absence ; toute autre erreur doit lever. `compareAndSwap(expected, replacement)` doit être exclusive entre tous les producteurs, atomique et durable avant `true`, renvoyer `false` en cas de révision différente. Le pipeline retente au maximum 16 conflits CAS. Une erreur d'écriture peut signifier « déjà persisté » : rejouer la même entrée, jamais une action OBS/Twitch. Un rejeu effectue aussi une barrière CAS durable avant acquittement.

L'enveloppe contient le payload versionné et SHA-256 (détection de corruption accidentelle, pas authentification). Schéma, champs, corrélations uniques et cohérence des événements sont revalidés à chaque lecture. Toute corruption bloque lecture et écriture, sans écraser les preuves.

Adaptateur local : verrou exclusif `wx`, comparaison de révision sous verrou, fichier temporaire unique mode 0600, écriture + fsync, rename dans le même répertoire, fsync du répertoire avant acquittement. Un autre écrivain actif provoque `MOMENTS_WRITER_LOCKED` : l'appelant doit gérer ce retour et conserver sa corrélation. Aucun fallback non atomique.

Après mort du processus, le verrou peut rester, ainsi qu'un temporaire. Le propriétaire doit établir que l'ancien écrivain est définitivement arrêté, préserver les fichiers pour diagnostic, vérifier le journal via `export`, puis supprimer explicitement le verrou résiduel dans son propre répertoire et rejouer la même entrée. Ne jamais promouvoir automatiquement un temporaire. Le module ne supprime pas un verrou étranger. Après un rename sans acquittement, le rejeu déduplique et rétablit la barrière de durabilité. Cette récupération manuelle n'est pas un outil d'administration livré dans cette passe.

## Vérification exécutée

1. Tentative initiale : `./node_modules/.bin/vitest run tests/streamcockpit3-moments.test.ts tests/streamcockpit3-moments-mobile.test.ts --maxWorkers=1` — arrêt au chargement de configuration, `EROFS` dans `node_modules/.vite-temp` ; aucun test exécuté. Dépendances partagées non modifiées.
2. Commande finale : `./node_modules/.bin/vitest run tests/streamcockpit3-moments.test.ts tests/streamcockpit3-moments-mobile.test.ts --maxWorkers=1 --configLoader native` — **2 fichiers, 35 tests passés**, code 0.
3. Typage ciblé : `./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --noUnusedLocals --noUnusedParameters packages/core/src/streamcockpit-moments.ts apps/server/src/streamcockpit-moments.ts apps/server/src/streamcockpit-moments-file.ts tests/streamcockpit3-moments.test.ts tests/streamcockpit3-moments-mobile.test.ts` — code 0.
4. `node --check apps/mobile/control/streamcockpit-moments.js` — code 0.
5. `git diff --check --cached` — code 0 avant commit.

Les tests couvrent les quatre sources/statuts, rejet des payloads inconnus et formes usuelles de secrets sans persistance ni reprise du secret dans l'erreur, replay après réouverture, alias persistés, conflits, isolement des sessions, ordre tardif/stable, concurrence CAS, JSON tronqué/invalide et schéma incohérent malgré empreinte valide, erreurs IO, verrou étranger, échecs injectés avant/après rename et deux arrêts **réels de processus** au code 73, avec reprise après récupération explicite du verrou. Fixtures exclusivement temporaires. Tests mobiles sur DOM minimal : ils ne constituent pas une preuve navigateur ou Android.

## Limites et suite d'intégration

Pas de qualification matériel, réseau, panne électrique ou filesystem Windows. Le fsync de répertoire est obligatoire : un système incompatible doit échouer ; aucun résultat Windows n'est revendiqué. Les essais de crash sont des arrêts de processus Linux, pas une simulation de coupure d'alimentation. Répertoire privé de confiance requis ; pas de durcissement contre un acteur local remplaçant fichiers/verrous/liens symboliques. Pas de support de stockage réseau revendiqué.

Journal snapshot intégral et recherche en mémoire, coût croissant (validation pouvant être quadratique), sans rétention, pagination, migration, quota ou archivage automatique ; à dimensionner avant production. Ne pas effacer les corrélations pendant la fenêtre de rejeu. SHA-256 ne protège pas contre une modification malveillante recalculant l'empreinte.

La liste de champs rejette les payloads bruts, champs secrets et URLs ; le filtre textuel rejette les formes courantes de credentials. Aucun validateur ne peut reconnaître un secret arbitraire déguisé en titre ou identifiant valide : les producteurs doivent fournir seulement des libellés publics et des références opaques sans credentials. Aucun secret réel utilisé pour les essais.

Restent : branchement auth/session/provenance aux observations réelles, gestion des statuts au niveau produit, transport mobile, validation sur FIXE/laptop/Android, récupération opérateur, volume réel et export consommé par un outil cible. F04/F09 restent partiels/non qualifiés ; ClipForge vertical/MP4 et F10 ne sont pas implémentés par cette passe. Matrice et continuité partagées à renseigner uniquement par l'intégrateur après revue.
