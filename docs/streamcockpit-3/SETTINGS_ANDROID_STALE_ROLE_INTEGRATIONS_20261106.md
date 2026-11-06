# SC3 Settings — état de services FIXE et rôle Android périmé (06/11/2026)

## Départ et propriété

- Développement exclusivement sur FIXE, `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`, branche `streamcockpit/3.0-full-experience`, base `15c7083`, origin `Rastaaslan/StreamDashboard`.
- PLAN, feature-matrix, CONTINUITY, MIGRATION_TO_FIXE lus avant intervention. Aucun index.lock, merge/rebase ou écrivain identifié sur les fichiers du lot. OBS présent : aucun accès/commande au live. Les cinq fichiers F05 + CONTINUITY étaient déjà modifiés par un autre propriétaire : conservés **hors index**.
- ClipForge avancé reste V4 selon PLAN ; F04 simple seulement pour V3.0. Cette passe constitue un seul correctif Settings/autorité, sans migration.

## Carte de propriété des paramètres (audit ciblé de la vue Settings)

| Parcours | Source et propriétaire | Effet et dépendances | Précaution |
| --- | --- | --- | --- |
| OBS, scènes, micro, minuteur et sécurité | `host.settings` / `host.state.obs` de FIXE | Config sur le seul agent OBS ; `settings-form`, lecture du timestamp et rôle de l'appareil | Android et laptop ne deviennent jamais régie OBS. Mot de passe vide = conserver, effacement explicite sur FIXE seulement. |
| Twitch / sorties / chat | `host.state.twitch`, `configuration.outputs.twitch`, compte local optionnel | Sortie OBS et capacités OAuth distinctes | Un indicateur de compte OAuth ou une UI joignable ne signifie pas diffusion prête. |
| Google Calendar / planning | Fournisseur local et, après appairage, planning maître FIXE | Actions Google locales ou déléguées suivant la destination | Ne pas dupliquer secrets OAuth ni propriétaires du planning. |
| Discord et WizeBot | `host.state.controlHub.integrations`, commandes FIXE | Administration distante, nécessite une destination FIXE joignable | Un rôle `stream` persisté sur Android ne constitue **jamais** une destination/régie. |
| Streamlabs / sons / automations | API et espace local ou FIXE selon le parcours | Actions propres à chaque service, non interchangeables avec WizeBot | Les boutons locaux existants sont préservés ; identifier leurs permissions serveur avant tout déplacement. |
| Appareils / réseau / Deck | Installation locale, appairages FIXE séparés, agent local optionnel | Association, rôles, copies de configuration | Modèle ≠ association réelle ≠ session connectée. Aucun reset ou nouvelle association automatique. |
| Apparence / profil / avancé | `localStorage` local, `host.settings` du workspace choisi | Onglets, veille, affichage et commandes protégées | Ne pas réécrire profils ni migration ; se référer à la rubrique et à sa portée. |

## Défaut reproduit, correction

- Sur un **Android natif non associé**, ancien `device.role='stream'` + `online=true` (la réponse de son runtime local), des statuts FIXE `CONNECTED` mémorisés étaient affichés comme vrais. Les boutons Discord/WizeBot étaient actifs, sans aucun endpoint FIXE sélectionné. L'interface annonçait « associez FIXE » sans bouton si rôle `stream` persisté.
- Reproduction avant correction : suite `streamcockpit3-settings-integrations-scope.test.ts` sur FIXE **8 PASS / 2 FAIL / 0 skipped**, dont le défaut reproduit sur vrai Edge 320 px. Log `%TEMP%\sc3-integrations-stale-native-RED-20261106.log`.
- Correction dans `apps/mobile/control/settings-view.js` : les statuts Twitch/ControlHub ne se disent plus confirmés sans endpoint FIXE ; les boutons d'administration Discord/WizeBot nécessitent `online` **et** un endpoint sélectionné. Android avec ancien rôle `stream` retrouve « Associer FIXE » sans pouvoir agir sur la régie. Google/Streamlabs locaux inchangés. Aucun secret, identité, permission serveur ou API modifié.
- Tests de régression ajoutés à `tests/streamcockpit3-settings-integrations-scope.test.ts` (DOM + vrai Edge 320 px avec réseau interdit). Après correction : 3 suites **22 PASS / 0 FAIL / 0 skipped**, dont **6 scénarios Edge réels** avec services synthétiques. Log `%TEMP%\sc3-settings-native-stale-green-20261106.log`.
- `npm run build:types`, `npm run check:browser-types`, `node --check`, `npm run security:check` et `git diff --check` : PASS sur l'arbre de travail ; contrôle de sécurité initial **6 774 fichiers**. Log `%TEMP%\sc3-settings-native-stale-static-20261106.log` (sortie PowerShell encodée imparfaitement, codes de sortie 0 confirmés).

## Limites et prochaine passe

- Test navigateur Microsoft Edge avec fixtures, **pas** Android physique ni vrai appairage, et pas de test de service Discord/WizeBot en production. Contrôle de destination et permissions côté serveur hors de ce lot ; aucune action publique OBS/Twitch/Discord.
- Reste à auditer les boutons « Streamlabs »/« Automatisations » depuis un Android autonome et les chemins de configuration du Desktop classique pour exclure d'autres états obsolètes ou doublons. Ne modifier qu'avec tests et propriétaire exclusif.
- **F00/F01 partial, G2 in_progress, G3/G4/G5 open** ; aucune RC, build de distribution, installation, signature ni publication. Rapport dédié au lieu de modifier `CONTINUITY.md` occupé par le lot F05.
