# Desktop Preview V2 et Soundboard OBS

Le Desktop de production reste la vue par défaut. La Preview isolée se lance avec
`npm run desktop:preview` et porte explicitement le titre **StreamDashboard Desktop Preview**.
Elle démarre en mode Démo : les commandes sont journalisées localement mais ne sont
pas envoyées. Le bouton **Démo** active volontairement le mode Runtime.

## Bibliothèque Soundboard

Depuis **Sons**, la Preview peut ajouter, modifier et supprimer les sons en mode Runtime.
Le sélecteur Electron expose uniquement `selectSoundFile()` et `importSoundFile()`.
Le fichier choisi est copié avec un nom UUID dans `<userData>/soundboard`; le renderer ne
reçoit ensuite qu'un `libraryId`. Les snapshots Remote ne contiennent jamais le chemin source.

Chaque son conserve : nom, catégorie, volume, cooldown, favori, activation et mode d'écoute
`stream` ou `monitor`.

## Routage Soundboard OBS

La lecture normale suit `Desktop/Android → Runtime → OBS WebSocket → StreamDashboard • Soundboard → mix OBS`.
Il n'existe aucun repli silencieux vers la sortie Windows.

Le bouton **Configurer dans OBS** ouvre un assistant avant toute mutation. Il vérifie la Media
Source `StreamDashboard • Soundboard`, les scènes configurées dans StreamDashboard et les
raccordements déjà présents. **Configurer / réparer** crée uniquement ce qui manque. Une seconde
exécution ne duplique ni la source ni les Scene Items.

Le mode **Stream uniquement** désactive le monitoring ; **Stream + casque** utilise
`Monitor and Output`. Le périphérique de monitoring global reste un réglage explicite dans OBS.

## Validation matérielle avant promotion

1. Ouvrir OBS et lancer l'assistant Soundboard depuis la Preview.
2. Le relancer une seconde fois et vérifier qu'aucun doublon n'est créé.
3. Enregistrer dans OBS, jouer BONK depuis la Preview puis CREEPER depuis Android.
4. Vérifier le fichier enregistré avec monitoring désactivé puis avec Monitor and Output.
5. Modifier le volume, enchaîner deux sons, puis utiliser Stop.
6. Déconnecter OBS WebSocket : vérifier `OBS_UNAVAILABLE` et l'absence de lecture Windows.
7. Reconnecter OBS et rejouer sans redémarrer StreamDashboard.

La Preview ne doit pas devenir l'interface principale sans validation visuelle explicite.
