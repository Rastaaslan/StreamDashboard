# Le StreamCockpit 3.0 — Full Experience
_Date de lancement : 2026-11-01. Référence métier : plan de refonte validé fin octobre._

## Contrat produit
Le StreamCockpit 3.0 est une régie de streaming Twitch-only, pilotable depuis FIXE (PC stream), laptop (PC jeu) et Android, avec un **unique propriétaire des commandes OBS, des minuteurs et du planning** : l'Agent léger du PC stream. L'interface Desktop sur FIXE doit devenir facultative. Les fonctions mobiles ne doivent pas créer une deuxième régie.
**La RC2 est le repli**, et reste dans la branche `streamcockpit/fc1-integration-active-20261101` au commit `1cbb1d9`. Le chantier 3.0 se fait exclusivement dans `streamcockpit/3.0-full-experience`, sans écraser les installations ou données de l'utilisateur.

## Règles non négociables
1. Ne jamais lancer ou interrompre de live public pendant le développement ou les tests automatiques. Toutes les commandes OBS critiques passent par identité authentifiée, capacité autorisée, garde de préconditions, idempotence et relecture de confirmation. Aucune répétition aveugle.
2. Une seule régie et un seul minuteur ; zéro fallback vers le laptop ou Android quand le fixe est déconnecté. L'indisponibilité et les résultats incertains doivent être affichés honnêtement.
3. Twitch seulement ; pas de réintroduction de flux ou comptes YouTube. Les scopes OAuth sont vérifiés à la demande, et toute fonction non autorisée est désactivée avec un message précis.
4. DJI : données batterie réelles avec fraîcheur et provenance, jamais de pourcentage inventé. Spotify : contrôle du lecteur Windows explicitement présenté comme tel tant que l'intégration compte n'est pas réelle.
5. Pas de modification de WorldPrep, Director, Crafty, NAT, OBS de production, profils utilisateurs, secrets ou clés Android. Développement isolé sur dam-server ; charge limitée à quatre lots Codex, sans manipuler les jobs étrangers.
6. Modèle de développement : un lot = un propriétaire des fichiers, des tests de panne et une démonstration de parcours réel. Les composants nouveaux utilisent les interfaces existantes ; pas de refonte générale des API sans justification.
7. Ne jamais qualifier « terminé » sur la seule base d'un build. Le contrôle sur les trois appareils et le retour arrière sont des gates de livraison, jamais des tests fictifs.

## Périmètre exhaustif et dépendances
| ID | Fonction majeure | Réalité de la RC2 et objectif 3.0 | Dépend |
|----|----|----|----|
| F00 | Agent V2 autonome + régie unique | Partiel ; vrai service OBS sans fenêtre Desktop, redémarrage, récupération et horloge maître | socle |
| F01 | Centre de santé et alertes intelligentes | Indicateurs épars ; diagnostic global OBS/Twitch/audio/DJI/sync/perf avec provenance et alertes dédupliquées | F00 |
| F02 | Modération Twitch complète | Ban/timeout/suppression/déban de base ; AutoMod, Shield Mode, historique viewer et permissions | F00 |
| F03 | Régie et macros contextuelles | Deck/favoris/macro basique ; règles selon jeu/scène/état, confirmations et journal cohérent | F00,F01 |
| F04 | Marqueurs / clips / ClipForge | Clips OBS partiels ; marqueurs Twitch/OBS, collecte, export vertical ClipForge vérifié | F00 |
| F05 | Mixeur audio avancé | Commandes audio dispersées ; niveaux/sources/routage OBS+PC jeu sécurisés, VOD préservée | F00,F01 |
| F06 | Planning assisté | Agenda, récurrences et exports ; suggestions, duplication, préflight, publication explicite | F00 |
| F07 | Deck Android adaptatif | Volets et banques présents ; adaptation contrôlée selon rôle/scène/jeu/lancement | F03 |
| F08 | Interactions Twitch | Chat et base modération ; sondages, prédictions, raids, shoutouts avec scopes et retours | F02 |
| F09 | Moments marquants / bilan | Activités Streamlabs présentes ; timeline unifiée, repères et bilan de session | F04,F08 |
| F10 | Mises à jour sans interruption | Updater avec garde de streaming ; mises à jour Agent/clients avec report, migration et rollback sûr | F00 |

## Développement : quatre chantiers maximum en parallèle
**Lot A — OBS / Santé / sécurité :** F00+F01 en priorité ; instrumentation read-only, alarmes fondées sur mesures, tests déconnexion.
**Lot B — Twitch / communauté :** F02+F08 ; capacités OAuth lisibles, outils modérateurs, actions confirmées et erreurs explicites.
**Lot C — Contexte / audio / planning :** F03+F07, puis F05+F06 ; moteur de contexte purement déterministe et interfaces.
**Lot D — Contenu / livraison :** F04+F09, puis F10 ; marqueurs, timeline, ClipForge, packaging et retour arrière.

Au lancement : premier sous-lot d'implémentation par lot. Chaque lot doit livrer un **résultat fonctionnel étroit, testable et non simulé au niveau architecture**, pas prétendre couvrir en une itération toute la roadmap. Ne pas mélanger les branches de travail ; intégration séparée après revue des diffs et des tests.

## Gates obligatoires
- **G0 :** baseline RC2 figée, roadmap et matrice de preuves enregistrées, quatre responsabilités exclusives.
- **G1 :** modules isolés avec schémas d'entrée/sortie, contrôles de permission et tests unitaires.
- **G2 :** intégration sur la seule branche 3.0, zéro duplication OBS/minuteur, tests sécurité/build et UI de chaque fonction.
- **G3 :** FIXE, laptop, Android réellement connectés : scénarios hors-ligne, reconnection, reprise après crash, command receipts, Spotify/DJI si matériel mesurable.
- **G4 :** build Windows x64 et APK issus du **même commit**, signature Android qui permet la mise à jour sans perte, migrations/sauvegardes/repli testés, live public uniquement sous pilotage utilisateur.
- **G5 :** unique candidate complète à tester, critères signés dans la matrice de preuves. Aucun pourcentage inventé : compter les scénarios réellement passés.

## Journal et gestion des changements
La source de vérité machine est `docs/streamcockpit-3/feature-matrix.json` ; chaque module doit y renseigner les preuves vérifiables après intégration. `docs/streamcockpit-3/CONTINUITY.md` conserve décisions, commits, tests, bloquants, suites. Les jobs autonomes ne fusionnent pas leurs propres branches. Un intégrateur unique relit code, diff, preuves et conflits.

## Backlog version 3.1 — hors critères de livraison 3.0
- **SC31-LAYOUT-001 : Cockpit à disposition modulaire et entièrement personnalisable.** Modules à déplacer, redimensionner, afficher/masquer et regrouper, profils par appareil/format et sauvegarde, édition tactile et souris/clavier. Voir ROADMAP_3_1_MODULAR_DISPLAY.md et ROADMAP_3_1_BACKLOG.json.
- Ce chantier **n'ajoute aucune obligation à G2–G5** ; conserver une seule livraison 3.0 complète avant d'engager la phase 3.1. Aucun module existant ne doit être considéré automatiquement apte au drag-and-drop sans audit des contrats de rendu.
