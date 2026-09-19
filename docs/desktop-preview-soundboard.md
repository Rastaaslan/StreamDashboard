# Desktop Preview V2 et Soundboard OBS

Le Desktop de production reste la vue par défaut. La Preview isolée se lance avec
`npm run desktop:preview` et porte explicitement le titre **StreamDashboard Desktop Preview**.
Elle démarre en mode Démo : les commandes sont journalisées localement mais ne sont
pas envoyées. Le bouton **Démo** active volontairement le mode Runtime.

## Routage Soundboard

La lecture normale suit `Desktop/Android → Runtime → OBS WebSocket → StreamDashboard • Soundboard → mix OBS`.
Il n'existe aucun repli silencieux vers la sortie Windows. La source OBS doit être une
Media Source nommée `StreamDashboard • Soundboard`. Le mode **Stream uniquement**
désactive le monitoring ; **Stream + casque** utilise `Monitor and Output`. Le périphérique
de monitoring global reste un réglage explicite dans OBS.

## Validation matérielle avant promotion

1. Ouvrir OBS et vérifier la Media Source dédiée.
2. Enregistrer dans OBS, jouer BONK depuis la Preview puis CREEPER depuis Android.
3. Vérifier le fichier enregistré avec monitoring désactivé puis avec Monitor and Output.
4. Modifier le volume, enchaîner deux sons, puis utiliser Stop.
5. Déconnecter OBS WebSocket : vérifier `OBS_UNAVAILABLE` et l'absence de lecture Windows.
6. Reconnecter OBS et rejouer sans redémarrer StreamDashboard.

La Preview ne doit pas devenir l'interface principale sans validation visuelle explicite.
