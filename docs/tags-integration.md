# Intégration du moteur de tags

Le serveur utilise `TwitchTagIntelligence`, un scoring local déterministe enrichi
par le mining Twitch v2. Aucun service ML ni nouvelle API externe. L’adaptateur
`localTagEngine` et l’injection `DashboardServerOptions.tagEngine` restent disponibles.

La pertinence est une condition préalable au classement : catégorie, historique
validé du même `game_id`, série/format, puis titre/description. La fréquence Twitch
ne confirme jamais seule un tag. Elle apporte au maximum quatre points aux tags
confirmés localement. Les recommandations ont un seuil de 65, une limite de dix,
et aucun remplissage. Les tags inconnus (communauté, serveur, persona, autre jeu)
restent observés sans signal local, quelle que soit leur popularité. Les singletons
sont pénalisés ; l’audience a un poids borné. Aucune blacklist de jeux/personas.

Les règles positives reconnaissent les formats explicites (Spooktober → Halloween
et Horror ; AllTheMods/modpack → Modded), ainsi que les genres mentionnés dans le
texte. La petite taxonomie de catégorie Dead Island fournit Horror/Zombie/Action.
Coop, Survival et Adventure ne sont pas supposés à partir du seul mining.
Les langues sont normalisées (Français/French/fr → French, Español → Spanish,
Русский → Russian). Seules les préférences explicites utilisateur/chaîne autorisent
une langue automatique ; les autres restent des observations.

`POST /api/v1/planning/tags/regenerate` reçoit titre, description, catégorie,
préférences et tags courants. Il renvoie `{ tags, recommended, observedSuggestions }`
avec éventuellement `warning`. `tags.values` contient uniquement `recommended` ;
chaque observation séparée porte `{ tag, score, sources }`. Le champ reste éditable.
Les boutons d’observation permettent d’ajouter ou d’écarter explicitement un tag.
Régénérer met à jour les deux ensembles sans sauvegarde implicite.

Les événements conservent `tags: { values, source, generatedAt?, validated?,
acceptedValues?, rejectedValues? }`. Enregistrer depuis le formulaire valide les choix conservés ;
les suppressions et observations écartées deviennent des rejets. Les clients API
peuvent envoyer des choix `manual`, `validated: true`, ou `rejectedValues` ; une
modification de tags existants enregistre aussi les suppressions côté serveur.
Ces données suivent la persistance locale des événements et s’appliquent au même
jeu ou à la même série, jamais depuis les exceptions d’occurrence. Un rejet retire
60 points aux recommandations et 25 aux observations. Réaccepter un tag dans le
même enregistrement retire son rejet ; une préférence explicite peut aussi le
réautoriser. Le brouillon remplace sa version sauvegardée du même événement dans
le scoring, sans effacer les corrections des autres événements. Régénérer ne valide
pas les tags automatiques simplement présents : leur provenance est conservée et
seuls les ajouts explicites sont transmis dans `acceptedValues`. Les autres anciens
tags générés non validés ne servent pas d’apprentissage.

Le preflight utilise seulement les choix manuels/validés ou les recommandations.
Il recalcule les anciens tags générés non validés. Vider explicitement un ensemble
conserve ce choix ; un nouveau formulaire vide permet toujours la génération.
Un résultat de qualité vide est valide. Sur erreur/timeout, seuls les choix validés
peuvent servir de repli, jamais les observations. Le délai maximal de l’adaptateur
reste 1,5 seconde ; le cache stale-while-revalidate (200 jeux, TTL six heures,
100 chaînes, timeout 800 ms) reste compatible et la génération n’attend pas Twitch.

Fixtures françaises avec observations fréquentes :

- Dead Island 2 / Spooktober : `DeadIsland2, Action, Horror, Zombie, Halloween, French`.
- Minecraft / AllTheMods 10 To the sky : `Minecraft, French, Modded`.

Les tags automatiques sont transmis avec titre/catégorie à Helix. Un refus des tags
conserve le repli titre/catégorie et `tagsWarning`. Google et Twitch Schedule ne
sont pas modifiés.

## Intégration CB-118 sur CB-114 rolling

Base exacte : `830084e9ff7f660a2336d581aae18d37ff384bf7`.
Diff cumulé CB-117 jusqu'à `e3b64dd0905a9ff7fca1caf72bdfb7e48a37f8a7`
(incluant `45f157b`) intégré ; le contrat conserve les identités de projection,
les règles V2 et les exceptions rolling de CB-114.

Une édition des seuls tags rafraîchit aussi l'instantané local des occurrences
matérialisées déjà synchronisées, sans modifier le contenu du calendrier distant.
Les nouvelles occurrences héritent des choix corrigés. Les tests croisés des deux
fixtures couvrent la régénération des anciens tags sur occurrence projetée, la
validation, l'édition, la persistance, le retry, le déplacement de fenêtre, le
preflight et la protection contre la suppression en masse d'une série.

Validation locale CB-118 (Node 24.21.0) :

- `npm test` : 934 tests Vitest et 141 tests Node réussis.
- Tests ciblés tags / rolling / retry / bulk delete : 59 réussis.
- `npm run test:browser` : 13 réussis.
- `npm run mobile:smoke` et `npm run smoke` sur serveur temporaire : réussis.
- `npm run build`, `npm run security:check`, `npm run check:shipped-js` : réussis.
- `npm audit` et `npm audit --omit=dev` : aucune vulnérabilité.
- `npm run desktop:package` : package Windows x64 et contrôle ASAR réussis.
- `npm run desktop:smoke` : 4 scénarios bloqués au lancement Electron par
  l'absence de serveur X / DISPLAY ; résiduel explicitement autorisé au ticket.

Dans le sandbox, utiliser `TMPDIR=/var/lib/codexbridge/.npm/cb118-tmp`,
`PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright` et
`electron_config_cache=/var/lib/codexbridge/.npm/electron` pour placer les caches
et fichiers temporaires dans les répertoires accessibles. Les premières tentatives
sans ces réglages ont échoué sur les accès temporaires ou les binaires manquants ;
elles ont été relancées après préparation des dépendances. L'import JSON ajouté
au test croisé a également été corrigé pour la compilation NodeNext.

### Revue CB-118 — identité du brouillon de série

La régénération depuis une occurrence projetée utilise maintenant l'identité de
la portée sélectionnée : ID du maître en « Toute la série », ID et clé
canonique de l'occurrence en portée occurrence. L'API transmet cette clé au
moteur pour conserver l'isolation de l'apprentissage des occurrences.

`tests/cb118-series-tags.test.ts` exécute les handlers réels de population,
changement de portée, régénération et sauvegarde contre le serveur. Il vérifie
qu'un rejet Coop du maître est remplacé par sa réacceptation dans le brouillon,
que Coop atteint le preflight projeté après sauvegarde, que les choix/rejets
d'un autre événement restent actifs, et qu'un brouillon d'occurrence ne devient
pas un apprentissage de série.

Gates relancés après correction avec les chemins de cache ci-dessus :
`npm test` (935 Vitest + 141 Node), `npm run test:browser` (13),
`npm run mobile:smoke`, `npm run smoke` sur serveur temporaire,
`npm run build` (également exécuté par les suites et le packaging),
`npm run security:check`, `npm run check:shipped-js`, `npm audit`,
`npm audit --omit=dev` (0 vulnérabilité), `npm run desktop:package`
(contrôle ASAR inclus) : réussis. Tests ciblés tags : 13 réussis.
`npm run desktop:smoke` relancé : les 4 scénarios restent bloqués au lancement
par l'absence de serveur X / DISPLAY, résiduel autorisé inchangé.
