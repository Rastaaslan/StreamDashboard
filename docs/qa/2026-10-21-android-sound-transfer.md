# Transfert des fichiers audio vers Android

Le même import de sons fonctionne sur les agents Windows et Android. Avant l’envoi, le contrôleur vérifie l’identité physique de la destination associée. Le transport Android utilise le canal HTTPS à empreinte vérifiée existant et l’autorisation de configuration de l’appareil ; aucun fichier n’est envoyé à une autre origine et aucune lecture n’est déclenchée.

Le protocole Android transfère des blocs de 64 Kio dans les requêtes JSON bornées du serveur natif. Un transfert interrompu reprend à son dernier bloc confirmé lors d’une nouvelle tentative explicite avec le même fichier. Les blocs restent dans IndexedDB après fermeture. L’empreinte SHA-256 du fichier complet est vérifiée avant une transaction unique publiant le fichier, son identité, le catalogue et le reçu. Les fichiers incomplets ne sont pas proposés à la lecture. Les contenus concurrents ne sont pas remplacés.

Les transferts sont attachés à l’appareil associé et à l’espace de destination. Les permissions sont revérifiées avant publication. Quatre transferts incomplets au maximum sont conservés ; leur expiration est d’une heure. Le plafond par fichier reste 100 Mio. Les fichiers et reçus ne contiennent aucun jeton d’association. Le transfert des créations locales conserve l’identité du son.

Validation sur profil isolé dam-server : compilation, neuf tests Node (empreintes binaires et exécuteur), cinq tests navigateur utilisant véritable IndexedDB. Ils couvrent reprise après réouverture, blocs répétés, réponse perdue, empreinte incorrecte, ordre incorrect, propriétaire différent, retrait de permission, conflit concurrent et publication atomique. Le test de parcours traverse l’uploader commun, l’association et le récepteur Android JavaScript sans produire de son.

Le transport TLS natif Android et l’import sur téléphone réel restent à qualifier matériellement. Ces essais automatisés ne ferment aucune cellule matérielle de la matrice universelle.
