# Audit Intro / Pause / Fin — 2026-11-04 (FIXE)

- Périmètre : source StreamCockpit 3.0 sur FIXE, branche canonique, OBS de production seulement observé comme processus ; aucune commande OBS, aucun changement d'installation/profil.
- Chemin des commandes : boutons `mode.set` (Desktop/Android) → API/autorisation régie → `DashboardCommandService.setMode` sur FIXE → `obs.scene` → confirmation `waitForScene` ou relecture → commit du mode. Si mappage absent, refus explicite.
- Intro : `startMode: intro` par défaut ; `session.start` sélectionne la scène mappée avant de démarrer OBS, et peut démarrer le stream : à ne jamais utiliser pour un simple changement de scène. Bouton `mode.set: intro` indépendant.
- Pause : `mode.set: pause` sélectionne la scène et ne suspend pas automatiquement le flux ni le minuteur. Le bouton `timer.pause` est distinct.
- Fin : `mode.set: end` sélectionne la scène sans arrêter la diffusion. `session.stop` est une action séparée qui sélectionne la scène de fin, attend puis arrête effectivement OBS ; ne jamais déclencher pour un simple écran de fin.
- Mappage des scènes : `settings.modeScenes.intro/pause/end` sélectionnées uniquement parmi les scènes réellement découvertes par OBS dans Réglages. Aucun nom OBS réel n'a été prouvé pendant cet audit : pas de correspondance inventée, pas de mutation des profils. Le Deck local neuf ne proposait pas Fin ; ajout d'une action explicite, distincte de `live.stop`.
- Macros contextuelles : banques `intro`, `pause`, `end` pilotées par la scène observée, avec preuve d'autorité FIXE ; aucune seconde horloge ni changement OBS implicite dans le moteur de contexte.
- Tests ciblés après correction : 78 PASS / 0 FAIL / 0 skipped (33 service, 44 Android, 1 nouveau test). TypeScript PASS ; sécurité 6734 fichiers PASS ; `git diff --check` PASS. Aucun test matériel de commutation OBS n'a été effectué.
- Restant pour paramétrage effectif : relever les noms de scènes OBS réelles via un parcours lecture seule autorisé, puis associer Intro/Pause/Fin dans les Réglages de la régie après avoir vérifié le direct et les propriétaires actifs. Aucune installation utilisateur modifiée dans ce lot.
