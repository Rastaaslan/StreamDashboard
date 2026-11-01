# Lot N — wave4 — capacités Twitch Android

2026-11-01. Base `b242696`, worktree isolé `/home/damien/StreamCockpit-3.0-Lot-N`.
PLAN, feature-matrix, CONTINUITY et documentation des lots A–L consultés.
F02/F08 restent partiels ; **G2 in_progress, G3–G5 open**. Aucune qualification matérielle.

## Chemins modifiés

- `apps/mobile/control/live-monitor.js` : import, montage dans la carte Chat, transmission du contexte source/connexion/compte hôte et destruction du panneau.
- `apps/mobile/control/streamcockpit-twitch-advanced.js` : composant DOM read-only et normalisation stricte des capacités.
- `apps/mobile/control/streamcockpit-twitch-advanced.d.ts` : contrat du transport et des états.
- `tests/streamcockpit3-twitch-mobile.test.ts` : 20 tests, DOM/navigation simulés et mocks de transport.
- `docs/streamcockpit-3/LOT_N_WAVE4.md` : ce rapport.

Ticket préexistant `LOT_N_TICKET.md` exclu. Aucun autre fichier métier modifié ; `control.js`, `index.ts`, permissions/auth/navigation, SW généré, package.json, matrice et CONTINUITY inchangés.

## Branchement effectué et impact UX

Le panneau « Permissions Twitch » est réellement monté par `createLiveMonitor` dans `.monitor-chat`, pour Live Monitor et le mode Chat seul (`chatOnly`). Il suit le masquage des écrans et le cycle `destroy` déjà utilisé lors de la navigation. Il affiche Shield Mode et AutoMod, un état textuel accessible et un bouton « Vérifier les permissions ». Classes visuelles existantes, sans nouvelle CSS ni refonte.

Le transport injecté est **le `request` existant fourni par `liveChatRequest`**, même en mode Android natif. Ce chemin valide la source courante, refuse la régie distante déconnectée, puis appelle `network` / `peers.request` avec les credentials existants. Aucun accès nouveau à un global d'authentification ni au pont natif du compte Twitch. Si le transport ou la source manque, aucun appel ; si le transport refuse, état inconnu. Une source native sans endpoint réseau utilisable n'obtient aucun contournement via le bridge. La cible demeure la source hôte existante, et non la chaîne saisie pour la visionneuse.

Seul appel ajouté : `request('/api/v1/twitch/advanced/capabilities', undefined, 'GET', sourceKey)`. Première lecture à l'activation/reconnexion/changement de source ou compte hôte ; relecture manuelle ensuite. Pas de polling, de retry automatique d'erreur, de POST ou de modification de scopes. La permission serveur `chat`, l'authentification et la revalidation après réponse Twitch restent celles de wave3.

La route serveur existante fournit `Cache-Control: no-store`. Le contrat injecté n'expose pas d'option fetch `cache` : aucun faux argument `no-store` ajouté qui serait ignoré. Aucune persistance mobile ni réutilisation d'un ancien succès après invalidation. Le comportement effectif des caches du bridge Android reste à vérifier sur appareil.

| Contrat serveur | État affiché |
|---|---|
| `verified`, observation fraîche et valide | `available` : lecture autorisée et vérifiée |
| `missing-scope` | autorisation OAuth manquante |
| `forbidden` ou HTTP 403 | permission refusée |
| `rate-limited` ou HTTP 429 | limite Twitch atteinte |
| `unauthorized`, HTTP 401, indisponibilité, réponse invalide/absente/périmée | `unknown` |

Les messages sont fixes, posés avec `textContent`. Aucun champ brut, scope, token, identité ou erreur réseau n'est affiché. `available` atteste uniquement une lecture ; ni Shield activé, ni réglage AutoMod, ni mutation autorisée, ni diffusion publique.

## Invalidation, courses et fraîcheur

L'état redevient inconnu immédiatement au signal de déconnexion, changement de source/compte hôte, masquage du panneau, suspension du document, événement navigateur offline ou destruction. Un numéro de génération invalide les promesses précédentes ; vérification avant requête et après réponse, y compris après changement de source/reconnexion. Aucune réponse tardive ne rétablit un état disponible invalidé.

Les observations doivent porter un broadcasterId numérique, des dates finies cohérentes, une échéance future limitée à 60 secondes et `mutationAvailable:false`. Horloge future, décalage incohérent ou expiration => unknown, sans supposer une synchronisation PC/Android. Un timeout local unique efface l'observation à l'échéance ; c'est une expiration d'affichage, sans horloge de session ni autorité de minuteur live. Il est nettoyé à l'invalidation/destruction. Après retour de l'application au premier plan ou événement online du navigateur, une vérification explicite est requise, sauf nouvelle transition de contexte fournie par l'hôte.

Une révocation serveur silencieuse après réception n'est pas poussée par ce contrat : elle sera constatée à la prochaine lecture, et le succès précédent expire au plus tard à l'échéance. La déconnexion observée efface immédiatement le succès. Aucun pouvoir de mutation n'est déduit du panneau pendant cette fenêtre.

## Commandes exactes et résultats

Tests/contrôles sous `nice -n 15 ionice -c 3`, Vitest un worker ; aucun full npm test, téléchargement, installation ou build Windows/APK.

| Commande | Code et résultat |
|---|---|
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-twitch-mobile.test.ts tests/streamcockpit3-twitch-integration.test.ts tests/streamcockpit3-twitch.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 0, première passe 67 PASS ; finale **68 PASS / 0 échec**, 3 fichiers, après ajout du changement de compte hôte |
| `nice -n 15 ionice -c 3 npm run build:types` | 0, première passe et finale, sans émission |
| `nice -n 15 ionice -c 3 npm run security:check` | 1, avant analyse : `listen EPERM /tmp/tsx-1000/30.pipe` |
| `nice -n 15 ionice -c 3 node --import tsx scripts/security-check.ts` | 0, première passe et finale : 663 fichiers vérifiés |
| `nice -n 15 ionice -c 3 node --check apps/mobile/control/live-monitor.js` | 0 |
| `nice -n 15 ionice -c 3 node --check apps/mobile/control/streamcockpit-twitch-advanced.js` | 0 |
| `nice -n 15 ionice -c 3 git diff --check` | 0 |

Logs : `/tmp/lot-n-tests.log`, `/tmp/lot-n-tests-final.log`, `/tmp/lot-n-types.log`, `/tmp/lot-n-types-final.log`, `/tmp/lot-n-security.log`, `/tmp/lot-n-security-direct.log`, `/tmp/lot-n-security-final.log`.

Les 20 tests nouveaux couvrent mappings, dates invalides, absence source/transport, offline, suspension, absence d'appels hors contexte, GET exact, expiration sans polling, 401/403/429/503, révocation constatée après succès, courses source/déconnexion/destruction, changement de compte, XSS et montage dans le vrai module Live Monitor avec dépendances chat/agent simulées. Les 48 tests B/J réexécutés couvrent le contrat avancé et les permissions/révocations serveur en mémoire. Aucun transport Twitch réel utilisé.

## Limites et branchements non faits

Le DOM utilise une fixture EventTarget avec sélecteurs simulés ; le vrai code `createLiveMonitor` est exécuté, mais pas le document complet de `control.js`. Les liens source/auth/navigation et no-store sont aussi vérifiés structurellement. Aucun navigateur graphique, parcours tactile Android, socket HTTP, bridge natif ou appareil FIXE/laptop/Android n'est qualifié par ces tests. Les dimensions/contrastes réels restent à vérifier.

Le SW généré et les artefacts de packaging ne sont pas régénérés (hors propriété) : l'intégrateur devra renouveler les assets/cache lors de son assemblage autorisé, avant de valider la livraison Android. Aucun appareil n'est mis à jour par ce lot.

Restent ouverts : consentement OAuth aux scopes avancés, modération complète et historique viewer, messages retenus AutoMod, mutations AutoMod/Shield, sondages dans l'UI/HTTP, raids, prédictions et shoutouts. Aucun nouveau flux de confirmation ou commande critique, aucun démarrage/arrêt live, commande OBS, publication planning, mise à jour effective, push ou déploiement. RC2 et installations FIXE/laptop/Android, WorldPrep/Director/Crafty, secrets/profils/clés intacts.

## Commit bloqué, code conservé

Commande exacte :

```sh
git add apps/mobile/control/live-monitor.js apps/mobile/control/streamcockpit-twitch-advanced.js apps/mobile/control/streamcockpit-twitch-advanced.d.ts tests/streamcockpit3-twitch-mobile.test.ts docs/streamcockpit-3/LOT_N_WAVE4.md
```

Code **128**, avant staging :

```text
fatal: Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-N/index.lock': Read-only file system
```

Aucun contournement du montage ni nouvel essai d'écriture des métadonnées. **Aucun commit créé.** Code, tests et rapport conservés dans le worktree pour revue et commit par l'intégrateur ; ticket exclu de la commande. Aucun push/deploy.
