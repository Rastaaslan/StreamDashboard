# SC3-FINAL-DELIVERY-001 — audit intégré F00–F10
Base contrôlée : 17349e061ae97c2fa9e15f95bbdfbfd147520ed2, FIXE uniquement, 03/11/2026.
Cet audit fixe les écarts de livraison. Il ne suffit pas à qualifier un parcours.

| ID | Parcours existant ou intégré | Écart de livraison à fermer |
| --- | --- | --- |
| F00 | Desktop --agent démarre sans fenêtre ; service Node et writer mTLS/SQLite testés séparément ; minuteur maître projeté | Livrer et recevoir le mode --agent existant, son autorité unique et sa reprise sur le trio ; le writer Node alternatif isolé n’est pas une preuve de raccordement et n’impose pas une refonte |
| F01 | Route de santé OBS et vue mobile intégrées | Couverture audio/DJI/sync/perf réelle et alertes sur les matériels disponibles ; inconnus conservés |
| F02 | Ban/timeout/delete/unban existants ; Shield et niveau global AutoMod désormais preview/confirm + relecture | Réception OAuth réelle, historique viewer et traitement des messages AutoMod retenus restent à compléter |
| F03 | Banques de contexte raccordées aux observations OBS du maître, catégorie Twitch datée, rôle logique appairé et reçus du circuit existant ; revalidation dans la file native | Réception réelle catégorie/OAuth, suspension et trio ; parcours contexte audio/chat/replay et macros multi-étapes pas tous reçus |
| F04 | Replays OBS ; nouvelles routes et UI de marqueurs/clips Twitch simples, reçus explicites et observation F09 | Vérification réelle hors action publique automatique, fichiers OBS et mise à disposition effective des clips ; ClipForge V4 exclu |
| F05 | Inventaire en lecture ; gain/muet preview/confirm, UUID OBS, file maître, intention durable, relecture et retour manuel protégé intégrés | Réception physique ; mesures et routage PC jeu/VOD incomplets ; historique complet des reçus/rollback après redémarrage restant volatil |
| F06 | Planning, récurrences, export, brouillons assistés avec contrôle des conflits locaux | Duplication dans l’assistant, publication Google et reprise trio non qualifiées |
| F07 | Navigation cinq onglets, banques manuelles et contexte maître intégré ; Edge tactile 320 px avec changement de scène, perte réseau et expiration testé | Réception tactile physique Android/laptop ; rôle logique de télécommande authentifié sans déduire le type matériel ; destinations alternatives réservées aux banques manuelles |
| F08 | Sondages, prédictions create/lock/end, raids, shoutouts intégrés | Deux obstacles d’accès corrigés : scopes OAuth demandés et identité du Desktop local. Réception réelle, EventSub raid et réconciliation sur matériel manquent |
| F09 | SQLite Windows, repères manuels/replays, liste/export ; observation des marqueurs/clips Twitch ajoutée | Pas de dépendance ClipForge ; producteurs Streamlabs/session complète et partage Android physique à qualifier ; F09-Q isolé |
| F10 | Préflight updater, garde live, report et contrats de migration/rollback | Adaptateurs d’installation transactionnelle et rollback réel Agent/Desktop/Android manquants ; aucune installation automatique autorisée |

## Critères révisés
- F04 n’exige aucun encodeur, montage, superviseur FFmpeg ou export vertical.
- Un PASS sur mock vérifie un circuit logiciel ; il ne prouve ni OAuth de production ni matériel.
- G2 reste in_progress jusqu’à résolution des écarts fonctionnels et preuves intégrées ; G3–G5 restent open.
- Priorités techniques restantes : F05 (routage/mesures et reçus après redémarrage), F02 (historique viewer et messages AutoMod), F09 (producteurs Streamlabs/session) et F10 (adaptateurs de mise à jour/migration/rollback). Recevoir sur le trio le mode --agent existant, le mixeur et le contexte déjà intégrés. F06 conserve ses réceptions Google et duplication à qualifier.
- Les critères historiques ne sont ni effacés ni attribués aux nouveaux modules. Voir G2_QUALIFICATION_FINAL_DELIVERY_20261103.md pour les résultats exécutés.
