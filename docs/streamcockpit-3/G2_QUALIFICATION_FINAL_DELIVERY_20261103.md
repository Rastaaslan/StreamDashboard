# SC3-FINAL-DELIVERY-001 — qualification logicielle G2
Machine : FIXE Windows 11, uniquement Remote Desktop Commander. Base initiale 17349e061ae97c2fa9e15f95bbdfbfd147520ed2. Cette campagne n’est pas une qualification matérielle ou une candidate G5.

## Parcours intégrés
- F02 : demandes OAuth adaptées, identité Desktop locale IPC, Shield et niveau global AutoMod avec consentement unique et relecture fournisseur.
- F04 : marqueurs et clips Twitch simples avec permissions chat/cloud/clips ; replays OBS existants, chemins hôtes masqués dans les projections. Un clip accepté reste asynchrone.
- F08 : les commandes avancées utilisent la régie sélectionnée sur laptop/Android ; leur transport ne choisit plus le runtime local du chat du laptop.
- F09 : le reçu d’un moment Twitch peut produire une observation via le journal SQLite existant, si une session est liée. Une panne du journal ne déclenche jamais un nouveau POST Twitch.
- ClipForge : routes/commandes refusées explicitement et modules de production exclus ; sources et preuves V4 conservées.

## Résultats exécutés
| Contrôle | Résultat | Limite |
| --- | --- | --- |
| Intégration ciblée après corrections | 45 PASS, 0 FAIL, 0 skipped ; 8 fichiers | Inclut trois cas Edge tactile 320 px, HTTP réel et Twitch simulé |
| Vitest général sur sources fonctionnelles figées | 2255 PASS, 108 skipped, 0 FAIL ; 287 fichiers | 270 fichiers PASS, 17 skipped ; journal sc3-final-frozen-vitest.log |
| Protection QA ajoutée après campagne générale | 6 PASS, 0 FAIL, 0 skipped ; 3 fichiers | Empêche le paquet de test de changer le démarrage Windows réel ; enregistrement QA explicitement refusé |
| Contrôle de provenance ASAR/EXE en laboratoire | 11 PASS, 0 FAIL, 0 skipped | Fixtures ASAR réelles via Filesystem, PE simulé ; ne constitue pas une signature |
| Build de développement / JS livré | PASS, 140 assets publics et 146 fichiers JS syntaxiquement vérifiés | Modules ClipForge absents du runtime livré ; pas une APK/RC |
| TypeScript, types navigateur, sécurité | PASS après corrections, sécurité 924 fichiers | Profils QA temporaires ; aucune qualification des secrets ou matériels |

Compléments exécutés : suite Node générale séquentielle **351 PASS / 0 FAIL / 6 skipped** (357 cas), Playwright réseau **35/35 PASS**, Electron Windows réel sur profils QA isolés **2/2 PASS** (dont Agent sans fenêtre et identité locale). TypeScript, types navigateur, sécurité **924 fichiers** et JS livré **146 fichiers** recontrôlés PASS. Les journaux sc3-final-* sont conservés sur FIXE et consolidés avec ce rapport. Packaging et signatures restent distincts de ces preuves.

## Échecs et limites conservés
- Une première campagne générale, démarrée avant la fin du durcissement des droits clips, a produit 2247 PASS / 7 FAIL / 108 skipped. Les sources/tests évoluaient encore et le serveur de transformations conservait les anciennes interfaces. Elle n’est pas attribuée à la révision figée ; la campagne complète suivante est celle reportée ci-dessus.
- Première suite Node construite : 350 PASS / 1 FAIL / 6 skipped sur 357. Échec HTTP fetch failed dans desktop-modal-completions.node.test.mjs ; recontrôle isolé 8/8 PASS sans modification ni assouplissement des assertions. Cause non établie ; recontrôle général séquentiel exécuté ensuite : 351 PASS / 0 FAIL / 6 skipped.
- Les premiers essais des nouveaux harnais ont échoué sur des erreurs de fixture/matchers ; corrections et résultats finaux sont conservés dans CONTINUITY.md. Une collision de discriminant dans le reçu moment a été détectée par TypeScript puis corrigée avant les preuves finales.
- Aucune clé de production ou installation utilisateur modifiée. Aucun appel Twitch public ni démarrage/arrêt live pour ces tests. G3 reste manuel, G4 exige la construction Android signée et les contrôles de migration/rollback.

## État de gate
G2 reste in_progress : FINAL_DELIVERY_AUDIT_20261103.md recense les fonctionnalités réellement incomplètes. G0/G1 historiquement qualified ; G3–G5 open. Les skipped restent non qualifiés. Aucune promotion de gate à partir des seuls tests ou builds.
