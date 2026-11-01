# Le StreamCockpit — RC1 du 1 novembre 2026

## Identité de la candidate
- Version commune : `2.1.0-rc.1`, projet `StreamCockpit` (anciennes données StreamDashboard Next conservées).
- FIXE (PC stream) : hôte, OBS/Twitch, planning et minuteur maître ; ports `48133` local, `48136` distant TLS.
- Laptop (PC jeu) : client uniquement, runtime local `48134/48135` en loopback, aucune régie TLS distante et **aucune exécution locale de minuteur**.
- Android : `com.rastaaslan.streamdashboard.remote.next`, mise à jour de l'alpha.27 par même certificat de debug et versionCode supérieur.
- L'adresse utilisée dans le réseau observé est `https://192.168.1.15:48136`, avec association existante et empreinte TLS épinglée.

## Corrections finales
- Le client Windows sélectionne uniquement une régie OBS distante, activée et non locale, en HTTPS. Les commandes de minuteur ne sont plus déviées vers le runtime local en cas d'appairage absent, de TLS refusé ou de déconnexion.
- Le runtime backend du laptop refuse `timer.start`, `timer.pause`, `timer.reset`, `timer.add`, `session.prepare` et `timer.add` via macros : une seconde régie ne peut pas modifier son propre minuteur.
- Agent V2 OBS indépendant : authentification WebSocket locale, grant par capacité, identité mTLS du Controller épinglée, réservation durable des commandes, vérification de scène/stream après action, résultats incertains non rejoués automatiquement, refus de commandes simultanées.
- Agent V2 opt-in uniquement : écritures désactivées par défaut, mTLS et coffre DPAPI Windows exigés en mode monitor ; aucun listener public activé implicitement.
- Branding Le StreamCockpit, version RC1, migration sans perte d'identité ni remise à zéro des données.

## Validation
- Tests TypeScript/Node, navigateur et Android passés ; voir les logs de qualification conservés sur dam-server.
- Agent V2 **réel** sur FIXE : lecture OBS WebSocket authentifiée puis scène FIN → PAUSE → FIN, reçus confirmed, sans lancement de diffusion.
- RC1 Windows installée hors live sur FIXE/laptop et démarrée dans les rôles corrects ; interface TLS du fixe accessible sur LAN et Tailscale.
- Commande timer.start locale sur laptop explicitement refusée, minuteur local inchangé ; serveurs host/client indépendants testés.

## Périmètre de validation limité
- APK debug signée par la clé de debug historique ; **pas** de release Google Play ou APK signée avec une clé privée de distribution.
- La véritable application Android physique n'a pas été ouverte ni pilotée dans cette qualification.
- L'Agent V2 reste une capacité opt-in indépendante. Le pilotage courant Twitch/OBS par la régie Desktop existante reste disponible ; l'Agent V2 ne remplace pas automatiquement toutes ses commandes et intégrations.
- `StartStream` et `StopStream` de l'Agent V2 sont qualifiés sur simulateur et protégés par une confirmation, mais n'ont PAS été exécutés contre un direct Twitch public.
- La synchronisation visuelle du minuteur sur Android et les trois appareils en simultané reste à observer pendant l'essai réel de la candidate.
- Pas de signature Authenticode Windows ; vérifier les empreintes SHA256 avant extraction.

## Installation, contrôle, retour arrière
1. Sur FIXE et laptop, conserver le dossier actuel et sauvegarder `%APPDATA%\\StreamDashboard-Next` ; les sauvegardes RC1 avant test sont sur le Bureau `StreamCockpit-pre-RC1-20261101`.
2. Fermer seulement StreamDashboard/StreamCockpit, PAS OBS. Extraire le ZIP dans un dossier neuf identique sur les deux PC.
3. FIXE : `StreamDashboard.exe --role=host`. Laptop : `StreamDashboard.exe --role=client`. Ne jamais lancer `--role=host` sur le laptop.
4. Android : installer l'APK RC1 par-dessus la version Next alpha.27 sans désinstaller ; connexion à l'IP du FIXE et code d'association créé sur FIXE seulement si nécessaire.
5. En test, vérifier d'abord état OBS arrêté, scènes, micro, minuteur partagé, planification, retour de réseau, puis seulement tester un live public avec OBS comme secours.
6. Si anomalie bloquante : fermer la candidate sur les deux PC, restaurer les anciens dossiers EXE (en conservant une copie des données), relancer l'ancien hôte et l'ancien client ; ne jamais restaurer un backup de configuration par-dessus une application ouverte.

Aucun démarrage public de Twitch n'est nécessaire à cette qualification initiale. Le port TCP TLS 48136 du FIXE doit être accessible en LAN et la connexion doit conserver la vérification du certificat.
