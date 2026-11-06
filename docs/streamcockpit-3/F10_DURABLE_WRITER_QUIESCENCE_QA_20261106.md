# F10 — Quiescence contrôlée des écrivains durables (laboratoire Windows)

## Préflight et périmètre — 06/11/2026
- Exclusivement Remote Desktop Commander sur FIXE Windows 11 ; dépôt canonique `streamcockpit/3.0-full-experience`, HEAD de départ `0e3d9a4`, origin GitHub synchronisé et aucun lock Git/merge/rebase constaté. PLAN, feature-matrix, CONTINUITY, MIGRATION et audit final lus avant écriture.
- Cinq fichiers F05/mixeur/CONTINUITY déjà modifiés par un autre propriétaire : laissés intacts et non stagés. OBS et les applications utilisateur uniquement observés, jamais interrompus ni commandés. Aucun accès à laptop, dam-server, Android, RC2, autres projets, profils ni secrets.
- Lot **QA sur fichiers temporaires Windows seulement**, sans production updater, sans route HTTP/IPC, sans installation ni action Twitch publique.

## Risque traité et conception
Le lot F10 précédent vérifiait les journaux F02/F08/F09 **avant** et **après** une copie ; une nouvelle écriture après le dernier contrôle pouvait encore produire une sauvegarde rétrograde. Pour préparer un vrai protocole de maintenance, création de `HostDurableWriterQuiescence` qui encapsule les trois interfaces SQLite vérifiées (AutoMod F02, prédictions F08, moments F09).
- Un seul propriétaire enregistré par domaine. Les méthodes de mutation explicitement revues sont enveloppées ; un appel non reconnu est refusé, les lectures seules restent accessibles.
- `withQuiesced` bloque immédiatement les **nouvelles écritures enveloppées**, attend la fin de celles déjà en cours, puis n'autorise le travail de maintenance qu'après drainage complet. Le succès explicite rouvre les écritures.
- Toute erreur d'un écrivain ou de la maintenance bloque définitivement cette instance ; aucune reprise, libération de reçu, nouvelle tentative Twitch ou réouverture silencieuse.
- `runQuiescedQaUpgrade` enchaîne les trois étapes F10 existantes (checkpoint SHA-256 → migration sur copie → restauration indépendante) sous cette même barrière. Les vrais journaux SQLite F02/F08/F09 restent byte-for-byte identiques dans les copies et reçus consultables.
- Il s'agit volontairement d'une barrière **intra-processus coopérative** : les services actuels, processus indépendants, autres stockages et installations ne sont **pas** raccordés. Ne jamais en déduire une installation ou un rollback de production sûr.

## Qualification réelle du lot
- Six nouveaux scénarios dans `tests/streamcockpit3-durable-writer-quiescence.test.ts` : conservation F02/F08/F09 sur vraies bases SQLite Windows, orchestrateur QA F10 de bout en bout, refus de couverture incomplète/doublon/méthode non revue, attente d'écriture asynchrone en vol, issue incertaine pendant drainage, blocage après échec.
- Dix suites F02/F08/F09/F10/migration/roadmap sur FIXE : **124 PASS / 0 FAIL / 0 skipped**. Log : `%TEMP%\\sc3-f10-writer-quiescence-20261106.log`.
- `npm run build:types` PASS (une déclaration d'import inutilisée dans le nouveau test corrigée avant validation), `npm run check:browser-types` PASS.
- `npm run security:check` PASS (**6 789 fichiers** avant ce rapport), `git diff --check` PASS (avertissements CRLF non bloquants).
- Aucune suite générale, aucun test Edge supplémentaire (pas de nouveau parcours UI), build d'installation, signature ni test physique ; les fournisseurs OBS/Twitch ne sont jamais contactés.

## Restant obligatoire avant convergence
1. Raccorder **sur la source du serveur FIXE** toutes les voies d'écriture pertinentes à une unique barrière, y compris les reçus hors F02/F08/F09 ; aucun writer brut échappant au contrôle.
2. Étendre à un mécanisme **multi-processus** sûr, à la désactivation/reprise authentifiée des producteurs, à la reprise après crash et aux journaux/locks de transaction persistés ; valider via véritable installation QA autorisée, pas seulement sur copie temporaire.
3. G3 réception réelle FIXE/laptop/Android ; G4 signature Windows et Android production même commit, sauvegarde/migration/rollback matériel ; G5 accord opérateur explicite.

Statuts inchangés : F02/F08/F09/F10 `partial`, G2 `in_progress`, G3/G4/G5 `open`. ClipForge avancé reporté en V4.
