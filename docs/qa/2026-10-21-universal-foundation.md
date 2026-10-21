# Next 2.1 alpha 1 — qualification du socle universel

## Périmètre

Base vérifiée : RC11.7 `4c80ba3`, puis `28c1b7e` (complément documentaire uniquement).
Branche de réalisation : `work/streamdashboard-next21-universal`.
Les installations stables n’ont pas été mises à jour. Les essais utilisent des profils temporaires.

Cette qualification couvre le socle commun et ses intégrations initiales. Elle ne vaut pas acceptation des modules sur tous les matériels. Les six setups sont inclus dans les tests du modèle et de l’assistant dès ce jalon.

## Résultats automatisés

| Contrôle | Résultat |
|---|---|
| Compilation TypeScript et copie des modules runtime | Réussi |
| Vitest, 153 fichiers | 1 411 tests réussis |
| Tests Node | 250 tests réussis |
| Interfaces Chromium | 77 tests réussis |
| Electron réel sous Linux, profils temporaires | 2 scénarios réussis : parcours, persistance et relance ; agent sans fenêtre, ouverture et fermeture sans arrêt du runtime |
| Android JVM | 38 tests réussis, aucun ignoré |
| Android lint et assemblage Debug | Réussis |
| Paquet Windows x64 | Version alpha, ressources, ports, exclusions et intégrité EXE/ASAR vérifiés ; exécution sur Windows matériel encore à qualifier |
| Syntaxe JavaScript livré | 58 fichiers vérifiés |
| Invariants de sécurité | Réussis |
| Smoke LAN | Association, authentification, projection, permissions, ticket WebSocket à usage unique et révocation réussis |
| Contrôle de livraison universelle | Refus attendu : 75 qualifications module/setup ou transition restent ouvertes |

Les essais Electron utilisent un affichage virtuel et un trousseau Linux indisponible. Ce cas a permis de reproduire puis de corriger une boucle de sauvegarde des macros : un échec de chiffrement provoquait un résultat, un rafraîchissement et une nouvelle écriture identique. La configuration native n’est désormais persistée que lorsqu’elle change. Le test de régression vérifie une seule écriture et une seule notification malgré les rafraîchissements.

Les tests vérifient aussi la migration et la restauration de l’installation, les révisions concurrentes, l’identité unique lors de premières lectures simultanées, le maintien de l’identité physique après changement d’adresse, l’isolation des autorisations par origine et la conservation des comptes pendant les écritures concurrentes du contrôleur.

## Limites de validation

- Les essais Windows matériels, le S24 réel, les changements de topologie avec appareils réels et la migration d’une copie des données réelles RC11.7 restent à effectuer.
- Aucun direct réel, message de chat réel ou changement de scène/micro réel n’a servi à ces tests.
- Les simulateurs et les tests de protocole ne remplacent pas cette qualification matérielle.
- Le suivi complet des identités et cycles de chat YouTube, le routage par module vers plusieurs appareils et le déplacement complet des responsabilités restent ouverts dans le chantier 2.1.
- Les versions intermédiaires sont des versions d’essai. La RC11.7 reste la base stable jusqu’à acceptation de la nouvelle architecture.

## Reproduction

```sh
npm run build
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node scripts/test-node.mjs
npm run test:browser
npm run check:shipped-js
npm run security:check
npm run mobile:smoke
npm run android:check
npm run desktop:package
npm run universal:status
```

Electron : `playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts --grep 'Electron réel|agent sans fenêtre'`, avec un affichage disponible. Sur Windows, la CI utilise également le paquet produit. Les compilations sur dam-server ont été limitées aux deux premiers processeurs autorisés, avec une priorité réduite.
