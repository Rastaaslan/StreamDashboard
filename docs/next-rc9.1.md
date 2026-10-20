# StreamDashboard Next — RC9.1

Correctif de compatibilité pour l’erreur `crypto.randomUUID is not a function`.

Le planning partagé, les identifiants du stockage local et les échanges asynchrones Android utilisent désormais un même générateur UUID v4. Il conserve `crypto.randomUUID` quand disponible et utilise les octets de `crypto.getRandomValues` autrement, notamment dans les environnements HTTP locaux qui ne proposent pas la première fonction. Aucun identifiant existant n’est modifié et aucune donnée n’est effacée.

Installer l’APK par-dessus Next, sans désinstaller. Sur Windows, conserver la distribution précédente et extraire la nouvelle archive dans un autre dossier. Les usages et limites de la RC9 restent décrits dans [next-rc9.md](next-rc9.md).

Vérifications ciblées : planning autonome, récurrences et exceptions sans `randomUUID` ; retour asynchrone Android avec réponses reçues dans l’ordre inverse ; générateur natif et repli cryptographique. Le parcours navigateur autonome désactive également `randomUUID` avant le chargement de l’application.
