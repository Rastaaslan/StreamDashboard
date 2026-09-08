# Architecture

`renderer` ne connaît que l'API étroite du preload. `main/ipc` valide chaque entrée Zod avant d'appeler le domaine. `services/events` orchestre repository, disponibilité puis synchronisation. `services/sync` traite Google et Twitch séparément. `providers` contient les contrats et doubles ; `oauth` contient le coffre sécurisé ; `persistence` contient le schéma Drizzle et les migrations automatiques.

Le bootstrap normal instancie `GoogleCalendarProvider` et `TwitchScheduleProvider`. Les doubles ne sont injectés en production que si le développeur définit explicitement `DAMPLANNER_MOCK_PROVIDERS=1`. L'absence de configuration reste visible et produit une vérification `INCOMPLETE`, sans fallback silencieux.

Les instants sont des ISO UTC, accompagnés du fuseau IANA. La formule de conflit est strictement `start < candidate.end && end > candidate.start`. Les identités `damplannerEventId` permettent la déduplication. Google utilise un ID `dp` + UUID sans tirets. Une création Twitch incertaine est d'abord réconciliée par horaire, titre et catégorie.

## Sécurité

La fenêtre active `contextIsolation`, `sandbox`, et désactive `nodeIntegration`. Les navigations et nouvelles fenêtres sont bloquées ; l'ouverture externe passe par une allowlist IPC. Les tokens ne franchissent pas IPC. `safeStorage` chiffre les fichiers avec le magasin OS ; l'application échoue explicitement si ce chiffrement est indisponible. La couche HTTP limite à un seul replay après refresh sur 401 et transforme un refresh révoqué en `REAUTH_REQUIRED`.
