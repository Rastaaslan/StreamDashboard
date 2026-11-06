# F09/F10 — Migration legacy intégrée au parcours de maintenance signé

06/11/2026 — FIXE exclusivement via Remote Desktop Commander. Base `6b428b5f52595c2f2b81cb178df4a6ca8a43107f`, branche `streamcockpit/3.0-full-experience`. PLAN, matrice, CONTINUITY, MIGRATION et audit final relus avant écriture ; Git/remote/locks/processus et propriétaires vérifiés. F05/mixeur et CONTINUITY préservés à l'identique ; le chantier F03 devenu actif pendant cette passe est disjoint et n'est ni modifié ni indexé.

## Écart fonctionnel fermé
Le convertisseur canonique F09 JSON vers SQLite existait mais n'était utilisable que seul ou via le parcours QA détaché. La préparation signée F10 refusait toute différence d'inventaire de profil ; la présence d'un ancien journal empêchait donc le parcours normal de mise à jour par dossiers d'effectuer cette conversion.

Le parcours `createSignedWindowsDirectoryUpgradePlanner` prend désormais une déclaration explicite `moments-json-to-sqlite-v1`, limitée à la racine ou à `config`. Cette déclaration fait partie de l'image canonique authentifiée par la signature éditeur. Une sélection ajoutée/modifiée sans signature ou absente du consentement de l'appelant est refusée. Les manifestes sans migration conservent exactement leur format canonique et leur comportement antérieurs.

La préparation appelle le **convertisseur F09 existant**, sans réimplémenter son schéma ni transformer le profil actif. La seule différence autorisée est : ancien JSON -> archive des mêmes octets + SQLite contenant le même payload. Tous les autres fichiers, paramètres inconnus et reçus AutoMod/prédictions/audio restent identiques. Un profil mélangé, une annexe SQLite en transaction, une archive altérée ou une autre modification est refusé. Le schéma global du profil doit rester inchangé ; ce lot n'autorise pas des migrations arbitraires.

Le contrôle ne se limite pas aux hashes déclarés : il valide le JSON canonique avec `MomentsPipeline`, relit l'archive, ouvre le SQLite en lecture seule, vérifie son intégrité et exige le payload original exact. Un journal vide dont l'empreinte serait déclarée comme cible ne peut donc effacer les événements ou leurs résultats incertains. Cette preuve accompagne préparation, copie candidate, installation, récupération et rollback.

Les étapes préparatoires terminées dont l'accusé est perdu peuvent maintenant être reconnues par une **relecture seulement** des inventaires indépendamment attendus et de la preuve sémantique. Une conversion partielle garde son intention, ses originaux et son verrou ; elle n'est ni relancée ni nettoyée automatiquement. Après une modification des reçus dans la nouvelle version, le rollback reste refusé plutôt que d'effacer l'historique récent.

## Qualification exécutée
- RED avant raccordement : **0 PASS / 2 FAIL / 13 skipped par sélection**, le manifeste signé précédent ne reconnaissant pas la déclaration de conversion. Journal `.git/sc3-f09-migration-red.log`.
- Campagne finale : **20 suites / 312 PASS / 0 FAIL / 0 skipped**, dont **17 nouveaux tests**. JSON `.git/sc3-f09-migration-final-tests.json`, log `.git/sc3-f09-migration-tests.log`. Une première campagne ciblée avait 85 PASS ; ce nombre n'est pas additionné au total final.
- Vrais fichiers temporaires Windows, copies/renommages et SQLite F02/F05/F08/F09/F10. Conversion puis rollback exact à la racine et dans `config`, conservation d'un clip incertain et d'une réservation audio non résolue, refus des modifications non déclarées et des pertes de données malgré des hashes cohérents.
- Préparation, installation migrée et rollback exécutés dans trois processus Windows distincts. Un autre cas quitte réellement le processus enfant avec code 71 après conversion mais avant accusé durable ; le processus suivant retrouve l'intention et confirme le résultat sans nouvelle conversion. Les interruptions ne concernent que les fixtures temporaires.
- `build:types`, `check:browser-types`, `security:check` (**6 832 fichiers au contrôle**) et `git diff --check` : **PASS**, codes 0. Validation `.git/sc3-f09-migration-validation.json`, HEAD inchangé pendant la campagne. Un worker et priorité basse ; aucun build général, installation ou package. Aucun rendu modifié : pas de test Edge supplémentaire revendiqué.

## Limites et suite
Les clés Ed25519 des tests sont éphémères et restent en mémoire ; les EXE/ASAR sont du texte synthétique jamais exécuté. L'identité native positive, la garde live et l'absence d'autres écrivains sont simulées. Les tests de refus Authenticode réels existants repassent, sans certificat ni profil de production. La copie de référence servant à calculer l'inventaire attendu est indépendante de l'effet de migration ; aucune qualification d'un profil utilisateur ou d'une panne électrique n'en découle.

La conversion F09 est maintenant raccordée au planificateur et à la coordination externe existants, **pas activée dans l'updater installé**. Restent le déploiement natif Squirrel/Android, l'exécutant distribué, les observateurs OS/live indépendants, les migrations de schéma autres que ce format F09 et la réception matérielle/signatures. F09/F10 `partial`, G2 `in_progress`, G3–G5 `open`.

**Prochaine priorité :** fermer les raccordements natifs de l'installateur et les parcours fonctionnels F05 restants sous propriété explicite ; ne pas remplacer ces travaux par une nouvelle série de garde-fous isolés. Le chantier F03 concurrent et les fichiers F05 sales ne sont pas intégrés par cette passe.
