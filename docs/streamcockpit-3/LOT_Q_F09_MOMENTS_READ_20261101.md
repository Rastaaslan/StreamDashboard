# F09 — consultation HTTP du journal de moments, lot isolé Q

**Date :** 2026-11-01 ~14:24 CET. **Branche :** streamcockpit/3.0-f09-moments-read-20261101.
**Base :** 6e32562, branche canonique 3.0. **État :** implémenté en source isolée, non intégré, non qualifié.

## Changement concret

- Route GET/HEAD `/api/v1/streamcockpit-moments/:sessionId`, **lecture seule** sur un journal durable déjà existant.
- Filtre de session strict (A-Za-z0-9_- jusqu'à 128 caractères), contrôle autorité FIXE Windows obs-executor et permission observe sur l'appareil distant; lecture distante interdite sur hôte inconnu, PC jeu ou Android.
- Authentification à l'entrée **et après** lecture asynchrone pour prévenir fuite en cas de révocation pendant l'I/O ; pas de cache, aucune donnée brute d'exception dans l'API, aucune mutation de source / de live / de clip / de fichier.
- Un journal inexistant est **indisponible (503)**, jamais présenté comme une session vérifiée mais vide ; journal corrompu = 503, sans remplacement/suppression.
- `MomentsPipeline.exportObserved()` fait une lecture unique et ne renvoie pas un faux résultat en l'absence de fichier.
- Pas de création de producteur ou d'interface : l'API ne sert que les marqueurs **déjà réellement enregistrés**. La liaison des sources OBS/Twitch/Streamlabs, la création authentifiée de marqueurs et leur affichage dans Plus sont d'autres étapes de F04/F09.

## Preuves et blocage

- `git diff --check` : PASS à 14:21 et 14:23.
- Suite ciblée Vitest lancée à `nice 19 / ionice idle` : tests/streamcockpit3-moments-http.test.ts, streamcockpit3-moments.test.ts, streamcockpit3-moments-mobile.test.ts ; **TIMEOUT 120 s**, code 124, log de sortie **vide** avant initialisation, processus en état D (attente disque) sous `/proc/pressure/io` full avg10 60–66 %. Cela **n'est pas un PASS ni un FAIL fonctionnel**, et ne qualifie pas les nouveaux tests.
- Tests supplémentaires présents mais non exécutés : `tests/streamcockpit3-moments-observed.test.ts`.
- TypeScript, sécurité, test HTTP réel, suite complète et matériel **non exécutés** sous cette forte contention.
- Aucune utilisation de l'API en production, aucune commande OBS/Twitch ni action sur RC2/WorldPrep/Director/Crafty.

## Avant toute intégration canonique

1. Relancer tests F09 (quatre fichiers), TypeScript et contrôle sécurité quand la pression I/O permet l'exécution.
2. Revoir le code, les assertions du routeur HTTP, les permissions, la distinction absent/corrompu, revocation après lecture et les éventuels chemins non autorisés.
3. Intégrer par un seul commit/cherry-pick après validation. Si la suite globale ne passe pas, laisser ce lot isolé.
4. Dans F09, conserver **partial** jusqu'à une vraie alimentation de la timeline, un affichage UX et les tests sur matériel.

## Revue complémentaire après la première tentative bloquée
- Le harnais HTTP du lot Q comportait une regexp Device mal échappée qui aurait refusé tout credential de test légitime ; correction ciblée dans la fixture, sans modifier l'authentification de production.
- Le pipeline ne doit pas présenter comme « 0 moments connus » une session absente d'un journal appartenant à une autre session. exportObserved() valide désormais l'identifiant puis renvoie undefined si aucun marqueur de cette session n'existe ; HTTP reste 503, pas de fausse session. Assertions HTTP/mémoire modifiées.
- Ces modifications sont réalisées en worktree Q uniquement ; leur qualification reste conditionnée aux tests ciblés, TypeScript, sécurité et revue d'intégration. Aucun déploiement ni commande de diffusion.

## 2026-11-01 15:19–15:24 CET — correctifs Q et contrôles légers réussis
- Correctif de la fixture HTTP : expression du schéma `Device` passée de `\\S` (erroné dans une regexp littérale) à `\S`. Aucun changement à l'authentification de production.
- `MomentsPipeline.exportObserved()` valide immédiatement l'identifiant, retourne désormais `undefined` si le journal durable ne démontre aucun moment pour cette session. Le routeur transforme ce cas en `503 MOMENTS_NOT_OBSERVED`, jamais en une liste vide trompeuse. Les assertions de deux tests F09 sont adaptées.
- Tests manuels LOCAUX `node --import tsx` à priorité nice19/ionice idle, tous avec code de sortie 0 : HTTP loopback simple **9 vérifications PASS** (dont absence, session enregistrée, HEAD, refus POST et permission), HTTP loopback avec `RemoteAuth` réelle **7 vérifications PASS** (pairing, scopes, révocation et autorité), révocation pendant lecture asynchrone **2 vérifications PASS** (403, marqueur privé absent de la réponse). Aucune connexion OBS/Twitch réelle, aucun accès Internet.
- `node --check` sur 3 sources/tests touchés **3/3 PASS** ; `git diff --check` PASS. Ces contrôles ne remplacent PAS Vitest des quatre fichiers, TypeScript complet ou sécurité globale : **non exécutés** pendant cette contention.
- Pression I/O full avg10 observée de ~41 à ~66 % ; disque `190G/221G`, ~20G libres. Pas de Vitest/packaging ni installation sous cette charge. Le lot Q reste isolé, non intégré à la 3.0. RC2 et projets tiers intacts.
