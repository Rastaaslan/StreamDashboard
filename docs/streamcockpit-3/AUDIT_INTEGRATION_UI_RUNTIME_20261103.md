# Le StreamCockpit 3.0 — audit intégration et interface, QA réelle, 03/11/2026

## Périmètre / méthode
- Lecture de PLAN, matrice, historique et commit canonique FIXE ; branche `streamcockpit/3.0-full-experience`, source `353a4c1`, arbre de travail initial propre.
- Relevés REST **en lecture seule** sur les instances QA réellement ouvertes : FIXE `127.0.0.1:48133` et laptop `127.0.0.1:48135` ; connexion et appareils appairés depuis FIXE. Aucun secret, jeton, ID personnel ni code d'association recopié dans ce rapport.
- UI : Chromium/Edge headless via le rendu web commun sur FIXE, dimensions 390×844 et 1366×900, cinq onglets Accueil/Live/Sons/Planning/Plus, navigation sans action de streaming. Captures locales conservées sous `out/sc3-audit-ui/` (non publiées). Pas d'inspection de l'écran physique Android ou de l'UI Electron réelle attachée ; la couche rendue est partagée mais pas tous les ponts natifs.
- Aucun démarrage/arrêt du direct, aucune commande OBS de mutation, aucune opération Google/Twitch d'écriture, aucun changement de profils ou de pare-feu.

## Synthèse factuelle
| Domaine | FIXE QA | Laptop QA | Lecture |
|---|---|---|---|
| OBS | connecté, 33.0.1, 9 scènes ; hors direct | non connecté, rôle client | propriétaire unique OBS conservé |
| Twitch | connecté | connecté localement | deux sessions/présentations différentes, pas de confirmation du routage d'autorité |
| Google Calendar | connecté, 5 calendriers, cible sélectionnée, zéro erreur OAuth | erreur `client_secret is missing` | connexion FIXE réparée, UX client trompeuse/non déléguée |
| Planning local | 0 événement, `lastSyncedAt` vide | 0 événement | absence de preuve d'import/rafraîchissement, pas de déduction sur le contenu réel du compte |
| Réseau | TLS LAN actif 48136, deux appareils appairés | runtime client en loopback 48135, `remote.enabled=false` local | association côté FIXE ne certifie pas encore qu'une commande client utilise FIXE |
| Contrôles de santé | dashboard/storage/OBS/Twitch/Google OK | dashboard/storage/Twitch OK ; OBS/Google KO | règles santé pas encore adaptées au rôle du client |

## Défauts / écarts priorisés

### P0 — À résoudre avant de qualifier un live en V3
1. **Réception multi-appareils non démontrée** : deux appairages côté FIXE (libellés génériques « Mon ordinateur » et « Mon téléphone »), mais aucun scénario réel de commande OBS/minuteur et reçu depuis laptop + Android n'a été prouvé au cours de l'audit. Les appareils peuvent apparaître appairés sans preuve de routage opérationnel. G3 reste ouvert.
2. **Livrables non alignés** : Windows QA déployé sur FIXE et laptop embarque `2591d88` ; source HEAD `353a4c1`, comprenant les fixes de deep links du build QA Android `7aa857a`. L'APK de Bureau vérifié avant ce correctif portait un ancien SHA ; un APK plus récent existe dans le répertoire de build. Interdire le mélange de builds comme candidate finale ; générer un lot Windows+Android depuis le même commit final, avec vérification de signature, appairage, migration et rollback.
3. **Mobile physique / signatures non réceptionnés** : Android QA debug signé par certificat Debug, aucun contrôle de l'installation, des intents QR, de la session ni de l'identité et des commandes sur le téléphone effectué durant cet audit. G4/G5 non qualifiés.

### P1 — Intégration et expérience en live
4. **Calendrier laptop en faux blocage** : l'instance client affiche `client_secret is missing` et le centre de santé Google en erreur, alors que la régie FIXE a Google connecté. Une copie cliente ne doit pas réclamer un second secret pour consulter le planning central. Afficher la provenance hôte, distinguer « compte Google local facultatif » de « calendrier de la régie ».
5. **Planning assisté sans observation distante** : panneau indique `Google / Twitch : UNKNOWN` par texte statique de `apps/mobile/control/streamcockpit-planning.js` ; pourtant le runtime FIXE a Google authentifié, cinq calendriers et une cible. Les deux caches ont zéro événement local, aucun `lastSyncedAt`. Séparer état du compte, dernier import réel et disponibilité. Ne jamais promettre que l'agenda contient des événements sans lecture vérifiée.
6. **Densité / chevauchement des blocs Twitch sur Desktop** : capture Edge à 1366 px `out/sc3-audit-ui/desktop-live.png` montre chevauchement visuel du chat, des permissions, AutoMod et champs d'entrée dans une colonne étroite. À corriger avec contraintes de largeur, grille, flux normal, hauteur minimale et tests 1366/1440 px ; vérifier également le rendu de l'application Electron.
7. **Live mobile priorise le chat avant les commandes** : capture 390 px `out/sc3-audit-ui/mobile-live.png` : le chat occupe presque toute la zone visible sous le minuteur ; opérations de régie séparées en sous-navigation et donc masquées. Prévoir résumé compact/collapsible du chat, commandes importantes visibles en premier, bandeau état et minuteur maître toujours accessible.
8. **Sessions Twitch locales distinctes** : Twitch `connected=true` sur les deux instances, sans preuve qu'une interaction ouverte depuis laptop sera routée vers l'unique propriétaire autorisé. Faire des tests de permissions et de doublons avec affichage explicite de l'exécuteur effectif (LOCAL / FIXE).

### P2 — Qualité UX / lisibilité
9. **Fenêtre « Mon installation » au premier chargement du navigateur** : aux résolutions 390×844, `#dialog` remplit 812 px avec contenu de 1311 px à faire défiler. Ce constat provient d'une session navigateur neuve, pas d'un redémarrage sur le Desktop appairé. Réduire la densité, scinder les sections et vérifier scroll, fermeture et focus.
10. **Planning : informations longues et boutons répétés** : captures desktop/mobile montrent trois lignes de suggestion de 60 min, dates longues incluant UTC+1 et bouton identique pour chaque proposition, poussant le calendrier réel plus bas. Utiliser cartes compactes, dates locales concises, un choix radio et une seule action de préparation ; conserver l'indication de source/non-publication.
11. **Identités d'appareils génériques** : deux appareils nommés « Mon ordinateur » / « Mon téléphone », et installation affichant « Mon ordinateur » ; distinguer FIXE, laptop et Android, marqueurs de connexion récents, rôle et propriétaire de l'autorité.
12. **Points d'accessibilité à approfondir** : mesure rapide de petits contrôles (liens 15 px ou boutons 30–34 px sur Desktop, quelques éléments Live mobile). La méthode DOM simple ne qualifie pas les noms accessibles des cases incluses dans `label` ; aucun échec WCAG n'est affirmé. Vérifier cibles tactiles, ordre de tabulation, lecteur d'écran et modales en tests dédiés.

## Contrôles positifs
- Les 5 onglets browser testés à 390 et 1366 px répondent HTTP 200, aucun `pageerror` JS détecté, pas de débordement horizontal `bodyWidth > viewport` sur ces écrans.
- FIXE OBS connecté au vrai port 4555 et Twitch/Google connectés ; accès distant HTTPS activé avec contrôle 401/403 non autorisé lors des essais antérieurs.
- Les campagnes sur le code précédent : Vitest 2363 PASS, Node 351 PASS, Playwright réseau 35 PASS, Electron 11 PASS, sous réserves d'artefact/commit et de tests ignorés ; ne pas transposer automatiquement ces résultats au HEAD 353a4c1.
- G0/G1 qualifiés historiquement, G2 in_progress et G3–G5 open : aucune nouvelle gate élevée par cet audit.

## Plan de correction court
A. Geler le périmètre et générer artefacts Windows x64 + APK QA sur un commit unique propre ; valider variantes Android et appairage manuel/QR sans perdre l'ancienne installation.
B. Qualifier depuis laptop puis Android le cycle appairage → lecture FIXE → commande OBS simulée/consentie hors live → reçu → déconnexion/reconnexion → horloge/autorité unique ; corriger la provenance des statuts client.
C. Réparer les vues Live Desktop/chat et Live mobile, puis planning assisté avec horodatage/fraîcheur réellement lus. Ajouter captures de régression aux tailles 390/768/1366/1920.
D. Revalider audio et VOD, Spotify/DJI mesurables, Streamlabs, Discord, modération et Google sur l'autorité réelle, puis seulement signatures, rollback et G4/G5.

**Limites** : audit en lecture seule, pas de capture du téléphone, aucun état de flux public manipulé, aucune preuve d'absence d'événements dans Google (seule la copie de planning est vide), et aucun contrôle complet du rendu Electron attaché sur le laptop.
