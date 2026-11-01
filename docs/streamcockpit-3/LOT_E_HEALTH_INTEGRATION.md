# Lot E — intégration santé, deuxième vague

Base : `627dca3`, branche `streamcockpit/3.0-lot-e`. Aucun statut qualified ajouté. Matrice de preuve et continuité communes inchangées ; intégration à valider séparément.

## Fichiers livrés
- `apps/server/src/index.ts` : monte le routeur existant après les contrôles d’identité, de permission et de rôle ; relit la permission observe. Lecture du cache uniquement.
- `apps/server/src/remote-api-policy.ts` : GET/HEAD santé autorisés aux appareils associés avec observe ; aucune mutation autorisée à distance.
- `apps/server/src/streamcockpit-health/host-adapter.ts` : projection explicite sans configuration ni jetons.
- `apps/mobile/control/control.js` : page santé sous Plus, transport hôte existant, destruction/expiration du panneau et perte de connexion ; cinq onglets et bandeau minuteur conservés.
- `apps/mobile/control/mobile-five-tab-ui.js` : entrée « Centre de santé » dans Plus.
- `apps/mobile/control/streamcockpit-health/page.js` : lecture GET seule, erreurs visibles, aucun stockage offline ni commande, rejet des réponses après destruction ; durée de transport déduite du délai de fraîcheur.
- `tests/streamcockpit3-health-integration.test.ts` : mapping, HTTP, UI et point d’entrée serveur réel sur données temporaires.
- Le présent rapport.

## Observations réellement branchées
Le serveur ne promeut que son identité Windows activée avec rôle obs-executor. `obsEnabled:false`, `timerAuthority:false`, identité absente ou runtime contrôleur entraînent UNKNOWN. Le signal hôte atteste seulement que ce runtime répond, pas la disponibilité d’OBS ni une qualification physique du FIXE.

Le cache `platformLive.twitch` donne un horodatage produit par l’hôte après lecture API. Une lecture réussie, même hors live, atteste la disponibilité de cette lecture API ; l’UI explique expressément que ce n’est pas une confirmation de diffusion publique. Erreur, timestamp absent/invalide, futur ou ancien : UNKNOWN. Le rôle services doit être présent. Aucune nouvelle interrogation Twitch n’est déclenchée par la santé.

OBS connexion et micro ne disposent pas ici d’un timestamp de mesure attesté : UNKNOWN. Le timestamp du relais DJI vient de l’appareil distant ; receivedAt ne prouve pas l’âge de la mesure et aucune normalisation d’horloge n’existe : UNKNOWN, aucun pourcentage exporté. Synchronisation sans mesure : UNKNOWN. L’état global reste donc UNKNOWN même avec hôte et lecture Twitch disponibles.

## Vérifications exécutées
Tests limités à un worker, aucun build Windows/Android, aucun OBS/Twitch réel. Le serveur réel de test utilise un répertoire temporaire, OBS désactivé, aucune identité fournisseur.

Commande finale de suite :

```
node node_modules/vitest/vitest.mjs run --config /tmp/lot-e-vitest.config.mjs --configLoader native tests/streamcockpit3-health-integration.test.ts tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts tests/mobile-remote-api-policy.test.ts tests/streamcockpit-client-authority.test.ts tests/streamcockpit-timer-authority.test.ts --maxWorkers=1
```

Configuration temporaire : include `tests/**/*.test.ts`, exclusions habituelles du dépôt, cacheDir `/tmp/lot-e-vite-cache`, maxWorkers 1. Cela évite d’écrire le cache de tests dans le node_modules partagé.

Résultats : 87 tests existants PASS ; 5 nouveaux tests PASS après correction du nettoyage de fixture (`stop`, pas `close`). Le premier passage avait 91 PASS et 1 FAIL sur ce nettoyage ; reprise ciblée des 5 tests PASS. La reprise ciblée vérifie aussi le dernier ajustement du délai de transport UI.

- `npm run build:types`, puis `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` : PASS après correction de la fixture.
- `node --import tsx scripts/security-check.ts` : PASS, 632 fichiers.
- `node --check` des fichiers control.js et page.js : PASS.
- `git diff --check` : PASS.

Contraintes rencontrées : lancement Vitest standard bloqué par `.vite-temp` en lecture seule dans les dépendances partagées ; lancement sécurité via CLI tsx bloqué par son socket IPC. Reprise avec configuration/cache /tmp, chargement natif et tests loopback autorisés. Aucun échec masqué comme une réussite. Un lancement Vitest intermédiaire a été interrompu avant résultats pour déplacer explicitement le cache dans /tmp.

## Limites et vrais branchements restants — G2 non final
- Obtenir des observations connexion OBS et audio horodatées dans l’horloge du maître FIXE, avec invalidation sur déconnexion et arrêt de rôle.
- Fournir une mesure DJI locale attestée ou une normalisation de l’horloge distante vérifiée ; ne jamais remplacer observedAt par l’heure de lecture HTTP.
- Fournir une mesure de synchronisation réelle. L’absence d’identité dans les runtimes legacy doit être résolue par le descripteur hôte, pas un fallback vers Android/laptop.
- Vérifier sur FIXE/laptop/Android : rôle maître, association observe, refus après révocation, coupure/reconnexion, ergonomie tactile, cinq onglets et minuteur permanent. Les fixtures DOM et HTTP ne constituent pas cette validation.
- Le centre affiche des diagnostics ; aucune livraison de notifications persistantes/dédupliquées ni couverture complète de F00/F01 n’est revendiquée.
- G2 concerne l’intégration globale et les contrôles UI/sécurité de toutes les fonctions ; ce lot ne ferme ni cette gate ni G3–G5. Aucun paquet construit, push ou déploiement.
