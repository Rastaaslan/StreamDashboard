# Le StreamCockpit 3.1 — Affichage librement personnalisable

**Ticket : SC31-LAYOUT-001** · **Statut : prévu, non développé** · **Créé : 2026-11-01**
**Version cible : 3.1, après la qualification et la livraison de la 3.0.**

## Demande produit validée

Permettre de **moduler librement l'affichage de chaque surface de StreamCockpit** grâce aux éléments déjà regroupés en composants : placer, déplacer, redimensionner, réduire, masquer, réafficher et réordonner les modules, sans modifier les commandes et services auxquels ils sont connectés.

Les composants actuels (minuteur, état OBS/Twitch, chat, sondages, modération, mixeur, DJI, Spotify, soundboard, planning, santé, marqueurs, actions/macros, historique) constituent le catalogue de départ **après inventaire**. Leur encapsulation visuelle actuelle n'atteste pas qu'ils disposent déjà tous d'un contrat de widget réutilisable : créer au besoin des adaptateurs explicites.

## Expérience utilisateur attendue

1. Un bouton **Personnaliser l'affichage** ouvre un mode édition visuel, sur Windows comme sur Android.
2. Glisser-déposer (souris ou tactile) pour déplacer et ordonner les modules. Les boutons **Monter / Descendre / Déplacer vers…** restent accessibles au clavier et aux technologies d'assistance.
3. Redimensionner chaque carte sur une grille à colonnes adaptatives, avec min/max raisonnables. Empêcher les superpositions, les panneaux coupés et les zones tactiles inaccessibles.
4. Masquer, afficher et réduire individuellement les widgets ; une bibliothèque **Ajouter un module** les restaure sans perte de paramètres métier.
5. Créer, renommer, dupliquer, sauvegarder, prévisualiser, rétablir et remettre à zéro des **profils de disposition** : par exemple « Préparation », « Live », « Modération », « Gaming », « Minimal ».
6. Dispositions distinctes par appareil et format : PC stream, PC jeu, Android portrait et paysage ; facultativement profils par écran Windows. Une éventuelle synchronisation entre appareils doit être explicite, avec détection de conflits et sans écraser les modifications locales.
7. Changement manuel de profil immédiat ; sélection automatique selon scène OBS, jeu ou statut live **optionnelle**, désactivable et sans changement de profil sur un état incertain.
8. Import/export JSON de **disposition uniquement**, sans OAuth, identifiants d'association, données de planning ou données privées. Sauvegarde versionnée, annulation, migration et retour aux dispositions par défaut.
9. En mode édition, les actions dangereuses (« démarrer/arrêter le live », bans, suppression, mute critique) ne doivent **pas s'exécuter** au contact d'un déplacement ou d'un redimensionnement.
10. Des contrôles de secours restent toujours accessibles : statut régie/réseau, accès à l'arrêt du live et aux états critiques, minuteur maître. La personnalisation ne crée jamais de seconde régie OBS ni de minuteur local.

## Architecture proposée (non implémentée)

- **Registre de widgets** : ID stable et unique, libellé, capacités requises, interfaces de rendu/cleanup, dimensions min/max, niveau d'accès, modes compacts, états chargement/inconnu/hors ligne.
- **LayoutEngine pur** : résolution de grille, collisions, limites, migrations et règles responsive ; aucune exécution OBS/Twitch ni logique métier dupliquée.
- **LayoutEditor** : interaction souris/tactile/clavier, aperçu, valider/annuler, historique d'annulation, confirmation uniquement pour supprimer un profil.
- **LayoutStore versionné** : profils par utilisateur/appareil/rôle/point de rupture, révision et contrôle de concurrence. Persistance atomique et rollback sur données de disposition uniquement.
- **Pont de contexte** : profils éventuellement associés aux états du live/jeu/scène ; le moteur de contexte prévu en 3.0 propose le profil mais ne déclenche jamais de commande d'action.
- **Contrat d'isolation** : cacher/démonter une carte ne doit pas arrêter ni reproduire les commandes/abonnements du propriétaire hôte. Un composant ne doit pas conserver une ancienne autorisation après déconnexion.
- **Règles de sécurité** : aucune insertion de JavaScript/HTML arbitraire dans les profils, validation stricte du JSON et des IDs, vérification des capacités par le serveur et jamais par une propriété de mise en page.

Exemple de données illustratif, et **non une API existante** :

    {
      "schemaVersion": 1,
      "profileId": "live-minimal",
      "deviceClass": "android-portrait",
      "revision": 3,
      "widgets": [
        {"id": "master-timer", "visible": true, "x": 0, "y": 0, "w": 4, "h": 1},
        {"id": "twitch-chat", "visible": true, "x": 0, "y": 1, "w": 4, "h": 4},
        {"id": "soundboard", "visible": false, "x": 0, "y": 5, "w": 4, "h": 2}
      ]
    }

## Critères d'acceptation 3.1

- [ ] Un utilisateur réorganise et redimensionne les cartes sur Windows sans redémarrer le cockpit.
- [ ] Les mêmes interactions fonctionnent au toucher sur Android, en portrait et paysage, sans débordement.
- [ ] Les widgets masqués peuvent être réaffichés depuis le catalogue ; aucun réglage OBS/Twitch/Google n'est perdu.
- [ ] Trois profils distincts peuvent être créés, dupliqués et restaurés, chacun avec sa disposition propre.
- [ ] Les changements survivent à une fermeture, une reconnexion et une mise à jour de version ; migration et retour arrière vérifiés.
- [ ] Deux appareils peuvent afficher des dispositions différentes avec **un seul état maître** (minuteur/OBS/Twitch).
- [ ] Le mode édition n'exécute aucune action critique, même lors de gestes interrompus ou d'une déconnexion.
- [ ] Le mode hors ligne ne substitue aucune observation périmée à un état réel ; retour en ligne sans écraser les modifications non synchronisées.
- [ ] Les contrôles de sécurité essentiels restent accessibles quelle que soit la disposition.
- [ ] Tests de lecteur d'écran/clavier, petites résolutions, multitouch, changements de profil et charge/performance satisfaits.

## Plan de mise en œuvre futur

1. Auditer les composants réellement encapsulés et définir le registre commun des widgets.
2. Livrer un **MVP de disposition manuelle** (déplacement + visibilité + profils locaux) sur Windows et Android.
3. Ajouter taille/redimensionnement, responsive, bibliothèque de widgets et édition clavier accessible.
4. Ajouter profils contextuels facultatifs, synchronisation contrôlée multiappareils, import/export et migrations.
5. Qualifier sur FIXE, laptop et Android réel et fournir une version 3.1 autonome, sans régression 3.0.

**Exclusion explicite :** ce ticket **n'élargit pas G2–G5 ni la candidate finale 3.0** ; ne pas le lancer en parallèle des travaux critiques de stabilisation 3.0. Le développement 3.1 n'est autorisé qu'après sa planification dédiée.
