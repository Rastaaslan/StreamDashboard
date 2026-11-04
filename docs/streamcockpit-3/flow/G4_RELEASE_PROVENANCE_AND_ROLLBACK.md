# G4 — préparation, pas validation

SDK 35/build-tools et cache Gradle existent déjà sous .build/sc3-android-toolchain ; le diagnostic sans ANDROID_HOME les ignore. Ils sont réutilisés uniquement dans l’environnement du processus, sans installation ni configuration globale. Certificat Windows et clé Android stable de production non configurés. Ne jamais les remplacer par une signature Debug.

Une seule paire QA de ce lot doit être construite à partir du commit propre noté dans evidence/qualification.json et artifacts.json, avec provenance embarquée et hash source identiques. Cette paire reste une préparation de développement, non une RC G4/G5.

Aucune installation, publication, modification de profil utilisateur, de clé de production ou sauvegarde de masse. Les tests de migration/repli sur répertoires temporaires ne prouvent pas une migration de l’installation réelle. Le repli RC2 et les anciennes QA sont préservés ; copie ciblée du profil et compatibilité de signature doivent être vérifiées par l’opérateur avant toute autorisation d’installation.

G4 reste ouvert : signature Windows de confiance, signature Android stable compatible, réception matérielle, conservation des données et retour arrière réel manquent. Une disponibilité SDK n’est pas un accord de release.
