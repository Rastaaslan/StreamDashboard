# P0 — Chevauchement interne du chat Twitch, 04/11/2026

## Défaut reproduit
- Le précédent plafonnement de hauteur cachait le symptôme sans gérer les statuts/erreurs longs et la saisie agrandie.
- Sur les ressources QA dans Microsoft Edge, des statuts longs + 20 messages synthétiques font dépasser le chat de 337 px sur Desktop 1366x900 et de 653 px sur mobile 390x844. Aucune commande Twitch réelle.
- Test versionné tests/streamcockpit3-chat-layout-browser.test.ts : RED avant correction, 353 px de dépassement sur fixture.

## Correction
- twitch-chat.css : chat à hauteur intrinsèque, en-têtes/statuts/formulaire sans rétrécissement forcé ; seul le journal des messages défile.
- control.css : enveloppe du chat non compressible dans la colonne Twitch Desktop ; le panneau externe garde son défilement.
- mobile-ergonomics.css : hauteur intrinsèque avec minimum compact adaptable, sans masquer les outils suivants.
- control-sw.js : cache offline reversionné par le build, pour charger les nouvelles feuilles de style.

## Qualification
- Test browser GREEN : 1 PASS / 0 FAIL, six formats 1366x900, 1280x700, 1920x1080, 390x844, 320x690, 844x390 ; 0 chevauchement, 0 débordement horizontal.
- Scénario de surcharge recontrôlé dans le vrai DOM navigateur : scrollHeight == clientHeight du chat, aucune section Twitch superposée.
- Suites ciblées chat-routes, planning, modération Edge et layout : 16 PASS, 0 FAIL.
- TypeScript, types navigateur, sécurité (6724 fichiers), build (143 assets), JS livré (149 fichiers) et diff-check PASS.

## Limites
- Le test est Edge/synthétique, pas une réception tactile Android physique. Ne pas toucher aux actions Twitch/OBS.
- Reconstruire Windows + Android du même commit propre avant installation ; G2 en cours et G3/G4/G5 ouverts jusqu'aux preuves matérielles/signatures/rollback.
