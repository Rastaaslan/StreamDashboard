# F04 — notifications OBS redondantes et epoch de replay (05/11/2026)

## Préflight et propriété
Exclusivement Remote Desktop Commander sur FIXE Windows 11 (device b5db7551-143d-410a-8b84-157070125122), après lecture de PLAN.md, feature-matrix.json, CONTINUITY.md et MIGRATION_TO_FIXE_20261101.md. Branche canonique `streamcockpit/3.0-full-experience`, remote `https://github.com/Rastaaslan/StreamDashboard.git`, HEAD de départ `cea7213` égal upstream. Aucun index.lock, rebase, merge ou verrou Flow. OBS présent comme processus sans aucune interaction, tests ciblés locaux uniquement. Les cinq fichiers déjà modifiés par le propriétaire F05 (`streamcockpit-mixer-control.js`, `streamcockpit-mixer-page.js`, `streamcockpit-mixer.js`, `tests/streamcockpit3-mixer-browser.test.ts`, `CONTINUITY.md`) sont préservés, jamais édités ni indexés. Des processus PowerShell de préflight d'un autre acteur étaient uniquement observés, pas interrompus. Aucune action sur RC2, F09-Q, laptop, Android, WorldPrep, World Director, Crafty ni installations.

## Défaut démontré
Dans `integrations/obs/src/client.ts`, chaque `StreamStateChanged` avançait `streamTransitionEpoch` et effaçait les autorisations de lecture privée de replay même si OBS répétait `outputActive: true` pendant la **même** diffusion. Cela rendait inutilisable une preuve `ReplayBufferSaved` déjà constatée, et risquait de réinitialiser à tort la déduplication de journal liée à l'epoch.

Test de régression ajouté à `tests/obs-runtime.test.ts` : sauvegarde d'un fichier synthétique sur un répertoire temporaire Windows, grant vérifié, deuxième notification active identique, puis véritable arrêt et notification d'arrêt identique. **RED : 0 PASS / 1 FAIL / 21 skipped** ; epoch passé de 1 à 2 sur notification active dupliquée, log `.git/sc3-f04-duplicate-streamstate-red-20261105.log`.

## Correction et qualification
L'epoch et les grants ne sont invalidés que si le stream devient connu après incertitude ou si `outputActive` change réellement. Une transition vrai arrêt continue à incrémenter l'epoch et à invalider l'ancien grant. Pas de commande SaveReplayBuffer ni d'appel OBS réel.

Campagne ciblée après correction, trois suites `obs-runtime`, `streamcockpit3-moments-obs-replay` et `streamcockpit3-clipforge-windows-replay-grant` : **42 PASS / 0 FAIL / 0 skipped**, log `.git/sc3-f04-obsepoch-targeted-20261105.log` ; inclut les grants Windows NTFS temporaires et le producteur de marqueurs. `npm run build:types` PASS, `npm run check:browser-types` PASS, `npm run security:check` PASS (**6 750 fichiers**), `git diff --check` PASS (seuls avertissements de conversion LF/CRLF sur fichiers F05 non édités). Logs `.git/sc3-f04-obsepoch-{types,browser,security}-20261105.log`. Ces résultats couvrent la source corrigée, pas les matériels ou une diffusion.

## État et suite
**F04 partial, G2 in_progress, G3–G5 open**. ClipForge avancé reste reporté à V4 selon PLAN. Événements simulés et fichiers synthétiques Windows ; réception vraie OBS, Android, laptop, reprise après crash/panne secteur et signature/repli production non qualifiés. Prochain pas : réception G3 des vrais replays/grants et clôture F05 par son propre propriétaire avant de promouvoir G2. La modification concurrente de `CONTINUITY.md` interdit d'y fusionner ce compte rendu sans réconciliation ; le présent rapport et la matrice font foi pour ce lot.
