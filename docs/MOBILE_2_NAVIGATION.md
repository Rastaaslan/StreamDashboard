# StreamDashboard Mobile 2.0 — navigation et validation

## Architecture finale

La barre basse contient cinq destinations stables : **Accueil**, **Live**, **Sons**, **Planning** et **Plus**. Le bouton flottant **Commandes** reste disponible au-dessus de la barre depuis chaque destination et ouvre une palette basse avec recherche, commandes récentes bornées, scènes, actions Stream et six sons favoris.

Les raccourcis contextuels de l'Accueil ouvrent directement Audience, Chat, Live/scènes ou Soundboard. `Plus` est un menu système en lignes : Préparation, Stream, Intégrations et Application. Aucun endpoint ni contrat réseau n'est ajouté.

## Matrice d'accès depuis l'Accueil

| Fonction | Taps maximum | Chemin |
| --- | ---: | --- |
| Live | 1 | barre basse |
| Soundboard | 1 | barre basse ou action Sons |
| Planning | 1 | barre basse |
| Clip | 1 | commande immédiate |
| Pause | 1 | commande immédiate |
| Chat | 1 | aperçu Chat |
| Audience | 1 | métrique viewers/chatters |
| Scene switch | 1 | état Scène vers Live |
| Mute micro | 1 | palette Commandes |
| Soutiens | 2 | Live → Soutiens ou palette |
| VOD / Clips | 2 | Live → Média |
| Automatisations | 2 | Plus → Automatisations |
| Checklist / Notes | 2 | Plus → Préparation |
| Intégrations | 1 | Plus |
| Diagnostics | 2 | Plus → Application |

## Fixtures visuelles locales

Les fixtures sont strictement limitées à `localhost` et `127.0.0.1`. Ouvrir `/?fixture=live` ou `/?fixture=offline` pour inspecter Home, Chat, Audience, Soundboard, Supports et Planning sans injecter de données factices dans l'APK de production.

## Validation appareil

Vérifier sur l'APK CI : utilisation à une main, clavier Chat, zones tactiles, safe areas, palette depuis chaque destination, longues listes, pad press/cooldown, confirmations critiques et mode réduit des animations. Les captures attendues sont Home live/offline, Live console, Chat, Soundboard rempli/vide, Plus et Planning.
