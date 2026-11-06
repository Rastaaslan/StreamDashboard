# F06 — Duplication assistée d'une occurrence de série vers un brouillon local

**6 novembre 2026 — FIXE uniquement — source initiale dd12ac4.** Préflight PLAN, matrice, CONTINUITY, MIGRATION, audit final, HEAD/remote/état Git, propriétaires concurrents, charge FIXE vérifiés avant écriture. Les travaux F05/mixeur, CONTINUITY, audit Settings et F10 concurrent ont été préservés ; OBS/Twitch, installation, profils et secrets non sollicités.

## Parcours fonctionnel

La duplication assistée excluait toute série récurrente, malgré le moteur canonique d'occurrences déjà présent. Le sélecteur partagé Desktop/Android propose désormais des **occurrences individuelles** (clé canonique, date/heure Europe/Paris, titre effectif et exceptions), ou des lives simples. Les exceptions annulées, séries à moteur personnalisé, changements de source et projections incertaines ne sont pas offertes. La sélection est comparée sur FIXE à deux lectures distinctes avant écriture ; l'empreinte couvre le master récurrent et les exceptions, non seulement le titre affiché. Le créneau est revérifié par le serveur sous file propriétaire au POST.

Une occurrence éligible devient un **brouillon local non enregistré**, sans identifiant original, récurrence, projection fournisseur ni droit de publication hérité. Seule une soumission volontaire crée un événement local ; Google et Twitch restent explicitement désactivés et leur disponibilité inconnue. ACK perdu = aucune répétition automatique.

## Régressions et limites

- RED nouvelle fonctionnalité avant code : **2 PASS / 3 FAIL** (5 tests).
- GREEN final sur quatre suites F06 : **56 PASS / 0 FAIL / 0 skipped**, dont 9 nouveaux scénarios et un vrai Microsoft Edge 320 px tactile avec choix d'occurrence et ouverture de l'éditeur sans requête fournisseur. Tests couvrant exception déplacée/annulée, source modifiée lors de chacun des deux refresh FIXE, vérification de sélection, écriture locale unique, ACK perdu, protections précédentes.
- `npm run build:types` **PASS** ; `npm run check:browser-types` **PASS** ; `npm run security:check` **PASS (6799 fichiers)** ; `git diff --check` **PASS**, uniquement avertissements de conversion CRLF non bloquants.
- Aucun matériel Android/laptop, aucune publication Google/Twitch, aucune réception G3, signature G4 ou garantie électrique de persistance. La copie locale observe les imports Google en cache sans prétendre vérifier la disponibilité distante.
- **F06 conserve status partial ; G2 in_progress, G3–G5 open.** Aucun build complet, package, déploiement ou commande OBS/Twitch.
