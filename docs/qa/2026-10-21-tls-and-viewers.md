# Transport chiffré et visionneuses Android — qualification intermédiaire

Cette preuve concerne une version de travail Next 2.1. Elle ne ferme aucune qualification universelle.

## Fonctionnement ajouté

- L’agent Windows garde son endpoint local et expose un endpoint HTTPS distinct, port 48136. Son certificat et sa clé sont chiffrés dans le coffre local. Son identité TLS reste commune aux rôles du même appareil.
- L’association transmet l’empreinte SHA-256 à vérifier depuis l’agent. Les contrôleurs Windows et Android vérifient cette empreinte avant tout identifiant ou code d’association. Les adresses HTTP distantes historiques restent conservées, mais ne reçoivent plus de secrets depuis le contrôleur commun 2.1.
- Windows isole les décisions TLS par agent. Android utilise un canal natif réservé à la fenêtre principale et à l’origine des ressources de l’application ; la vérification TLS reste propre à chaque connexion. Les règles de confiance des plateformes web ne changent pas.
- Les sons Android sont transférés par blocs de 64 Kio, avec plafond, suivi de position, consommation unique du fichier temporaire et nettoyage. Les requêtes annulées ou expirées ne sont pas répétées.
- Si le certificat est inaccessible ou le port HTTPS occupé, le partage distant est indisponible avec diagnostic ; les services locaux restent accessibles. Le renouvellement est explicite, compare l’identité précédente et vérifie la sécurité du redémarrage.
- Les lecteurs et chats web Android utilisent une activité distincte, sans pont natif de comptes ou de commandes. Le tableau de bord refuse les frames web. Vidéo, chat Twitch et chat YouTube coexistent dans l’activité de visionnage. Les cookies web restent propres à cet appareil ; les comptes API, Calendar et le navigateur externe restent distincts.

## Preuves automatisées ciblées

- `tests/peer-tls-server.test.ts` : HTTPS authentifié, refus d’une mauvaise empreinte avant consommation du code, association à usage unique, reconnexion après redémarrage, validité du certificat, maintien du local lorsque le port HTTPS est occupé.
- `tests/electron.smoke.spec.ts` : vrai moteur réseau Electron, mauvaise empreinte puis bonne empreinte puis changement, un seul identifiant reçu, absence de propagation de la confiance à une page web et conservation de l’empreinte au redémarrage. Le profil Linux de ce test utilise explicitement le backend de secrets de test pour ses seules valeurs synthétiques ; il ne qualifie pas le chiffrement Windows.
- `tests/node/peer-request.test.mjs` : refus HTTP avant envoi, normalisation, absence de répétition, corrélation des réponses Android, découpage et nettoyage du transfert audio.
- `PeerTlsPolicyTest` : véritable échange TLS sur JVM, aucun en-tête d’autorisation reçu avec la mauvaise empreinte, refus des adresses ambiguës et chemins hors API.
- `ViewerTargetsTest`, `tests/live-monitor-chat-ui.spec.ts`, `tests/installation-ui.spec.ts` : validation des cibles, absence de frames de plateforme dans le contrôleur Android, ouverture des deux chats et du lecteur indépendamment d’OBS.
- `tests/port-fallback.test.ts` : ports distincts, conservation des associations au redémarrage et maintien des services locaux lorsque le certificat est inaccessible.
- Les scénarios d’interface de macros, activité et espace autonome ont été adaptés au transport HTTPS natif simulé. Les essais TLS réels restent séparés de ces simulations.

## Preuve Windows et limites

La création du certificat par le moteur Windows et sa réimportation PFX en mémoire ont réussi sur FIXE après correction de la construction de la clé RSA : `2026-10-21-windows-certificate.json`. Aucun certificat racine, profil stable, processus OBS ou installation stable n’a été modifié.

L’association TLS a ensuite réussi dans les deux sens entre FIXE et Laptop-damien avec les vrais clients empaquetés, refus préalable d’une mauvaise empreinte, fermeture de fenêtre, interruption d’un agent puis redémarrage des deux candidats. Les empreintes, identités et associations sont conservées ; les lectures authentifiées reprennent. Les deux processus stables sont préservés et les ports temporaires libérés. Voir `2026-10-21-two-pc-tls.json`.

Restent à vérifier matériellement : association Android ↔ Windows, rotation réelle du certificat d’un agent, interruption d’un transfert audio, sessions web sur téléphone, veille/reprise et changement de réseau. Le test JVM Android et la compilation APK ne remplacent pas un essai sur téléphone.
