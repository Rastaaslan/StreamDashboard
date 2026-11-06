# F02 — Décision AutoMod retenue, volontaire et non rejouable (06/11/2026)

## Résultat fonctionnel
- **Frontend partagé Desktop/Android** : lecture volontaire des retenues EventSub observées par FIXE ; choix **Autoriser/Refuser** sur un message réellement observé, prévisualisation OAuth/identité en lecture seule, puis case et second clic explicite.
- **Backend autoritaire FIXE** : endpoints `POST /api/v1/twitch/advanced/moderation/held-action/{preview,confirm}` ; appareil appairé `chat+cloud`, acteur et hôte revalidés, message+viewer+chaîne prouvés par le cache EventSub frais, confirmation UUID à usage unique (30 s). Aucun ordre sur un message deviné ou après sa mise à jour AutoMod.
- **Fournisseur** : validation du jeton propriétaire et scope `moderator:manage:automod` avant l'envoi ; Helix `POST /moderation/automod/message` avec identifiant exact et `ALLOW` ou `DENY`, sans rafraîchissement ni retry automatiques. Les secrets ne sortent pas du FIXE. Une HTTP 204 signifie **demande transmise, décision non relue** ; une réponse perdue/indéterminée reste **incertaine**.
- **Anti-rejeu** : UUID de consentement consommé, message bloqué après tentative dans le processus FIXE même en cas de perte de réponse. Cache borné et fail-closed ; aucune éviction silencieuse des tentatives. Après redémarrage, seules de nouvelles retenues EventSub permettent un nouveau parcours. Ce cache n'est **pas** un journal durable G4.
- **Sécurité UX** : perte de réseau, changement d'identité, onglet masqué ou réponse tardive invalidant le consentement ; aucun POST automatique ; vérification Twitch volontaire avant de reprendre.

## Qualification source (FIXE uniquement)
- Base initiale de préflight `2526a92`, branche `streamcockpit/3.0-full-experience`, origin GitHub conforme et synchronisé, aucun lock Git/rebase/merge.
- Préflight `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` et audit G2 réalisés avant écriture.
- **9 suites ciblées, 38 PASS / 0 FAIL / 0 skipped** après correction du harnais de test HTTP GET et du sélecteur Playwright masqué, dont **4 scénarios vrais Microsoft Edge 320 px** (2 nouveaux, 2 existants) ; providers et événements OBS/Twitch **simulés**. Aucun POST public réel. Les échecs de harnais intermédiaires n'ont pas été déclarés PASS.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 781 fichiers**, avant ajout du présent rapport) ; `git diff --check` PASS (avertissements CRLF sans erreur).
- OBS de production, StreamDashboard installé, laptop, Android, RC2, WorldPrep, Director, Crafty, secrets et installations **non modifiés** ; F05/mixeur et `CONTINUITY.md` concurrentiels préservés. Aucun build de distribution ni publication.

## Limites et suite
- L'API Helix n'expose pas une lecture unitaire du résultat d'une décision AutoMod. Il faut constater l'événement de mise à jour EventSub ou vérifier dans Twitch ; ne jamais annoncer `approved` après une simple HTTP 204.
- Les messages antérieurs à la connexion EventSub et les messages déjà expirés ne sont pas traitables par ce parcours. La preuve OAuth/permissions est validée **seulement avec transport simulé** ; pas de réception sur compte réel, Android WebView ou trio physique.
- Le contrôle du passage à l'acte et la mémoire anti-rejeu ne sont pas durables au redémarrage ; journal de tentatives durables et preuve de réconciliation multi-processus restent une priorité, ainsi que le flux réel Twitch.
- **F02 reste partial**, G2 `in_progress`, G3–G5 `open`. Ce lot réduit un manque de F02 mais ne clôt ni G2 ni la release.
