# G4 — préparation, pas validation

SDK 35/build-tools et cache Gradle existent déjà sous .build/sc3-android-toolchain ; le diagnostic sans ANDROID_HOME les ignore. Ils sont réutilisés uniquement dans l’environnement du processus, sans installation ni configuration globale. Certificat Windows et clé Android stable de production non configurés. Ne jamais les remplacer par une signature Debug.

Une seule paire QA de ce lot doit être construite à partir du commit propre noté dans evidence/qualification.json et artifacts.json, avec provenance embarquée et hash source identiques. Cette paire reste une préparation de développement, non une RC G4/G5.

Aucune installation, publication, modification de profil utilisateur, de clé de production ou sauvegarde de masse. Les tests de migration/repli sur répertoires temporaires ne prouvent pas une migration de l’installation réelle. Le repli RC2 et les anciennes QA sont préservés ; copie ciblée du profil et compatibilité de signature doivent être vérifiées par l’opérateur avant toute autorisation d’installation.

G4 reste ouvert : signature Windows de confiance, signature Android stable compatible, réception matérielle, conservation des données et retour arrière réel manquent. Une disponibilité SDK n’est pas un accord de release.

## Paire QA effectivement vérifiée

- Commit source commun : 73a6aae2a8e59c1c22c1f0d304cccb08c1586718 ; arbre propre ; sourceTreeSha256 9da384c3e69b69827576fc7d0e34c3f96d621199ddd8ac6e4eaea4581f9b9838.
- Windows x64 : C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience\out\sc3-flow-qa\73a6aae2a8e5\windows-x64\StreamDashboard.exe ; SHA-256 bebfa95de3545166cd3158a5c0a8025c28edbe0d91c121123ab9a3be3b03dc11 ; Authenticode NotSigned.
- Android QA : C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience\out\sc3-flow-qa\73a6aae2a8e5\Le-StreamCockpit-3.0-flow-android-qa.apk ; SHA-256 f41e65433c017b59fb1cde4c92e199e687f1a0bff2b5e76f1af8608423fad544 ; Android Debug; verified v2; NOT production ; package com.rastaaslan.streamdashboard.remote.next.qa.
- Provenance ASAR/ZIP, égalité commit/hash source et intégrité EXE/ASAR vérifiées. Aucun APK de production ou installation. Les signatures de production, compatibilité avec l’app utilisateur et rollback matériel restent non qualifiés.
