# Smoke test Windows — actions de routine

Vérifier le pipeline complet après un redémarrage de DamPlanner : la cible doit toujours être affichée par son nom dans l’éditeur, sans chemin local visible dans le renderer.

## OPEN_APP

1. Ajouter une étape « Ouvrir une application » et sélectionner `notepad.exe` ou OBS.
2. Enregistrer, fermer puis relancer DamPlanner, rouvrir la routine et l’attacher à un LIVE.
3. Dans Cockpit, cliquer **▶ Ouvrir OBS** et vérifier que l’application démarre.

## OPEN_FILE

Sélectionner un fichier ou dossier, enregistrer et redémarrer. Depuis Cockpit, vérifier que l’Explorateur ouvre la cible. Une cible supprimée doit produire une erreur utilisateur.

## OPEN_URL

Configurer `https://example.com`, enregistrer, redémarrer puis vérifier que le navigateur s’ouvre depuis Cockpit. Vérifier que `file:`, `javascript:` et `data:` sont refusés.

## LOCAL_HTTP

Démarrer un serveur local, configurer `http://127.0.0.1:3000/prepare` en GET ou POST, puis vérifier que la requête est reçue. Vérifier qu’une URL externe et une redirection sont refusées.
