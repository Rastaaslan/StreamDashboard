# Lot A — première passe santé F00/F01

Base : `79c7de3`. Branche : `streamcockpit/3.0-lot-a`.
État : modules isolés testés, **aucune qualification F00/F01 ni livraison finale**.
Propriété exclusive Lot A : tous les fichiers ci-dessous ; les autres lots doivent consommer les contrats, sans modifier ces fichiers. Branchement réservé à l'intégrateur.

## Fichiers réellement créés

- `packages/core/src/streamcockpit-health/index.ts` : contrat v1, diagnostic pur, politique explicite et transitions d'alertes pures.
- `apps/server/src/streamcockpit-health/index.ts` : fabrique de routeur Express read-only.
- `apps/mobile/control/streamcockpit-health/index.js` : composant DOM mobile réutilisable, sans transport propre.
- `tests/streamcockpit3-health.test.ts` : moteur, épisodes d'alertes, contrat DOM.
- `tests/streamcockpit3-health-api.test.ts` : routeur en mémoire, permissions et refus des mutations.
- `docs/streamcockpit-3/LOT_A_HEALTH.md` : ce rapport et contrat de branchement.

Le fichier préexistant non suivi `LOT_A_TICKET.md` n'est ni modifié ni inclus dans le commit. Aucun fichier existant, matrice, manifeste, point d'entrée partagé ou installation utilisateur modifié. Aucun appel OBS/Twitch réel, build Windows/Android ou accès aux secrets.

## Contrat et décisions

`diagnoseHealth(snapshot, now)` prend un snapshot non fiable et un temps hôte explicite en millisecondes Unix ; aucune lecture système, aucun effet de bord. L'entrée typée `HealthSnapshot` contient `hostId` et `observations` indexées par `host`, `obs`, `twitch`, `micro`, `dji`, `sync`. Chaque observation contient une provenance descriptive non secrète, `observedAt`, `receivedAt` et `data`.

Les horodatages doivent être dans le référentiel de l'hôte. Le producteur doit normaliser une horloge distante seulement si sa correspondance est connue ; sinon omettre l'observation. Ne jamais remplacer la date d'observation par celle d'une lecture du cache. Le moteur ne corrige pas implicitement les horloges. Âge maximal : 15 secondes, tolérance au futur : 2 secondes. Les dates incohérentes donnent `unknown` / `clock-skew`, les anciennes `unknown` / `stale`, les données absentes ou invalides restent inconnues. La fraîcheur et les dates originales restent visibles même quand l'hôte indisponible rend les diagnostics descendants inconnus.

Mesures exploitées :

| Source | Preuve requise | Résultat |
|---|---|---|
| host / OBS | `connected` booléen | vrai : healthy ; faux : critical |
| Twitch | `connected` booléen | vrai : healthy ; faux : degraded |
| micro | `available`, puis `muted` | indisponible : critical ; muet : degraded ; disponible et non muet : healthy |
| DJI | `batteryPercent` réel dans [0,100] | ≤10 critical ; ≤20 degraded ; sinon healthy |
| sync | `offsetMs` fini mesuré | valeur absolue ≥2000 critical ; ≥250 degraded ; sinon healthy |

`connected:false` DJI donne degraded sans pourcentage. Le silence, `levelDb` et l'absence de volume ne prouvent jamais une panne micro. Une simple connexion DJI sans batterie reste unknown. Aucun pourcentage de santé global ; le statut agrégé prend la priorité critical, degraded, unknown, healthy. Ce statut décrit seulement les mesures présentes : une connexion OBS saine ne qualifie pas l'encodage ni le live Twitch.

L'absence d'hôte sain invalide les états descendants et masque leur batterie : pas de faux état sain issu d'un cache hors ligne. Une reconnexion hôte ne rafraîchit pas implicitement les autres mesures.

`reconcileHealthAlerts(report, previousState)` retourne `state`, `opened`, `resolved`. Une alerte par source, identité stable par hôte/source/code/sévérité. Le consommateur notifie seulement `opened`, conserve l'état par hôte et ordonne les rapports. Un inconnu conserve l'épisode sans notifier ni annoncer de guérison. Une mesure healthy clôt l'épisode ; sa réapparition alerte à nouveau. Un changement de code/sévérité remplace l'ancienne alerte (ancienne dans `resolved`, nouvelle dans `opened`), ce remplacement n'est pas une guérison. `state.pending` contient des épisodes non résolus, pas nécessairement des pannes actuellement confirmées : consulter aussi les diagnostics. Déduplication non persistée au redémarrage sans stockage par l'intégrateur.

## Points de branchement intégrateur

1. Construire le contrat depuis les caches existants de l'hôte propriétaire. Le cache OBS actuel peut fournir une observation connectée fraîche ; son retour null doit rester unknown, jamais être transformé en panne mesurée. Le mapping des autres sources et des déconnexions explicites reste à réaliser. Aucune nouvelle instance OBS, régie ou minuterie.
2. Monter `createHealthRouter({canRead, readSnapshot, now})` à `/api/v1/streamcockpit-health` derrière l'authentification existante. `canRead` doit contrôler identité et capacité de lecture ; refus ou exception donne 403 avant toute lecture du cache. GET/HEAD seulement ; mutations 405 ; cache désactivé ; panne du lecteur 503 avec message générique. L'adaptateur ne publie que les champs du rapport, jamais le snapshot brut. Provenance et hostId doivent rester des identifiants sans secret. HEAD est vidé par Express en transport réel.
3. Importer `mountStreamCockpitHealth(root)` depuis le bundle mobile et transmettre les nouveaux rapports avec `update(report)`. Alimenter via le transport authentifié existant ; sur déconnexion ou réponse non exploitable appeler `unavailable()`, à la destruction appeler `destroy()`. L'intégrateur doit rejeter les réponses désordonnées, ne pas rejouer un ancien rapport et tenir compte de la latence réseau. Rafraîchir périodiquement le diagnostic côté hôte (par exemple toutes les 5 secondes). Le composant expire localement selon l'âge du rapport reçu, sans comparer les horloges PC/Android. L'acheminement long n'est pas mesuré par le composant.
4. Réconcilier les alertes une fois par nouveau rapport dans le propriétaire hôte, pas indépendamment dans chaque client. Persister l'état si la déduplication doit survivre aux redémarrages. Aucun envoi de notification dans cette passe.

Le composant utilise des éléments sémantiques, du texte échappé via textContent, les classes existantes `panel` et `data-status`. Il affiche source, statut, code, provenance, date et fraîcheur. Les codes techniques restent à traduire et la présentation à valider sur les vrais écrans ; aucune inclusion dans les pages ou assets partagés à cette étape.

## Vérifications exécutées

Commande initiale :

```sh
./node_modules/.bin/vitest run tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts --maxWorkers=1
```

Échec avant tests : EROFS sur `node_modules/.vite-temp` (dépendances partagées en lecture seule). Aucun changement de dépendance effectué. Avec le chargeur natif, la première version du test API sur loopback a rencontré EPERM sur listen, puis le délai de test ; elle a été remplacée par l'exercice du routeur Express en mémoire, sans socket.

Commande finale :

```sh
./node_modules/.bin/vitest run tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts --maxWorkers=1 --configLoader=native --no-cache
```

Résultat : **2 fichiers, 14 tests réussis**, code 0. Couverture : absence de source/provenance, hors-ligne, horloge future/recul, cache périmé, reconnexion partielle, silence micro, batterie absente/invalide/zéro, seuils sync, déduplication pendant absence, rétablissement/réapparition, séparation hôtes, refus API, messages d'erreur sans détails, rendu texte DOM et expiration/nettoyage des timers.

```sh
./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --noUnusedLocals --noUnusedParameters packages/core/src/streamcockpit-health/index.ts apps/server/src/streamcockpit-health/index.ts tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts
node --check apps/mobile/control/streamcockpit-health/index.js
```

Résultats : codes 0. Contrôle TypeScript limité aux fichiers du lot ; aucune compilation globale ou plateforme.

## Limites et suite

Tests sur fixtures hors ligne et DOM minimal, sans navigateur réel ni réseau réel. Le service autonome F00, sa reprise après crash, les performances détaillées, les producteurs micro/DJI/sync et les capacités réelles ne sont pas livrés par ce module. Seuils proposés explicitement, à valider sur matériel. Intégration API/auth/bundle, tests HTTP, sécurité intégrée et parcours FIXE/laptop/Android restent à réaliser par l'intégrateur. G1 global non déclaré acquis ; G2–G5 non franchis. Matrice partagée inchangée. Ce commit constitue uniquement la première passe isolée du lot A.
