# Configurer la publication Discord

1. Ouvrir le [Discord Developer Portal](https://discord.com/developers/applications) et créer une application dédiée à StreamDashboard.
2. Dans **Bot**, créer le bot. Aucun user token ni webhook n’est nécessaire.
3. Dans **OAuth2 > URL Generator**, sélectionner `bot`, puis uniquement **View Channels**, **Send Messages** et **Attach Files**.
4. Ouvrir l’URL générée et inviter le bot sur le serveur voulu. Vérifier que les permissions du salon autorisent le bot.
5. Dans **Bot**, réinitialiser/copier le token. Le traiter comme un mot de passe : ne jamais le committer, le coller dans Android, un navigateur partagé ou un journal.
6. Sur le PC, ouvrir **Réglages > Discord**, coller le token dans le champ secret puis cliquer **Enregistrer/remplacer**. StreamDashboard le chiffre avec `safeStorage` et ne le réaffiche plus.
7. Cliquer **Tester/charger Discord**, choisir le serveur puis un salon texte et, facultativement, saisir le message par défaut.
8. Dans Planning, choisir Aujourd’hui, Cette semaine ou Semaine prochaine puis tester **PUBLIER SUR DISCORD**.
9. Sur Android appairé au PC, ouvrir Planning, choisir la même destination et publier. Le PC doit être connecté : aucun secret Discord n’est stocké sur le téléphone.

En développement serveur sans Electron, `DISCORD_BOT_TOKEN` peut être défini dans l’environnement. Ne jamais ajouter sa valeur à `.env.example` ou au dépôt.
