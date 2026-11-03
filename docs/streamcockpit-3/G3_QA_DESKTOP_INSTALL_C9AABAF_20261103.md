# G3 — activation QA Desktop c9aabaf sur FIXE + laptop, 03/11/2026 soir

## Autorisation et périmètre
- L'utilisateur a explicitement demandé d'installer la nouvelle V3 sur ses deux PC. Cette opération concerne **uniquement** la version portable QA et des profils QA distincts, sans toucher à la RC2, aux profils de production ni aux autres projets.
- Source du packaging Windows x64 : commit propre `c9aabafb3d8c46dd935531d2000ad9f6fc99b96b`, identique au commit intégré dans l'APK QA récent. `desktop:prepare`, `desktop:icon`, `build`, `desktop:package:built`, contrôle de provenance et du paquet : PASS.
- Windows x64 EXE **non signé (QA seulement)** SHA256 `DE7CB375AE3ACDA8933164F8985E38585B0A9BBCA11368FA110A5E6D53CF45D4`, ASAR SHA256 `D87C1A27E7CCC5100E939E5A6C48340F49ADC677A86A0E48089A7F77249DD852`. 77 fichiers, 385900741 octets sur chaque PC.
- Copie sur FIXE `C:\Users\damie\StreamCockpit-QA\c9aabaf\app`, transfert LAN vers laptop sous archive SHA256 `AADCFA0766BF0098058C949487A3A29502E36727C6D110F9F190717215E91829`. Intégrité EXE + ASAR vérifiée sur laptop. Serveur de transfert à jeton éphémère arrêté et règle temporaire `SC3-QA-TRANSFER-C9AABAF-ONCE` retirée, archives temporaires à nettoyer uniquement après vérifications.
- L'ancienne QA portable `2591d88` et son profil utilisateur sont **conservés** sur les deux PC pour le retour arrière. L'ancienne QA `e71e748` en fichiers reste également conservée, sans exécution.

## Bascule réalisée sur les deux machines
- Avant transition : instance QA `2591d88` active sur chaque PC, FIXE signalait OBS streamingKnown=true/streaming=false, recording=false et minuteur arrêté. Aucune commande OBS/Twitch de mutation ni aucun live lancé.
- Chaque ancienne fenêtre QA a été fermée **gracieusement** (CloseMainWindow + attente de sortie et libération des ports). Profil QA source copié, sans lire ni exporter les secrets, vers un second profil sous `%TEMP%\streamdashboard-qa-sc3-c9aabaf-{fixe|laptop}`. L'ancien profil reste inchangé.
- Nouveau Desktop démarré sur FIXE en mode maître via `--qa-profile=...-fixe` : propriétaire HTTP `127.0.0.1:48133` et HTTPS LAN `48136`, OBS connecté `ws://127.0.0.1:4555`, Twitch connecté, Google connecté (4 calendriers listés après réactualisation, cible Google conservée), 2 appareils appairés enregistrés, minuteur non démarré, aucun direct en cours.
- Nouveau Desktop démarré sur laptop via `--qa-profile=...-laptop --role=client` : HTTP loopback `127.0.0.1:48135`, `obs-executor` absent des rôles, OBS local déconnecté par design, aucun minuteur local en cours. Twitch local connecté ; Google local non connecté, facultatif lorsque le planning maître est sur FIXE.
- Les deux fenêtres Electron sont en cours d'exécution et répondent. Les raccourcis existants `Le StreamCockpit 3.0 - QA.lnk` sur les deux bureaux ciblent désormais `C:\Users\damie\StreamCockpit-QA\c9aabaf\Lancer StreamCockpit QA.cmd`, respectivement maître/client ; pas de démarrage automatique Windows ajouté.

## Pare-feu limité au LAN
- Windows avait généré une nouvelle règle **Block Inbound TCP** pour l'EXE `c9aabaf`. Le laptop ne pouvait donc plus accéder à `48136` malgré le listener local (HTTP 000).
- Seule cette règle TCP *pour ce nouvel EXE* a été désactivée. La règle UDP Block du même EXE reste active.
- Règle allow ajoutée `SC3-QA-C9AABAF-LAN-TLS-48136` : **programme exact c9aabaf**, TCP entrée uniquement, port local `48136`, IP locale `192.168.1.15`, IP source `192.168.1.0/24` uniquement ; aucun port OBS ou HTTP local rendu public. Après correction : depuis laptop, `GET /api/v1/health` HTTPS = 200, accès non appairé `/api/v1/state` = 401 et gestion non autorisée `/api/v1/remote/info` = 403, conformément aux contrôles.
- Au retour arrière vers l'ancienne QA : arrêter proprement la nouvelle, réactiver sa règle TCP Block précédemment désactivée et retirer la règle allow limitée au LAN. Ne pas toucher aux règles de production/RC2. Si l'IP locale change, cette règle dédiée ne fonctionnera plus et devra être requalifiée.

## Statut réel
- **Installé et démarré sur FIXE + laptop** en QA non signée, pas un installateur production ni une certification finale.
- Le couplage réseau TLS est prouvé, mais la réception de commandes authentifiées depuis laptop/Android (reçus, horloge, reconnexion, actions OBS hors live), les signatures production, le rollback complet, les contrôles DJI/Spotify/VOD/Streamlabs/Discord et G4/G5 restent ouverts.
- Ne pas déclarer G3 qualifié sur ces seuls résultats. Les précédents tests de stress Electron avec ancien runtime sur 48133 avaient échoué à cause de collisions de ports, et ce nouveau passage n'exécute pas une campagne Electron de stress pendant une QA utilisateur ouverte.

## Nettoyage final
- Après vérification EXE/ASAR sur chaque PC, les deux archives ZIP de 150 MiB ont été supprimées ; le serveur one-shot était déjà arrêté, et son script local supprimé. Seuls les paquets installés, les profils QA et les anciennes versions utiles au repli restent présents.
