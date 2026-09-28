# READY_FOR_HUMAN_TEST

État intégré dans le seul worktree CB-7, le 28 septembre 2026. Les sources CB-2 à
CB-6 ont été lues sans modification. Sur instruction humaine complémentaire,
le fetch, l'installation des dépendances et un commit local unique ont été
autorisés. Aucun push, merge, déploiement ou publication effectué.

## Fonctions présentes et conservation des sources

Les fichiers modifiés de CB-2 ont constitué la base canonique. Les changements
des enfants ont ensuite été fusionnés à trois voies et leurs conflits résolus
selon les comportements attendus. Tous les fichiers modifiés/nouveaux des cinq
sources sont présents. Les tests enfants ont été repris ; les harnais CB-2 et
CB-4 ont été adaptés aux dépendances intégrées, et le retry général du test CB-2
a été remplacé par l'assertion d'un retry Google seul, sans republication Twitch.
Trois assertions Vitest sur les anciens textes/statuts Android ont également
été adaptées au Sync Center et à l'assistant acceptés. Le module de diagnostics
dispose désormais de déclarations TypeScript pour ses consommateurs typés.

| Fonction | Intégration et vérification |
| --- | --- |
| Base CB-2 | Capabilities Twitch dans le snapshot serveur et la projection mobile ; guards chat, clips, titre et viewers/chatters ; création/mise à jour Planning par provider ; apparence locale ; guards desktop Google/Discord/Streamlabs et runtime. Tests `cb2-local`, `prelive-integration`. |
| Android release | Workflow et garde Gradle CB-2 conservés, avec `TWITCH_ANDROID_CLIENT_ID` et `GOOGLE_ANDROID_CLIENT_ID` obligatoires pour release. Aucun identifiant réel ajouté. |
| Centre de synchronisation | Accessible depuis Plus ; opérations PC, conflits, dernière réussite, modes et comptes actifs ; retries ciblés partagés avec Planning. Tests `cb3-sync-center`. |
| Planning/providers | Erreurs, conflits, pending/syncing, `deletedRemotely`, suppressions en attente et garde des séries Android. Un provider réussi ne force pas l'autre à utiliser update. |
| Assistant Android | Configuration → OAuth → Test → Prêt, relance OAuth après annulation, réautorisation, scopes, calendrier, dernière sync et messages filtrés. Tests `provider-controls`, `provider-diagnostics`. |
| Capabilities | Compte actif PC ou téléphone ; refus NETWORK/ACCOUNT/CALENDAR/REAUTH_REQUIRED préservés ; changement de mode recalcule les permissions. Un retry Android terminant après reconnexion PC ne remplace plus le dashboard PC. |
| Miniatures et exports | Fallback local, cache borné, refresh/invalidation, URLs Twitch autorisées, chargement sans credentials ; export PNG avec ou sans image. Tests `thumbnails.node`. |
| Pré-live | Accueil, Live et Préparation ; OK/avertissement/bloquant ; OBS, micro, scène, timer, Twitch/scopes, Planning et erreurs providers ; accessible sans checklist activée. Standalone ne bloque pas sur OBS/PC ; les diagnostics Android et tombstones locaux alimentent les avertissements. |

Navigation conservée : **Accueil / Live / Sons / Planning / Plus**. Aucun FAB,
palette globale ou refonte. Contrôle des IDs HTML, imports et propriétaires des
handlers de propriétés sans duplication ; un seul listener `provider-auth`.

## Hors ligne et interactions

Cache unique bumpé : `streamdashboard-mobile-v14-cb7`. Précache de
`sync-center.js`, `provider-diagnostics.js`, `thumbnails.js`,
`prelive-diagnostic.js`, `features/prelive.js` et de leurs dépendances.
Le test découvre aussi les imports dynamiques, simule une installation puis
un réseau totalement indisponible et compare les octets de chaque module.
Les deux entrées `/mobile/` et `/mobile/index.html` restent disponibles.
Les requêtes API, externes, non GET ou contenant une query ne sont pas cachées.

Le test CB-7 relie refus du diagnostic Google → erreur Planning → retry Google
seul → récupération pré-live. Il vérifie que la réussite provider ne supprime
pas les opérations encore en attente du PC. Les snapshots de l'assistant sont
rafraîchis après publication et avant diagnostic Standalone.

Les tests de redaction injectent des valeurs sentinelles dans les diagnostics,
erreurs OAuth et projections serveur et vérifient leur absence des résultats.
Les tests miniatures refusent notamment credentials et tokens dans les URLs.

## Résultats réels

```sh
git fetch origin
npm ci --ignore-scripts
mkdir -p test-results/tmp
TMPDIR="$PWD/test-results/tmp" npm test
npm run build
for file in tests/*.mjs tests/node/*.mjs; do node "$file" || exit 1; done
node scripts/check-shipped-js.mjs
git diff --check
```

- **84 tests réussis, 0 échec, 0 ignoré**, dans 10 fichiers Node.
- **448 tests Vitest réussis dans 66 fichiers**.
- **Build TypeScript et copie du JavaScript runtime réussis**.
- **npm ci --ignore-scripts réussi** : 261 paquets installés, audit sans vulnérabilité.
- **git fetch origin réussi**, écriture de `FETCH_HEAD` confirmée dans le git-dir
  spécifique de CB-7 après correction des droits du worker. HEAD conservé à
  `af4cbcb084920c29958e905793ba96b7ea575472` avant le commit d'intégration.
- **28 fichiers JavaScript livrés : syntaxe valide**.
- **git diff --check : code de sortie 0**.
- Le test `provider-bridge-compile.test.mjs` compile le vrai ProviderBridge avec
  **javac 21.0.12.1**, des signatures Android/JSON et les signatures de ses
  dépendances locales. Compilation réussie ; avertissement d'API dépréciée.
  Cela ne constitue pas un test du comportement Android.
- Node signale le caractère expérimental de `stripTypeScriptTypes`, utilisé
  pour exécuter les véritables contrats/projections serveur dans les tests.

## Limites et parcours humain

Dans ce worker, `npm test` sans TMPDIR échoue avant exécution des tests sur
`ENOENT: mkdir /tmp/.../ssr`. Le répertoire temporaire local ci-dessus permet
de lancer intégralement la suite, sans modifier sa configuration ni exclure de test.
Les tests navigateur n'ont pas été exécutés. Aucun APK construit/signé ni
appareil, OAuth réel ou provider distant testé. L'installation initiale du cache
nécessite une première ouverture en ligne.

La publication native des séries récurrentes reste volontairement refusée,
avec événement local conservé et message explicite : garde acceptée de CB-3.
Le calendrier Google natif reste le calendrier principal, conformément à CB-4.

Pour le test humain, ouvrir successivement les cinq onglets, créer/modifier un
live, vérifier Plus → Centre de synchronisation, autoriser/tester les comptes
Android, provoquer un refus puis réessayer un seul provider. Reconnecter le PC
pendant un retry, vérifier les permissions du compte PC, puis lancer le pré-live
depuis Accueil et Live, y compris checklist désactivée. Enfin, après une première
ouverture en ligne, relancer hors ligne et exporter un Planning avec images
indisponibles. Valider séparément OAuth, OBS/micro et le rendu sur appareil réel.
