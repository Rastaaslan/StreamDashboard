# Lot H — F10, planificateur staged, première passe

Base : `627dca3`, branche `streamcockpit/3.0-lot-h`. Aucun statut qualified : aucune vérification matérielle. Aucun téléchargement réseau, installateur réel, accès OBS/Twitch, mutation de données utilisateur ou build Windows/Android.

## Fichiers livrés

- `packages/core/src/streamcockpit-upgrade.ts` : contrat manifest (versions source/cible, cible desktop/agent/android, source HTTPS, hash SHA-256, signature et versions de schéma), machine staged injectable, journal et migration sur copie.
- `apps/desktop/src/streamcockpit-upgrade.ts` : liaison directe au vrai `requireDesktopRestartSafety`, identique au garde de `startUpdater`, via `assessRestartSafety` injecté.
- `tests/streamcockpit3-upgrade.test.ts` : tests offline avec stockage, reçus et observations simulés.
- `docs/streamcockpit-3/LOT_H_UPGRADE.md` : ce rapport.

Le ticket préexistant `LOT_H_TICKET.md` n’est pas modifié ni inclus au commit. `updater.ts`, les entrypoints, la matrice partagée et CONTINUITY restent inchangés.

## Comportement

`register(manifest, artifact)` déclare un artefact local déjà fourni ; downloaded ne signifie ni téléchargement effectué par ce module, ni authenticité. Un contrat différent ne peut pas écraser le journal. `prepare()` isole puis vérifie l’artefact. `install()` exige une confirmation utilisateur au niveau hôte ; il vérifie à nouveau, sauvegarde, prépare une migration sur copie et demande l’installation. `rollback()` est une action explicite restaurant application ET données. Aucun minuteur ni redémarrage automatique.

Le garde OBS refuse live, enregistrement, observation inconnue, absente ou en erreur. Il est appelé avant préparation, après migration et encore après l’écriture de l’intention, juste avant l’effet perturbateur. Le dashboard injecté doit être celui du maître FIXE et couvrir toutes ses sorties : aucune observation du laptop ou d’Android ne peut autoriser la mutation. Un refus conserve l’état deferred et une explication consultable.

Le journal enregistre les étapes downloaded/staged/verified/deferred/installed/rolledBack et une intention avant chaque effet. Les événements consécutifs identiques sont dédupliqués. Le verrou fourni par l’hôte couvre l’installation entière, pas seulement une instance de classe. Un crash avec intention persistée exige `reconcile`, qui relit les preuves sans réexécuter. Sans preuve, l’opération reste deferred, y compris si l’effet n’avait finalement pas commencé : récupération manuelle obligatoire. Aucune relance aveugle ni rollback automatique d’une installation incertaine. Un échec de journal est propagé s’il ne peut pas lui-même être journalisé.

Les reçus install/rollback doivent correspondre à une version et des données réellement relues après bascule/redémarrage. Un simple lancement d’installateur ne constitue jamais une confirmation. Le champ `installed` conserve le fait historique d’installation après rollback ; `phase` et `rolledBack` indiquent l’état final. Le journal ne contient que des références, jamais les snapshots.

`migrateUpgradeData` applique une chaîne contiguë et non ambiguë, sur copie détachée, en conservant strictement associations/profils et sans modifier le snapshot d’origine. Les données attendues sont des objets JSON persistables ; l’égalité conservatrice JSON peut refuser une simple réorganisation des clés. Les migrations métier réelles ne sont pas encore définies. Une migration qui jette une erreur ou détruit les associations/profils ne doit pas produire de reçu.

## Branches réelles à intégrer et limites

1. Stockage du journal atomique et durable, validation de son intégrité à la lecture, verrou exclusif interprocessus pour tous les plans d’une installation, archivage explicite avant une autre release. Les tests n’émulent pas fsync ni une coupure secteur réelle.
2. Vérificateur cryptographique indépendant : clés de confiance épinglées, liste de sources autorisées, signature du manifest et hash des octets staged immuables. Les champs du manifest seuls ne prouvent rien. HTTPS n’est pas une validation de confiance.
3. Staging sans substitution de fichier, sauvegarde complète immuable de l’application et des profils/associations, migration versionnée métier utilisant la copie sauvegardée. Vérifier la version installée `fromVersion`, le schéma et la cible avant toute bascule ; éviter toute écriture concurrente des profils entre snapshot et bascule.
4. Installer/restaurateur avec clés d’idempotence durables, vérification de la version et des données après redémarrage, relecture des reçus après crash. Un garde ponctuel ne peut éliminer la course avec un démarrage OBS après la dernière observation : l’hôte doit sérialiser les actions critiques avec la régie FIXE.
5. UI affichant deferred/erreurs et confirmation explicite, connexion au flux `startUpdater` après revue d’intégration. Son callback actuel `beforeInstall` ne suffit pas à prouver installed : le reçu de démarrage suivant est nécessaire. Ce lot n’active pas cet updater.
6. Déploiement Agent/clients, signatures Windows/Android, parcours multi-appareils, rollback physique et restauration de véritables profils restent à vérifier. Aucun appareil ni service externe contacté.

Les adapters sont une frontière de confiance : ils doivent respecter ces contrats. Le lot fournit l’orchestration et le garde existant, pas des implementations système fictivement qualifiées.

## Vérification

- Première commande `npx vitest run tests/streamcockpit3-upgrade.test.ts tests/desktop-updater-safety.test.ts tests/desktop-restart-safety.test.ts --maxWorkers=1` : échec de démarrage EROFS, car Vite voulait écrire dans les dépendances partagées en lecture seule ; aucun test exécuté lors de cette tentative.
- Commande adaptée : `./node_modules/.bin/vitest run tests/streamcockpit3-upgrade.test.ts tests/desktop-updater-safety.test.ts tests/desktop-restart-safety.test.ts --maxWorkers=1 --config /tmp/streamcockpit3-upgrade-vitest.config.mjs --configLoader native` : **42 tests PASS, 3 fichiers**, après les derniers changements (29 tests du nouveau lot, 13 de non-régression existants).
- La configuration temporaire reprend include/exclude du dépôt, root sur ce worktree, et déplace uniquement cacheDir vers `/tmp/streamcockpit3-upgrade-vite-cache`. Le chargement natif évite l’écriture `.vite-temp` dans node_modules. Aucun changement des dépendances partagées.
- `npm run build:types` (`tsc -p tsconfig.json --noEmit`) : PASS.
- `git diff --cached --check` : PASS avant commit. Aucun build de distribution.

Scénarios : live/unknown/erreur de lecture ; changement OBS pendant migration et pendant écriture d’intention ; signature refusée/revérifiée ; contrat invalide ; journal indisponible ; absence de reçu ; concurrence ; crash stage/backup/migration/install/rollback ; réconciliation sans répétition ; snapshot simulé restauré ; préservation et refus des migrations destructrices/manquantes/ambiguës. Ces preuves sont unitaires et ne valent pas qualification matérielle.
