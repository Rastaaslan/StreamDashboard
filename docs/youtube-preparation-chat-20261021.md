# Préparation YouTube et chat — branche de développement

Cette évolution a été développée séparément de la candidate Next 2.1. Le 21 octobre, à la demande explicite de Damien pendant sa pause de dix minutes, les deux applications Windows ont été mises à jour en 2.1.0-alpha.2 vers 22 h 24 (Europe/Paris). OBS et ses deux sorties sont restés actifs. Android n’a pas été remplacé.

## Préparer une diffusion

Dans les informations communes du live ou le sélecteur YouTube, « Nouvelle diffusion YouTube… » ouvre un formulaire : titre, description, catégorie, tags, horaire local, visibilité, choix explicite du public et flux réutilisable de la chaîne autorisée.

La régie Windows crée une diffusion, associe le flux et relit les métadonnées et les réglages. Le démarrage et l’arrêt automatiques sont désactivés. Aucune sortie OBS, diffusion existante, métadonnée Twitch ou cible Dashboard n’est modifiée par la préparation. Le bouton « Utiliser pour le prochain lancement » sélectionne ensuite explicitement la nouvelle diffusion avec la révision de configuration attendue.

Ce parcours est utilisable sur Windows, ainsi que depuis un contrôleur Windows ou Android connecté à cette régie. La création autonome sur Android sans régie Windows n’est pas ajoutée ici. La configuration initiale du flux et de sa clé dans OBS reste nécessaire ; l’interface ne demande ni ne transmet la clé. Aucun flux existant n’est reconfiguré.

Les routes `/api/v2/youtube/streams` (GET) et `/api/v2/youtube/prepare` (POST) utilisent les contrôles d’association, de rôle et de permission cloud existants. La création passe directement par la connexion active, sans file d’attente hors ligne. Le journal local `youtube-preparations.json` est écrit avant l’insertion ; un identifiant rejoué, y compris après redémarrage, renvoie son résultat sans recréer la diffusion. Une réponse perdue est signalée comme incertaine. Si une diffusion existe mais que son association ou ses métadonnées ne sont pas confirmées, le résultat conserve son identifiant et demande une vérification, sans nouvelle insertion automatique.

## Chat YouTube

Diagnostic de l’installation en cours, en lecture seule : diffusion active et API connectée ; le panneau web YouTube séparé affichait « Something went wrong ». L’utilisateur a ensuite confirmé que le live était privé par défaut : cette visibilité était la cause du problème du panneau web dans ce cas.

La lecture API est maintenant l’affichage principal et indique explicitement l’absence de messages. Le chat web devient un panneau facultatif, fermé et non chargé au départ. Le bouton d’actualisation relit aussi l’API en respectant la temporisation du lecteur. Les liens vers le navigateur restent disponibles pour écrire et modérer.

## Validation

Les tests de préparation couvrent la création/association/vérification, l’absence de démarrage et de changement de cible, les clés de stream exclues, les doubles requêtes, le redémarrage, les échecs réseau et fournisseur, les erreurs de disque, les changements de compte, les permissions et la validation des entrées. Les tests navigateur couvrent le chat principal, l’ouverture/fermeture du panneau web, le formulaire et le réemploi du même identifiant après une réponse perdue.

Résultats locaux : compilation TypeScript, syntaxe des 88 fichiers JavaScript livrés et invariants de sécurité validés ; 142 tests Vitest ciblés, 12 tests du lecteur de chat et les 24 scénarios navigateur concernés passent (le dernier scénario a été relancé après correction du libellé accessible du champ Public). Les tests utilisent des fournisseurs simulés et un navigateur local ; aucune charge de compilation sur les PC en live.

Aucun événement réel n’a été créé et aucun message de test n’a été publié. L’essai réel avec YouTube reste à effectuer après le live, avant déploiement.


## Installation Windows autorisée pendant la pause

- Code : `6c7fb2d` (fonctionnalités `712a565`), version `2.1.0-alpha.2`.
- FIXE : fermeture propre, profil sauvegardé et 23 fichiers critiques vérifiés ; redémarrage du Dashboard terminé à 22:23:50. OBS est resté le processus 4748 ; sorties Twitch principale et YouTube Aitum actives ; configuration toujours à la révision 35.
- Laptop-damien : fermeture propre, profil sauvegardé et 19 fichiers critiques vérifiés ; nouveau runtime prêt à 22:24:21. Identité locale conservée et activité authentifiée reçue par FIXE à 22:24:38. Les nouveaux modules du chat et de création sont effectivement servis.
- Sauvegardes profils : `%LOCALAPPDATA%\StreamDashboard-Next\backups\alpha2-20261021T202341306Z` sur FIXE ; `alpha2-20261021T202413929Z` sur le laptop. Chaque dossier contient `installation-result.json`. Les anciens répertoires exécutables sont conservés avec le suffixe correspondant `.pre-alpha2-…`.
- ZIP SHA-256 : `aa20380a63f76cf8ad8505732cd1c7ca99351ccd367f495e85f6cd86055a78f9`.
- EXE SHA-256 : `ea1671ec9bce99d9957f82034f051487950ba91eb3a35c025c38b188822061ed`.
- ASAR SHA-256 : `5e10953eab5171254f24935ab054487af48c18072bad62a92296ce32d7e0e90f`.
- Avant la mise à jour, YouTube répondait déjà `quotaExceeded`. La création réelle n’a donc pas été testée et le chat web reste le recours pour ce live. Aucune commande de démarrage/arrêt de diffusion ou de publication n’a été envoyée.
