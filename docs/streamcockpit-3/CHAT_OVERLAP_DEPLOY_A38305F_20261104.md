# Déploiement QA du correctif Chat Twitch — 04/11/2026

## Source et intégrité
- Correction source propre a38305fd0e2548043bfca772942ea26565c7dec9, avec test Edge RED puis GREEN sur six formats (voir CHAT_OVERLAP_FIX_20261104.md).
- Windows x64 portable QA non signé : EXE SHA256 BE973C742A3D6E4B56CD5285DA48B9468AB5A90F53D5E9B58209BD50FF55E8BB ; ASAR SHA256 14C5FAC6F7E33D9FB8D433FED1AEF6129C46409D40B1A3433A3DD5D81AB3BFEB. 77 fichiers, 385915591 octets sur chaque PC.
- Android variante QA : package com.rastaaslan.streamdashboard.remote.next.qa, signature Android Debug v2 vérifiée (certificat SHA256 064a2ce0dd1e57d6fa21ad3491fb0a4df28a5b4717c74e622d1abe4d77aef81a), APK SHA256 F48310B863BC42199E25A6FF57D7FCDB3DBCDC6D4B7D85AF3FD221464CBE9438, 3978071 octets.
- Source commit et treeSha256 identiques dans l'ASAR et l'APK : a38305f, ec4f1a654477b0fc44568128d58628e313375d1dd88478dab35f874cf8fb670e, dirty=false. Android Gradle assembleQa/testQaUnitTest/lintQa PASS, 52 JUnit PASS/0 FAIL.
- APK déposé sur le Bureau FIXE : Le-StreamCockpit-3-QA-a38305f-Chat.apk. Pas installé physiquement sur Android lors de cette intervention.

## Installation réelle Windows
- FIXE : ancienne fenêtre QA c9aabaf fermée gracieusement après vérification streamingKnown=true, streaming=false, recording=false, timer running=false. Profil QA ancien préservé ; nouveau profil cloné %TEMP%/streamdashboard-qa-sc3-a38305f-fixe. Nouveau binaire actif en régie.
- Laptop : même procédure avec profil ...-laptop et argument --role=client. Aucun obs-executor local. Ancien binaire/profil préservés.
- Les deux raccourcis de Bureau Le StreamCockpit 3.0 - QA.lnk ouvrent maintenant a38305f et le profil cloné adapté à la machine ; windows RC2 et installations de production intactes.
- FIXE final : OBS websocket 4555 connecté, Twitch et Google connectés, 4 calendriers présents, 2 appareils appairés, TLS actif 48136, pas de live/minuteur. Laptop : HTTP local 48135, aucun OBS maître, minuteur local arrêté, HTTPS FIXE /health 200.
- Pare-feu Windows a auto-bloqué le nouvel EXE. Règle TCP Block de ce seul EXE désactivée, allow SC3-QA-A38305F-LAN-TLS-48136 limitée à ce chemin binaire, port 48136, IP locale 192.168.1.15 et source 192.168.1.0/24. Block UDP laissé actif. Les accès anonymes /api/v1/state et /api/v1/remote/info rendent 401/403.
- Transfert 150 MiB par serveur à jeton éphémère LAN ; serveur arrêté, règle temporaire de transfert retirée et archives ZIP effacées après vérification SHA. Anciennes QA c9aabaf et 2591d88 conservées comme repli.

## Réception visuelle
- Reproduction de stress directement sur la nouvelle UI servie par FIXE (aucune interception CSS) : 1366x900 chat clientHeight=scrollHeight=887 et 390x844 chat clientHeight=scrollHeight=1017, sans collision entre ses enfants. Le journal des messages défile dans sa propre zone.
- Limites : le téléphone Android physique n'a pas été mis à jour par l'assistant ; la réception tactile sur la nouvelle APK reste à faire. Test de surcharge synthétique, pas de commande Twitch/OBS publique. G2 reste in_progress ; G3/G4/G5 non qualifiés malgré la mise à jour réussie des deux PC.
