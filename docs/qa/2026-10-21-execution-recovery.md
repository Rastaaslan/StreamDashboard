# Audio, rôles et récupération — qualification intermédiaire

Date : 21 octobre 2026. Candidat : 2.1.0-alpha.1. Branche : `work/streamdashboard-next21-execution`.
Ce travail complète le transport TLS et les visionneuses Android. Aucune qualification universelle n’est déclarée terminée.

## Comportements ajoutés

- Chaque son peut remplacer les lectures précédentes ou se superposer aux sons locaux, jusqu’à huit lectures. Le réglage existant reste le remplacement. Le moteur Windows et le lecteur Android/navigateur suivent séparément les lectures et leur fin ; un ancien événement de fin ne retire pas un autre son. Arrêter tous les sons libère toutes les sessions. Une sortie sans mixage, dont la source OBS unique, refuse explicitement la superposition.
- Les commandes audio vérifient sortie, format, volume et délai entre lectures. L’adaptateur multi-sorties arrête tous les moteurs ayant une session active et ne redirige jamais vers une sortie différente. Les fichiers en préparation et les réponses tardives du lecteur local sont annulés par l’arrêt.
- Les rôles contrôlent les moteurs locaux : raccourcis globaux, audio, démarrage des services, planning, chats et visionneuses. Le serveur revérifie le rôle avant l’effet et répond `DEVICE_ROLE_STOPPED` si nécessaire. L’arrêt audio et la gestion de bibliothèque restent accessibles. Une activation seulement persistée ne rend pas disponible un moteur Windows non redémarré.
- Toute modification des rôles Windows demande un redémarrage soumis à la garde OBS existante. Les définitions de macros et les comptes restent conservés. Android contrôle les appels natifs de services/planning et arrête son audio local quand le rôle est retiré. Le retrait/rétablissement de l’affichage conserve le panneau d’activité.
- Le journal d’installation est écrit avant les effets et le nouveau document courant. Au redémarrage, ce document choisit l’issue validée ou abandonnée ; l’ancienne sauvegarde est restaurée si nécessaire, et le démarrage Windows est réconcilié. Le journal reste disponible si la récupération échoue. Une autre identité ou une configuration divergente empêche la récupération automatique.

## Vérifications

Exécution dans une copie isolée sur dam-server, sans profil utilisateur ni compte réel :

| Contrôle | Résultat |
| --- | --- |
| Compilation TypeScript et ressources mobiles | Réussie |
| Vitest, 160 fichiers | 1 441 tests réussis |
| Suite Node | 284 tests réussis |
| Playwright navigateur | 81 tests réussis, dont désactivation/rétablissement de l’affichage ; les 15 scénarios concernés par les nouveaux simulateurs HTTPS ont été revérifiés ensuite |
| Android : synchronisation, lint, JVM, APK debug | Réussis ; 42 tests JVM, zéro échec |
| Paquet Windows x64 et contrôle de contenu | Réussis |
| Electron réel sous Linux/Xvfb | 4 scénarios réussis : persistance, 20 démarrages/arrêts, agent sans fenêtre avec deux sons silencieux simultanés puis arrêt, transport TLS épinglé |

Les scénarios de macros, activité et espace autonome réutilisent les nouveaux simulateurs du pont HTTPS natif. Les preuves TLS réelles restent distinctes. Les tests d’installation injectent des interruptions avant et après validation, une identité étrangère et un échec de récupération. Les tests audio couvrent le mixage, l’arrêt global, les événements tardifs et le refus des sorties incompatibles.

Le premier essai de paquet Windows a rencontré un dossier temporaire Forge non accessible. La relance dans un dossier temporaire dédié a réussi ; aucun dossier appartenant à une autre compilation n’a été supprimé.

## Limites conservées

- Le paquet Windows n’a pas encore été qualifié matériellement pour ces nouveaux comportements : le contrôle préalable de FIXE a trouvé les ports de candidat occupés par un autre agent de test. Les ports du laptop étaient également occupés. Ces processus n’ont pas été interrompus. Les applications stables et OBS n’ont pas été modifiés.
- Les tests JVM et l’APK ne prouvent pas le résultat sur téléphone. La matrice matérielle des six setups reste ouverte.
- Le déplacement complet des responsabilités entre appareils, Android comme exécuteur audio/affichage distant, la découverte automatique, la migration d’une copie réelle RC11.7 et la qualification des sessions web restent à compléter dans le chantier 2.1.
- Le journal couvre l’installation et son réglage de démarrage Windows ; il ne constitue pas une transaction générale entre tous les magasins ou services cloud. Les macros natives de tous les contenus locaux restent à compléter.
- Aucun live, message de chat, changement de scène ou de microphone réel n’a été déclenché. La version reste un candidat d’essai, sans publication sur `main` ni remplacement de RC11.7.
