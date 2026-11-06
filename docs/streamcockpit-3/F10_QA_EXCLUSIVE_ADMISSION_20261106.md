# F10 — Admission exclusive Windows sur le parcours QA détaché (06/11/2026)

Machine FIXE exclusivement. Préflight : PLAN, feature-matrix, CONTINUITY, MIGRATION et audit final consultés avant écriture. HEAD de départ 437c809, branche et origin attendus, aucune opération OBS/Twitch, aucun profil, installation, autre machine ni serveur accédé. Les fichiers F05/mixeur et CONTINUITY déjà modifiés par des tiers ont été strictement préservés.

## Défaut et correction
Le garde F02/F08/F09 existant protège les écrivains coopératifs d'un seul processus. Deux exécutions distinctes de la procédure QA de sauvegarde/migration/restauration pouvaient tenter de travailler dans le même espace temporaire. Le nouveau module `streamcockpit-upgrade-qa-lease.ts` exige un dossier enfant direct `sc3-upgrade-qa-*` du répertoire temporaire OS puis acquiert un lock par création atomique exclusive `wx`, synchronise son token et vérifie son identité sur disque. Il est appelé avant le drain coopératif et conserve l'exclusion pendant les trois étapes F10.

Une admission concurrente échoue explicitement, sans migration. Une erreur en cours laisse le verrou en place pour inspection manuelle, sans reprise automatique. Un verrou remplacé ne peut être supprimé par l'ancien propriétaire. Un succès confirmé seul libère le verrou. Ce n'est **pas** un verrou de processus OBS/Agent ni un mécanisme de bascule en production.

## Contrôles
- Trois suites Vitest ciblées : **24 PASS / 0 FAIL / 0 skipped** (4 nouveaux tests d'exclusion/propriété et régression F09/F10). SQLite Node 22 expérimental ; tests isolés, sans fournisseur ni matériel.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (6793 fichiers) ; `git diff --check` PASS avec avertissements CRLF.
- Aucun build global, installation, signature, reprise électrique, WebView Android ou commande OBS/Twitch. Aucun test navigateur nécessaire : module Node de coordination filesystem uniquement.

## Suites
L'exclusivité n'est opposable qu'aux exécutions QA qui adoptent ce verrou. La couverture complète des producteurs multi-processus réels et la coordination des adaptateurs d'installation Agent/Desktop/Android restent les obstacles F10/G2. G2 `in_progress`, G3–G5 `open`, F10 `partial`.
