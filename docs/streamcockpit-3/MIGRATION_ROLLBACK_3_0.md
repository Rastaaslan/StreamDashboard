# 3.0 — sauvegarde, migration et retour arrière
Préparation SC3-FINAL-DELIVERY-001. Procédure non qualifiée sur les appareils ; aucune autorisation d’installation ou de remplacement n’en découle.

## Préparer sans toucher aux installations
- Conserver la RC2 1cbb1d9 et ses artefacts. Ne jamais utiliser un downgrade binaire sur des données migrées.
- Relever commit, version, identifiant Android et empreinte du certificat de l’installation cible.
- Sur une copie isolée, arrêter l’Agent et toutes les écritures. Archiver ensemble application, config, installation-v2.json, pairing, soundboard, profils et journaux SQLite ; conserver les fichiers annexes SQLite éventuels. Les secrets restent protégés sous le même compte Windows/Android.
- Calculer SHA-256 des fichiers et vérifier une restauration dans un second répertoire de test. Les archives contenant des secrets ne doivent pas être ajoutées au dépôt.

## Migration de test
1. Restaurer la copie de référence dans un profil QA distinct, réseau public désactivé et OBS/Twitch simulés.
2. Démarrer les fichiers 3.0 de la même révision EXE/APK ; conserver les identifiants de régie.
3. Vérifier profils, planning/récurrences, sons, associations, journal des commandes et réservations incertaines.
4. Tester arrêt normal et crash simulé de la copie. Une opération running devient incertaine ; aucune commande externe n’est rejouée.
5. Documenter la migration de journaux JSON vers SQLite séparément : un ancien journal non réconcilié bloque son producteur. Ne pas supprimer la source pour obtenir un démarrage.
6. Android : la mise à jour exige le même applicationId et le certificat de production existant, avec versionCode croissant. Ne pas désinstaller pour contourner une incompatibilité.

## Retour arrière de test
1. Arrêter 3.0 et toutes les écritures.
2. Mettre de côté l’état 3.0 complet avec son journal de commandes ; ne pas le fusionner automatiquement.
3. Restaurer ensemble les anciens fichiers applicatifs et la sauvegarde de données associée.
4. Relire les hashes puis contrôler les associations et le planning avant de réactiver les intégrations.
5. Comparer les effets déjà observés chez OBS/Twitch aux reçus sauvegardés. Une réponse inconnue reste à réconcilier manuellement.
6. Pour Android, le retour à un ancien versionCode peut être refusé par le système ; privilégier un build de retour arrière signé avec la clé d’origine et un versionCode supérieur, sans désinstallation ni perte de données.

## Blocages avant G4
SDK/build-tools Android et clé existante non configurés sur FIXE au contrôle ; aucune chaîne Authenticode de code signing disponible au contrôle. Les adaptateurs de migration/installation transactionnelle et les restaurations matérielles ne sont pas qualifiés. Un build portable non signé doit rester explicitement préparatoire, jamais présenté comme une RC validée.

Contrôle logiciel natif ajouté : le paquet Windows sur profil QA conserve un repère SQLite à l’identique après fermeture puis reprise Agent sans fenêtre. Ce PASS ne prouve ni migration JSON legacy, ni restauration de données de production, ni perte électrique, ni rollback Android. Ces validations restent requises avant G4.

## Vérification réelle sur dossiers temporaires QA (03/11/2026)
- `apps/desktop/src/streamcockpit-upgrade-qa-checkpoint.ts` implémente la copie d'une arborescence de profil **synthétique**, sous un dossier enfant direct de `%TEMP%` nommé `sc3-upgrade-qa-*` uniquement. Le manifeste vérifie chemins relatifs, tailles et SHA-256 ; les fichiers binaires (y compris un journal SQLite synthétique), les identifiants chiffrés synthétiques et les configurations sont restitués octet par octet dans un **nouveau** dossier, sans écraser la source ou le profil d'une application.
- `tests/streamcockpit3-upgrade-qa-checkpoint.test.ts` : six tests sur filesystem Windows avec altération, refuse-traversal et absence de répétition : 6 PASS. Ciblage combiné `UpgradePlanner`, préflight et updater simulé : 65 PASS. La vérification de `file.sync` ne prouve pas la persistance des dossiers après perte électrique.
- **Ce n'est pas un adaptateur d'installation de production, ni une sauvegarde RC2.** Ne pas brancher à `autoUpdater.quitAndInstall`, ne pas présenter comme rollback Android et ne pas promouvoir G4. Il manque la compatibilité des clés existantes, les migrations/profils réels, la qualification du remplacement applicatif et le rollback matériel.
