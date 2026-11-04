# Répartition Windows / Android

| Fonction | FIXE Windows | Laptop Windows | Android | Décision |
|---|---|---|---|---|
| OBS/scènes/minuteur | Propriétaire et configuration | Intentions vers FIXE | Live > Diffusion, Accueil minuteur | KEEP propriétaire ; DUPLICATE contrôles |
| Live/chat/modération | Espace Régie | Contrôle et chat local ou de source nommée | Live > Chat immédiat, régie par défaut ; compte Android explicite | SIMPLIFY source ; KEEP deux OAuth séparés |
| Audio/sons/replay | Exécution et réglages complets | Commandes utiles | Sons, Live > Micro, clips | KEEP FIXE ; DUPLICATE commandes pertinentes |
| Planning | Administration et édition avancée | Consultation/édition permise | Onglet Planning, modifications simples | MOVE menu Desktop vers Administration ; KEEP onglet mobile |
| Macros/configuration/comptes | Administration > Gestion / Configuration | Contrôle secondaire selon droits | Plus et Deck ; pas de nouvel éditeur mobile complexe | KEEP / SIMPLIFY |
| Santé/historique | Diagnostics et activité | Observation du maître | Accueil / Plus | DUPLICATE projections avec fraîcheur |
| Installation/signature/migration | Opérateur, hors live | Opérateur | Opérateur | KEEP autorisation distincte |

Changements concrets : séparation visuelle Régie / Administration dans le menu Windows ; source du chat explicite sur Android ; modération tactile 44 px ; cinq onglets Accueil/Live/Sons/Planning/Plus conservés. Aucune nouvelle duplication d’autorité ni d’authentification imposée.

Mesures logicielles ciblées : contrôle du chat à 320 px et régression six tailles Desktop/mobile. Les mesures au clavier virtuel et au doigt sur Android physique restent à recevoir. Les boutons Intro/Jeu/Chatting/Pause/Fin utilisent les actions de scène existantes ; les noms réels OBS ne sont pas inventés et les profils utilisateur ne sont pas modifiés. Le mode Fin ne commande pas implicitement un arrêt du live.

L’Agent possède déjà un mode --agent et un fonctionnement tray ; la survie réelle à la fermeture de la fenêtre, avec l’installation choisie, relève de G3. Pas de réécriture d’architecture ou de service Windows créée pour cette séparation de navigation.
