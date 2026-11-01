# StreamCockpit — Écart de refonte mobile constaté le 01/11/2026

## Diagnostic vérifié sur la RC1 publiée
- Le script Android charge `/mobile/control/index.html` via WebView.
- En mode compact, `livePage()` utilise `compactLivePage()`, et non la page Live Desktop.
- La RC1 compacte contient quatre volets Live (Chat / Micro-Spotify / Soundboard / Diffusion) mais **ne rendait aucun minuteur**.
- La RC1 a quatre destinations primaires en navigation simple (Live / Deck / Planning / Réglages), contrairement à la cible à cinq onglets convenue (Accueil / Live / Sons / Planning / Plus).
- La plupart des styles reposent sur la base mobile historique enrichie de panneaux; le rebranding ne constitue pas une refonte intégrale.
- Spotify pilote le lecteur Windows de la régie; ce n'est pas encore un compte Spotify connecté avec bibliothèque/métadonnées complètes.
- Des modules existent pour DJI, Streamlabs, WizeBot, modération et Deck, mais cela n'atteste pas un parcours utilisateur entièrement intégré et qualifié.

## Correctifs sur la branche mobile-timer-fix-20261101
- Bandeau de minuteur visible sur les écrans compacts, lié uniquement à l'état de la régie associée.
- Ouverture directe du volet Live → Diffusion et panneau de minuteur avec commandes.
- Horloge partagée dans tous les composants visuels; pas de second moteur Android.
- Ordre d'initialisation des identifiants Windows client corrigé.
- Deux scénarios Playwright vérifient présence et propagation d'une échéance de régie.

## Exigences avant d'affirmer une « grande refonte » terminée
1. Navigation mobile à cinq onglets réellement livrée : Accueil, Live, Sons, Planning, Plus.
2. Accueil/cockpit synthétique avec état de régie, OBS, Twitch, minuteur et prochaines actions.
3. Interface Live à volets cohérents, commandes critiques lisibles, retours d'exécution et états hors-ligne explicites.
4. Deck adaptatif, macros contextuelles, Spotify, suivi batterie DJI, modération, WizeBot, Streamlabs et planning vérifiés dans l'application Android.
5. Tests d'accessibilité/touch, petits écrans, rotation, reconnexion, appairage, multiappareils et chronomètre partagé.
6. APK signée/versionnée et Windows de la même révision, preuve de migration et retour arrière, test réel sur le téléphone.

Ne pas attribuer au correctif du minuteur le statut de « refonte complète ». Ne pas remplacer la RC1 de l'utilisateur sans vérification et autorisation de nouvelle livraison.
