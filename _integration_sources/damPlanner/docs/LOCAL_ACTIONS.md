# Actions locales et sécurité

Le renderer ne reçoit aucune primitive Node et ne transmet à l'exécution qu'un UUID. Le main
charge la cible persistée et validée par Zod.

Pour `OPEN_APP` et `OPEN_FILE`, le renderer ne peut pas fournir ni persister un chemin : il
demande uniquement un nom et un type, puis le **main process ouvre le dialogue natif**, génère
l'UUID et enregistre lui-même le chemin choisi. `OPEN_APP` utilise ensuite
`spawn(path, [], {shell:false})` : aucune commande, argument ou shell libre n'est accepté.
`OPEN_FILE` passe par `shell.openPath`.

Les seules cibles dont les paramètres peuvent être saisis depuis l'interface sont les cibles
réseau typées et validées : `OPEN_URL` accepte exclusivement HTTP(S), et `LOCAL_HTTP` accepte
seulement `localhost`, `127.0.0.1` ou `::1`, avec méthode GET/POST, timeout de trois secondes
et redirections interdites.

Ne jamais stocker de jeton ou secret dans une cible locale.
