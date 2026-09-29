# Google Agenda Desktop — CB-38

Base : `0cddfdd`. La distribution comportait un `googleClientId` vide : sans
`GOOGLE_CLIENT_ID`, le bouton ne pouvait pas lancer OAuth. Le Client ID public
Desktop fourni est désormais embarqué dans `resources/distribution.json` et
repris par la préparation de distribution et le runtime Electron. Aucun secret
n’est ajouté. Le client existant utilise PKCE S256 et n’exige pas de secret.

Credential Google Console attendu : **ID client OAuth 2.0 — Application de bureau
(Desktop app)**. Calendar API doit être activée ; en mode consentement « Test »,
le compte doit faire partie des utilisateurs test autorisés.

URI normale exacte : `http://127.0.0.1:47832/api/v1/google/oauth/callback`.
Si le port est occupé, le serveur choisit un port libre : l’URI exacte est alors
la valeur `redirect_uri` dans l’URL retournée par `POST /api/v1/google/oauth/start`.
Cette même URI est utilisée pour l’échange du code. Les credentials Desktop
acceptent les ports loopback dynamiques ; ne pas utiliser un credential Web.
Le navigateur doit tourner sur le même PC et le runtime doit rester ouvert.

`invalid_client` et `redirect_uri_mismatch` sont affichés avec le type attendu et
l’URI effective lorsque Google renvoie une erreur au callback ou au token endpoint.
Si Google bloque sur sa propre page sans callback, le runtime ne peut pas lire
cette page : après dix minutes, il signale explicitement le callback non reçu.
Une nouvelle tentative reste possible. Les erreurs de callback sont diffusées
au renderer par le websocket existant, comme la réussite.

Validation locale : le test `tests/google-desktop-e2e.node.test.mjs` utilise le
renderer, le serveur HTTP, le callback, le stockage et les mises à jour websocket
réels. Seules les réponses Google sont simulées. Il vérifie aussi un port occupé,
le choix du calendrier Planning et le redémarrage. L’accès au vrai compte Google
et la configuration Console ne sont pas validés par ce test.

Commandes : `npm test`, `npm run build`, `npm run security:check`,
`npm run check:shipped-js`, puis
`node --test tests/google-desktop-e2e.node.test.mjs tests/desktop-connections.node.test.mjs tests/desktop-planning-editor.node.test.mjs`.
Dans un sandbox sans `/tmp` accessible, définir `TMPDIR` vers un dossier writable ;
`PLAYWRIGHT_BROWSERS_PATH` peut désigner l’installation locale de Chromium.

Après revue : le délai serveur utilise désormais la même échéance absolue que
la tentative PKCE. Les clics répétés réutilisent la tentative encore valide sans
prolonger son délai ; après expiration, le prochain clic génère un nouveau state
et un nouveau verifier. Des tests à horloge contrôlée couvrent t=0, t=9 min,
l’expiration à t=10 min, le callback tardif à t=11 min et une reconnexion réussie.
