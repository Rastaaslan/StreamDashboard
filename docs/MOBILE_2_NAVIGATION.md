# StreamDashboard Mobile 2.3 — navigation focus

## Architecture finale

La barre basse conserve quatre destinations stables : **Accueil**, **Live**, **Sons** et **Planning**. Accueil est un résumé minimal ; Live ne présente que Contrôle, Chat et Audience. **Le camp** regroupe les fonctions de préparation, de gestion et de diagnostic. La palette Commandes y reste disponible comme outil avancé.

## Préférences cognitives locales

Les réglages mobiles sont stockés uniquement sur le téléphone. Le mode **Focus**
masque l'activité, l'aperçu secondaire et les sous-vues non critiques afin de ne
laisser visibles que le statut, la scène, Clip, Pause, Scènes et Micro. Le réglage
**Réduire les animations** neutralise transitions et animations, indépendamment
de `prefers-reduced-motion`. La densité **Confort** est la valeur par défaut ;
Compact et Normal conservent les mêmes positions afin de préserver la mémoire
musculaire.

Les raccourcis contextuels de l'Accueil ouvrent directement Audience, Chat, Live/scènes ou Soundboard. `Le camp` est un menu secondaire en lignes : Préparation, Stream, Intégrations et Application. Aucun endpoint ni contrat réseau n'est ajouté.

## Matrice d'accès depuis l'Accueil

| Fonction | Taps maximum | Chemin |
| --- | ---: | --- |
| Accueil | 0 | destination initiale |
| Live | 1 | barre basse |
| Soundboard | 1 | barre basse ou action Sons |
| Planning | 1 | barre basse |
| Clip | 1 | commande immédiate |
| Pause | 1 | commande immédiate |
| Chat | 1 | aperçu Chat |
| Audience | 1 | métrique viewers/chatters |
| Scene switch | 2 | ligne Scène → choix |
| Mute micro | 1 | ligne Micro |
| Soutiens | 2 | Le camp → Soutiens |
| VOD / Clips | 2 | Le camp → VOD & Clips |
| Automatisations | 2 | menu Le camp → Stream |
| Checklist / Notes | 2 | menu Le camp → Préparation |
| Intégrations | 1 | menu du header |
| Diagnostics | 2 | menu Le camp → Application |

## Fixtures visuelles locales

Les fixtures sont strictement limitées à `localhost` et `127.0.0.1`. Ouvrir `/?fixture=live` ou `/?fixture=offline` pour inspecter Home, Chat, Audience, Soundboard, Supports et Planning sans injecter de données factices dans l'APK de production.

## Validation appareil

Vérifier sur l'APK CI : utilisation à une main, clavier Chat, zones tactiles, safe areas, palette depuis chaque destination principale, longues listes, pad press/cooldown, confirmations critiques et mode réduit des animations. Les captures attendues sont Home live/offline, Live console, Chat, Soundboard rempli/vide, Plus et Planning.


## Design system Campfire Purple 2.2

Le décor utilise un charbon violet et des surfaces prune calmes. Les accents actifs utilisent une braise violette et une lavande ponctuelle ; l’orange identitaire a été supprimé. Les banques d’actions imposent 16 px horizontalement et verticalement, deux colonnes maximum et des commandes de 58 px. Les pads Soundboard sont espacés de 16 px, hauts de 128 px et passent de deux à trois colonnes uniquement au-delà de 540 px.

La Home conserve quatre commandes visibles : Clip, Pause, Scènes et Micro. Sons reste exclusivement dans sa destination principale. Les sous-vues Live visibles sont limitées à Chat et Audience ; Soutiens, VOD et Clips restent accessibles directement depuis le menu secondaire.
