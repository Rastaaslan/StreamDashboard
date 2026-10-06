# CB-139 — Tags Live sur mobile

Base exacte : `a480a7d2bc94be4c0fa5d3342f2a8d753e24745b` (CB-133).

## Cause racine

Le formulaire Live mobile ne proposait que le titre et la catégorie. Son rendu
n'utilisait pas `twitch.tags`, et sa sauvegarde n'envoyait pas `tags`. Il n'appelait
pas non plus le service de suggestions déjà utilisé par Desktop. Le serveur
acceptait pourtant déjà une modification de tags sans titre ni catégorie.
La sauvegarde remettait également le brouillon à zéro sans vérifier si une
nouvelle saisie avait eu lieu pendant la requête.

## Correction

- Champ de tags courants dans Live → Informations Twitch, avec aide et statut.
- Réutilisation de `/api/v1/twitch/channel` et `/api/v1/twitch/tags/suggest`, via
  le transport mobile authentifié. Aucune règle de génération/normalisation
  dupliquée et aucun changement au moteur Tag Intelligence v2.
- Adoption explicite des `tags.values` résolus ; les `observedSuggestions` ne
  sont jamais copiées dans la saisie ni envoyées automatiquement.
- Brouillon et suggestions conservés pendant les refresh ; réponses de
  suggestions obsolètes ignorées. Une sauvegarde ne valide que sa révision.
- Refus des tags et erreurs réseau visibles, brouillon conservé pour réessayer.
- Cache mobile versionné pour charger les nouveaux assets.

## Validation locale

- `npm run build` : réussi.
- `TMPDIR="$PWD/.tmp" npx vitest run tests/live-metadata-tags.test.ts tests/tag-intelligence.test.ts tests/tags-integration.test.ts tests/twitch-tags.test.ts tests/mobile-live-domains.test.ts` : 72 tests réussis.
- `TMPDIR="$PWD/.tmp" PLAYWRIGHT_BROWSERS_PATH="$PWD/.dependencies/browsers" npm run test:browser` : 20 tests réussis, dont édition tactile à 320/390 px, catégorie vide, refresh, adoption explicite, erreur réseau, refus des tags, retry, saisie pendant sauvegarde et suggestions concurrentes.
- `TMPDIR="$PWD/.tmp" PLAYWRIGHT_BROWSERS_PATH="$PWD/.dependencies/browsers" node --test tests/desktop-live-drafts.node.test.mjs` : 10 tests réussis.
- `npm run check:shipped-js` : 32 fichiers valides.
- `git diff --check` : réussi.

Les premières tentatives sans configuration locale ont échoué avant exécution
utile (répertoire temporaire inaccessible, puis navigateur absent). Chromium a
été installé dans `.dependencies/browsers`, et les relances ci-dessus sont vertes.
Le dossier temporaire a ensuite été déplacé vers `.dependencies/test-tmp` ;
pour reproduire, utiliser ce chemin comme `TMPDIR`.

Tests navigateur avec API simulée et tests locaux du contrat serveur ; aucune
publication réelle sur Twitch. Aucun packaging, push ou lancement de CI.

## Correction après revue 1 — autorisation LAN

Cause complémentaire : l'endpoint de suggestions était absent de la liste
`POST_EXACT` de `remote-api-policy.ts`. Un appareil appairé recevait donc
`403 REMOTE_SCOPE_DENIED`, malgré un formulaire fonctionnel avec API simulée.
Seul `POST /v1/twitch/tags/suggest` est désormais autorisé ; le middleware
continue d'exiger un credential Device valide.

Le nouveau test `remote-lan.test.ts` traverse l'autorisation distante via
l'adresse réseau non-loopback du serveur et un véritable appairage local.
Il a reproduit le 403 avant correction, puis vérifie : suggestions sans catégorie
avec réponse identique au contrat Desktop, rejet 401 sans credential, avec
credential invalide ou révoqué, et maintien du 403 pour une autre méthode et
un endpoint voisin interdit. Le contrat statique transport/politique est aussi
inclus dans la validation.

Validation de cette révision :

- `TMPDIR="$PWD/.dependencies/test-tmp" npx vitest run tests/remote-lan.test.ts tests/mobile-remote-api-policy.test.ts tests/live-metadata-tags.test.ts tests/tag-intelligence.test.ts tests/tags-integration.test.ts tests/twitch-tags.test.ts tests/mobile-live-domains.test.ts` : 142 tests réussis (7 fichiers).
- `TMPDIR="$PWD/.dependencies/test-tmp" PLAYWRIGHT_BROWSERS_PATH="$PWD/.dependencies/browsers" npm run test:browser` : 20 tests réussis.
- `npm run build` : réussi.
- `git diff --check` : réussi.

Tag Intelligence v2 et ses règles de qualité/autoApply restent inchangées.
Aucun packaging, push, déploiement ou lancement de CI.
