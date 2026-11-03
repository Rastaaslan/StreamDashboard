# SC3-FINAL-DELIVERY-001 — audit intégré F00–F10
Base contrôlée : 17349e061ae97c2fa9e15f95bbdfbfd147520ed2, FIXE uniquement, 03/11/2026.
Cet audit fixe les écarts de livraison. Il ne suffit pas à qualifier un parcours.

| ID | Parcours existant ou intégré | Écart de livraison à fermer |
| --- | --- | --- |
| F00 | Desktop --agent démarre sans fenêtre ; service Node et writer mTLS/SQLite testés séparément ; minuteur maître projeté | Livrer et recevoir le mode --agent existant, son autorité unique et sa reprise sur le trio ; le writer Node alternatif isolé n’est pas une preuve de raccordement et n’impose pas une refonte |
| F01 | Route de santé OBS et vue mobile intégrées | Couverture audio/DJI/sync/perf réelle et alertes sur les matériels disponibles ; inconnus conservés |
| F02 | Ban/timeout/delete/unban existants ; Shield et niveau global AutoMod désormais preview/confirm + relecture | Réception OAuth réelle, historique viewer et traitement des messages AutoMod retenus restent à compléter |
| F03 | Commandes/macros et moteur déterministe présents | Prévisualisation contextuelle encore neutralisée ; contexte scène/jeu/rôle authentifié et exécution intégrée manquants |
| F04 | Replays OBS ; nouvelles routes et UI de marqueurs/clips Twitch simples, reçus explicites et observation F09 | Vérification réelle hors action publique automatique, fichiers OBS et mise à disposition effective des clips ; ClipForge V4 exclu |
| F05 | Inventaire gain/mute et tableau OBS en lecture | Écriture intégrée au mixeur, mesures, routage PC jeu/VOD, confirmations et rollback toujours manquants |
| F06 | Planning, récurrences, export, brouillons assistés avec contrôle des conflits locaux | Duplication dans l’assistant, publication Google et reprise trio non qualifiées |
| F07 | Navigation cinq onglets et banques manuelles | Sélection adaptative contextuelle encore UNKNOWN, dépend de F03 ; réception tactile physique |
| F08 | Sondages, prédictions create/lock/end, raids, shoutouts intégrés | Deux obstacles d’accès corrigés : scopes OAuth demandés et identité du Desktop local. Réception réelle, EventSub raid et réconciliation sur matériel manquent |
| F09 | SQLite Windows, repères manuels/replays, liste/export ; observation des marqueurs/clips Twitch ajoutée | Pas de dépendance ClipForge ; producteurs Streamlabs/session complète et partage Android physique à qualifier ; F09-Q isolé |
| F10 | Préflight updater, garde live, report et contrats de migration/rollback | Adaptateurs d’installation transactionnelle et rollback réel Agent/Desktop/Android manquants ; aucune installation automatique autorisée |

## Critères révisés
- F04 n’exige aucun encodeur, montage, superviseur FFmpeg ou export vertical.
- Un PASS sur mock vérifie un circuit logiciel ; il ne prouve ni OAuth de production ni matériel.
- G2 reste in_progress jusqu’à résolution des écarts fonctionnels et preuves intégrées ; G3–G5 restent open.
- Priorité technique après le présent lot : F00 (réception du mode --agent existant et de son unique autorité), F05 (écriture audio et reçus), puis F03/F07 (contexte maître). F02/F06/F09/F10 restent dans la 3.0.
- Les critères historiques ne sont ni effacés ni attribués aux nouveaux modules. Voir G2_QUALIFICATION_FINAL_DELIVERY_20261103.md pour les résultats exécutés.
