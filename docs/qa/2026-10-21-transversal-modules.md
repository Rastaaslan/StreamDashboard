# Next 2.1 — intégration des modules transversaux

Branche : `work/streamdashboard-next21-universal`. Base de ce complément : `25a20ae95282c16d3583805d9e412a20c9dd5141`.
Version : `2.1.0-alpha.1`, intermédiaire. Les résultats ci-dessous ne clôturent aucune qualification universelle.

## Résultat logiciel

Le routage par bouton et macro, les permissions par appareil, le chat YouTube API Windows/Android, le démarrage facultatif de l’agent Windows et la lecture audio Windows indépendante d’OBS sont intégrés. Les états, l’identité de destination et la définition effective des commandes sont contrôlés avant leur exécution. Le détail et les écarts restants figurent dans [l’état de réalisation](../NEXT_2_1_IMPLEMENTATION.md).

## Vérifications automatisées

| Contrôle | Résultat observé |
|---|---|
| TypeScript et modules runtime | Réussis |
| Suite Vitest complète | 1 423 tests, 157 fichiers, aucun échec |
| Suite Node complète | 270 tests, aucun échec |
| Interface Chromium | 79 tests, aucun échec ; relancée après l’ajustement des sorties audio |
| Electron réel sous Linux | 3 scénarios réussis : lancement/persistance/instance unique, 20 démarrages/fermetures, agent sans fenêtre avec audio silencieux |
| Ajustement des sorties audio | 25 tests ciblés Vitest, 13 tests Node et les 3 scénarios Electron réussis |
| Android | 38 tests JVM réussis ; lint et assemblage Debug réussis |
| Windows x64 | Paquet construit ; version, ressources publiques, exclusions et intégrité EXE/ASAR vérifiées |
| JavaScript livré | 65 fichiers vérifiés |
| Invariants de sécurité | Réussis ; ne valent pas mise en œuvre du transport TLS encore manquant |

Les tests utilisent des comptes fictifs, des profils temporaires et des fournisseurs simulés. Electron utilise un affichage virtuel Linux. Les tests audio emploient un fichier PCM silencieux et un volume nul ; ils ne changent pas le volume système.

Le test des vingt démarrages a initialement révélé un arrêt bloqué par une connexion TCP sans requête HTTP. La correction ferme ces connexions, attend les réponses des requêtes déjà acceptées et conserve leurs écritures. Le test de régression couvre la réception de l’accusé après persistance. La campagne Electron complète passe ensuite en 16,7 secondes.

Une relance de l’assemblage Android a échoué faute de variable `ANDROID_HOME` dans le lanceur de vérification ; elle a été reprise avec `/opt/android-sdk` explicitement configuré. La compilation, le lint et les tests ont alors réussi. Aucun défaut applicatif n’a été masqué par cet ajustement d’environnement.

## Portée des preuves

- Les six presets et les changements de configuration partagent les tests du modèle et de l’assistant.
- Les tests de routage couvrent notamment plusieurs destinations, l’exécuteur actif hors ligne, le retrait, les permissions et le changement de définition ; aucun repli silencieux n’est autorisé.
- Le chat YouTube couvre la chaîne propriétaire, la diffusion préparée/active/terminée, les quotas, les coupures et les réponses tardives. Le pont Android est compilé et testé ; le vrai chat pendant un live reste à qualifier.
- Les tests de permissions passent par des requêtes réseau, y compris l’administration, la révocation et la persistance. Le contrôle est réévalué dans la file d’exécution des actions.
- Les sorties audio sont actualisées avant lecture et lors de l’édition. Une sortie configurée absente reste affichée et n’est pas remplacée automatiquement.

Un contrôle supplémentaire de l’isolation Windows, du cycle de vie et des origines autorisées a validé **41 tests ciblés**, puis les trois scénarios Electron complets en 16,6 secondes. La fermeture pendant le chargement et plusieurs demandes de réouverture simultanées sont couvertes par des tests de régression.

Les journaux complets sont conservés avec les artefacts de compilation sur la machine de développement, dans le dossier de campagne `StreamDashboard-Next-universal-qa-20261021` : `transversal-*.log`, `shutdown-electron.log`, `final-outputs.log` et `final-packages.log`.

## Matériel et critères encore ouverts

Le contrôle préalable a retrouvé les applications stables actives sur FIXE et sur le laptop. OBS était actif sur FIXE. Aucune de ces applications n’a été arrêtée ou mise à jour. Aucun téléphone n’était visible dans ADB sur FIXE.

La campagne Windows isolée utilise `scripts/qa-universal-agent.ps1` et un profil de test explicitement isolé. Elle vérifie les ports libres, le SHA-256 du paquet, un profil temporaire, le rôle sans OBS, la fermeture du tableau de bord, l’audio silencieux et la libération des ports après interruption du seul processus candidat. Le [résultat matériel sur FIXE](2026-10-21-windows-agent.json) est réussi : démarrage sans fenêtre, fermeture du tableau de bord sans arrêt du runtime et lecture/arrêt audio silencieux sans OBS. Les processus stables sont restés actifs et les ports du candidat ont été libérés. Ce résultat ne couvre pas les six topologies.

Ce test a révélé une erreur de cycle de vie : la fermeture volontaire pendant une navigation pouvait être interprétée comme une panne et ouvrir une boîte d’erreur bloquante. Cette fermeture est maintenant reconnue ; les demandes de réouverture partagent également une seule création de fenêtre et de runtime. L’isolation du profil est explicitement sélectionnée avant le verrou d’instance Windows, sans dépendre de la seule variable APPDATA.

Restent ouverts : transport chiffré et identité serveur, découverte automatique facultative, cycles de vie et transferts complets des rôles, exécution distante sur Android, lecture multiple, restauration après interruption entre magasins, migration réelle RC11.7, sessions réelles et qualification des six setups. Le téléphone et une diffusion explicitement autorisée seront nécessaires aux essais matériels correspondants.

La matrice conserve donc **75 qualifications ouvertes**. La RC11.7 reste la base stable ; aucune publication finale ou installation de remplacement n’est autorisée par ces seuls résultats.
