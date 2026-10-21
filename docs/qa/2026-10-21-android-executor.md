# Récepteur Android et synchronisation — candidat Next 2.1

Date : 21 octobre 2026. Branche : `work/streamdashboard-next21-completion`. Socles intégrés : `d1743f0` et `ea26952` (continuité des espaces), incluant la preuve TLS entre FIXE et Laptop-damien et le travail audio/rôles/récupération.

## Fonctionnement

- Récepteur HTTPS Android sur le port 48136. Clé privée dans Android Keystore, empreinte SHA-256, TLS 1.2/1.3 ; aucun certificat racine ajouté. Le protocole accepte uniquement des requêtes JSON bornées sur `/api/`. Les origines web, cookies, en-têtes dupliqués et encodages de transfert ambigus sont refusés.
- Codes d’association valables cinq minutes et à usage unique, limitation des tentatives, autorisations distinctes par contrôleur et révocation persistante. Les autorisations et jetons sont chiffrés dans le coffre natif ; ils n’apparaissent pas dans les snapshots ou exports de contenus.
- Lecture des sons présents sur Android, arrêt global prioritaire et commandes WizeBot avec le compte local. Un seul démarrage de commande peut être en préparation à la fois ; l’arrêt, les lectures d’état et la révocation restent indépendants. L’arrêt ne doit pas attendre le décodage d’un fichier.
- Ouverture des écrans Android Twitch/YouTube depuis la liste des appareils connus. Identité physique, rôle d’affichage et permission Chat sont vérifiés. Les cibles sont des identifiants validés, jamais des URL arbitraires. Le reçu confirme la demande native d’ouverture, pas la connexion à un compte web ni le chargement final du lecteur.
- Reçus de commandes persistés avant tout effet et relus après redémarrage ; identifiant réutilisé avec un autre contenu refusé. Une interruption conserve un résultat incertain. L’espace propre au téléphone reste ouvert même si son interface consulte un PC associé.
- Synchronisation des boutons, modèles, profil, préférences, réglages des sons présents et planning. Les modifications locales concurrentes sont comparées dans la transaction IndexedDB. Le planning utilise l’orchestrateur et les comptes locaux ; un reçu est écrit avant ses opérations. Un reçu interrompu ne provoque aucun nouvel essai automatique.
- La signature des modifications réutilise le SHA-256 du moteur commun : elle fonctionne aussi sur l’origine HTTP historique des ressources Android, où SubtleCrypto n’est pas disponible. Le pont d’initialisation peut répondre avant la fin du chargement de la page.

## Vérification

Code vérifié : `5dc0b0860b634759e693ac64901f9adbf387e36a`. Les 30 fichiers concernés ont été comparés par SHA-256 avec le checkout local après compilation et intégration.

| Vérification | Résultat |
| --- | --- |
| Vitest | 1 441 tests, 160 fichiers, réussis |
| Node | 300 cas couverts : 299 réussis dans la suite intégrée, puis correction de l’attente du test Stop et 17 cas ciblés réussis, dont ce dernier cas |
| Interface Chromium | 88 tests réussis |
| Android | 44 tests JVM réussis, lint et APK réussis |
| Smoke desktop | 7 scénarios réussis, dont 4 Electron réels et 3 aperçus navigateur ; 20 cycles de démarrage/arrêt |
| Compilation, sécurité et JavaScript distribué | Réussis |
| Paquet Windows x64 et contrôle de contenu | Réussis |

Le test TLS a révélé une fermeture asynchrone du port : `close()` attend désormais la fin du thread d’écoute. Le contrôle Stop a aussi été retiré du blocage général dû aux conflits de configuration ; les autres commandes restent bloquées. Le test navigateur exerce ce chemin complet.

Les empreintes et emplacements des paquets sont enregistrés dans `2026-10-21-completion-artifacts.json`. ADB ne liste aucun appareil. Le contrôle universel conserve ses 75 qualifications ouvertes.

- `tests/node/device-executor.test.mjs` : association, confidentialité, routage PC vers identité Android, permissions, rôles, reçus après redémarrage, stockage en échec, arrêt pendant préparation, révocation pendant lecture et ouverture des écrans.
- `tests/installation-ui.spec.ts` : vraie base IndexedDB dans Chromium ; synchronisation, reconnexion, doublons, conflits avec une seconde instance, rejet des secrets et des identifiants réutilisés. SubtleCrypto est désactivé pour représenter l’origine Android.
- `ExecutorHttpServerTest` : véritable échange TLS JVM, mauvaise empreinte refusée avant traitement, bonne empreinte acceptée, fermeture du port ; tests du parseur HTTP. Ce test utilise un certificat de test et ne valide pas Android Keystore sur téléphone.
- Suites générales, compilation TypeScript, ressources mobiles, contrôles de sécurité, tests navigateur, lint/JVM/APK Android et paquet Windows exécutés dans le checkout isolé. Les comptes et effets externes sont simulés.

## Limites explicites

Ce candidat ne termine pas la version universelle 2.1. Aucune cellule entière de la matrice n’est fermée par ces ajouts.

Le récepteur Android appartient à l’activité : l’application doit rester ouverte. Aucune disponibilité en veille ou après suspension/fermeture n’est promise. Un téléphone réel doit vérifier la clé Android Keystore, l’association avec Windows, l’audio audible, les écrans, le changement de réseau et le cycle de vie.

L’import de fichiers audio sur le récepteur Android se fait sur le téléphone. Les comptes, sorties et réglages de partage natifs restent configurés localement. Le journal d’édition est borné à 4 096 opérations ; une saturation refuse de nouvelles écritures, sans effacer les anciens reçus. Un export ne purge pas ce journal.

Le déplacement transactionnel complet des responsabilités, la découverte automatique, toutes les macros natives des contenus locaux Windows, la migration réelle RC11.7 et la qualification complète installation/mise à jour/retour arrière restent dans le chantier 2.1. Les essais TLS entre deux PC déjà réalisés ne couvrent pas ces points.

Aucune installation stable n’est remplacée, aucun OBS n’est arrêté, aucun live, message réel, changement de scène ou de microphone n’est déclenché. Les paquets restent des candidats ; la publication finale conserve son blocage de qualification.
