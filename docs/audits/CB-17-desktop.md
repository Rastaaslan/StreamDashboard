# CB-17 — Audit Desktop

Portée : Desktop V2 (`/preview/?runtime=1`, interface par défaut), sans changement de navigation. Le bouton décoratif inactif du Desktop historique est également désactivé et expliqué.

## Corrections et contrôles

- Planning et live : réutilisation des miniatures mobiles (CDN autorisés, cache borné, placeholder, timeout et retry explicite). Le bouton de retry reste séparé du bouton d’événement. Les médias OBS exposent des noms de sources, sans URL de miniature : aucune image distante inventée.
- Live : le timer met seulement son texte à jour ; les événements WebSocket actualisent messages, viewers, participants/rôles et statuts dans des régions indépendantes des contrôles. Le focus, la sélection du texte et les brouillons sont préservés ; un rendu différé rattrape les changements structurels à la sortie du focus. La liste des participants n’est plus limitée silencieusement à 100 ; les rôles restent lisibles et la distinction participants/viewers est explicite.
- Connexions/actions : raisons visibles et reliées par `aria-describedby`, guards OBS/Twitch/Google/Discord/Streamlabs/WizeBot, attente de requête explicite et timeout de 30 secondes. Lancement OBS réservé au bridge Desktop ; les autorisations web ouvrent leur URL.
- Google : synchronisation réservée au calendrier cible accessible en écriture ; une sélection vide ou échouée ne simule plus une modification enregistrée.
- Discord : choix du serveur efface immédiatement l’ancien salon ; réponses arrivées en retard ignorées ; sauvegarde impossible sans destination valide.
- Streamlabs : distinction explicite entre simulation interne et test réel Alert Box/Socket ; test réel conditionné par OAuth et Socket connecté.
- Application : colonnes flexibles, textes longs contenus, sidebar défilante et focus visible étendu aux listes et résumés. Le raccourci micro ne coupe plus arbitrairement la première entrée audio si aucun micro principal n’est configuré.

## Validation reproductible

- `npm test` : suite Vitest.
- `npm run build` : TypeScript et copie des modules runtime.
- `npm run check:shipped-js` : syntaxe des scripts livrés.
- `node --test tests/thumbnails.node.test.mjs` : cache, expirations, fallback, retry, échec réseau/timeout et export avec/sans image.
- `node --test tests/desktop-audit.node.test.mjs` : Chromium installé via Playwright requis. Sert uniquement les fichiers UI locaux et intercepte les fournisseurs : six événements `state.updated` reçus via un serveur WebSocket local pendant le focus Audience et la saisie du chat (dont une déconnexion), brouillon/focus/sélection du texte, 125 chatters, raisons des guards, retry réel dans le DOM, concurrence Discord, erreurs OBS et boutons sans handler dans les vues examinées. Overflow contrôlé à 900/1100 px.

Aucun appel à un fournisseur réel ni diffusion/publication effectuée. Le test Chromium couvre le rendu web du Desktop ; le lancement natif Windows/Electron et les autorisations de comptes réels ne sont pas exécutés dans cet environnement Linux.

## Révision 2 — Connexions pendant les interactions

Les événements `state.updated` mettent à jour les cartes de connexion et les actions d’autorisation directement, même si un bouton ou un champ garde le focus. Les champs de credentials et les sélecteurs de destination ne sont pas remplacés. Les états du snapshot courant priment sur la projection `/connections` plus ancienne ; les messages obsolètes sont retirés. Les actions Google/Twitch basculent entre connecter et déconnecter sur le même bouton.

Le test Chromium ajoute six événements WebSocket dans Application → Connexions : trois avec le bouton d’autorisation Google focalisé, puis trois dans le champ du message Discord. Il vérifie les transitions des six services, les guards, l’action d’autorisation, le focus, les brouillons et la conservation du calendrier, serveur et salon sélectionnés.

## Révision 3 — Retour OAuth Streamlabs

Dans Connexions et Soutiens, les événements WebSocket et le retour du focus dans la fenêtre déclenchent une relecture de `/api/v1/supports/streamlabs/oauth/status`. Les demandes rapprochées sont regroupées et une mise à jour reçue pendant une requête déclenche une relecture suivante. Seule la réponse OAuth autorise le test réel : un Socket connecté avec un token manuel ne suffit pas. Les guards sont actualisés sans rendu des formulaires ; une erreur de lecture bloque le test réel avec une raison explicite.

Le test Chromium simule un token manuel connecté, puis le démarrage et le callback OAuth réussi avec un événement `state.updated` (Socket déjà connecté). Il vérifie que le test réel devient disponible sans navigation, en conservant le focus, les brouillons et les destinations. Il couvre également l’échec temporaire de lecture du statut OAuth et sa récupération.
