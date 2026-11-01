# Lot I — vague 3, aperçu du Deck contextuel monté

Base `81b8878`, branche `streamcockpit/3.0-lot-i`, seul worktree Lot I.
PLAN, CONTINUITY, matrice et rapports A–H lus avant modification.
F03/F07 restent PARTIAL ; G2 en cours, G3–G5 OPEN. La sélection contextuelle
opérationnelle et les commandes contextuelles ne sont **pas livrées**.

## Résultat et fichiers

- `apps/mobile/control/control.js` : import et montage dans Sons → Deck (également accessible depuis Accueil et Plus). Deux lignes ajoutées ; navigation, Live → Diffusion, DJI, Wizebot, Streamlabs et bandeau minuteur existants conservés.
- `apps/mobile/control/streamcockpit-context-preview.js` et `.d.ts` : aperçu en lecture seule, diagnostic UNKNOWN permanent, liste repliable des libellés configurés échappés et bornée à 512. Aucun identifiant de routage, événement de commande, horloge, stockage, réseau ni macro exécutée. La liste est explicitement une copie de configuration, sans état mesuré.
- `apps/mobile/control/streamcockpit-context-build.mjs` et `.d.mts` : compilation esbuild du moteur canonique du lot C en ESM navigateur, sans dépendance ajoutée. Écrit seulement l'artefact propriétaire ci-dessous.
- `apps/mobile/control/streamcockpit-context-core.js` : artefact généré, pas un second algorithme écrit à la main. Le test compare exactement le résultat de compilation à l'artefact livré ; régénérer si le core change. Aucun script partagé modifié.
- `tests/streamcockpit3-context-integration.test.ts` : neutralisation offline/reconnect, XSS, absence de commandes automatiques, montage, cinq onglets, accès services et affichage du minuteur maître.
- `tests/streamcockpit3-context-integration-browser.test.ts` : scénario opt-in 320 px, tactile, texte long, offline/reconnect, XSS et zéro requête ; lancement tenté mais bloqué, pas de preuve visuelle acquise.
- Ce rapport. Ticket préexistant `LOT_I_TICKET.md` laissé hors commit.

## Pourquoi l'aperçu reste neutralisé

Le contrat du core requiert scène, jeu, état stream, rôle et capacités. Le rapport E
et son adaptateur attestent l'absence de timestamp exploitable pour OBS ; une
lecture de réplique n'est pas une nouvelle observation. `installation-ui.js`
précise que la configuration locale ne certifie pas la connexion. Les droits de
routage existants ne constituent pas un snapshot commun de scopes Twitch, rôle
authentifié et provenance FIXE. Leur conversion en autorisation contextuelle
inventerait une preuve.

L'aperçu appelle donc réellement le moteur du lot C avec champs inconnus et
banque neutre vide, puis son renderer. Il n'utilise aucune fixture de jeu ou de
rôle Android. Même `online=true` signifie `network:unknown` pour ce contexte.
Aucune ancienne présentation verte n'est conservée. Le panneau permet de
consulter la configuration, **pas de sélectionner une banque en fonction du jeu**.
Les banques manuelles restent explicitement distinctes et suivent leur circuit
existant de permission/confirmation ; aucun nouveau bouton de commande ajouté.

À brancher ultérieurement : producteur authentifié FIXE avec observations datées,
révision et invalidation ; rôle et capacités/scopes validés côté autorité ;
configuration de règles liée aux vrais IDs ; adaptateur vers le core ; revalidation
au toucher et dispatch existant avec confirmation et reçu. Ne pas alimenter ce
contrat depuis les préférences locales ou la seule réussite d'une synchronisation.
Ces branchements impliquent des propriétaires serveur/Agent hors périmètre Lot I.

## Commandes et résultats

Toutes les compilations/tests ci-dessous exécutés avec `nice -n 15 ionice -c 3`,
au plus trois commandes de validation simultanées, aucun sous-agent.

| Commande (préfixe de priorité omis) | Code | Résultat |
|---|---:|---|
| `node apps/mobile/control/streamcockpit-context-build.mjs` | 0 | Artefact navigateur léger généré |
| `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-context-integration.test.ts tests/streamcockpit3-context.test.ts tests/mobile-panes-battery.test.ts tests/streamcockpit-timer-authority.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 1 | 52 PASS ; test timer bloqué par `listen EPERM 127.0.0.1` |
| `npm run build:types` (premier passage) | 2 | Déclarations nouvelles absentes et typage legacy ; corrigés avant reprise |
| `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-context-integration*.test.ts tests/streamcockpit3-context.test.ts tests/mobile-panes-battery.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 0 | 53 PASS, 1 navigateur opt-in ignoré |
| `npm run build:types` (final) | 0 | PASS |
| `npm run security:check` | 1 | IPC CLI tsx interdit, `listen EPERM /tmp/tsx-1000/27.pipe` |
| `node --import tsx scripts/security-check.ts` | 0 | Même script : PASS, 651 fichiers |
| Sonde `node --input-type=module` lançant `chromium.launch({headless:true})` | 1 | Chromium bloqué : `sandbox_host_linux.cc:41`, `Operation not permitted` |
| `CONTEXT_BROWSER_TEST=1 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-context-integration-browser.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 1 | Même blocage Chromium avant assertions ; aucune validation 320 px revendiquée |
| `node --check apps/mobile/control/control.js` | 0 | PASS |
| `node --check apps/mobile/control/streamcockpit-context-preview.js` | 0 | PASS |
| `git diff --check` | 0 | PASS |

Logs temporaires : `/tmp/lot-i-tests.log`, `/tmp/lot-i-tests-final.log`,
`/tmp/lot-i-types.log`, `/tmp/lot-i-types-final.log`, `/tmp/lot-i-security.log`,
`/tmp/lot-i-security-final.log`, `/tmp/lot-i-browser.log`.

Les tests de navigation et de montage sont structurels ; ils ne chargent pas
l'application complète dans Android. Les transitions réseau sont synthétiques.
Le minuteur existant n'est ni modifié ni dupliqué ; son test serveur n'a pas pu
écouter dans ce sandbox. Les largeurs et le tactile restent non validés.
Aucun build Windows/APK, installation npm, push, déploiement, secret consulté,
mutation OBS/Twitch ou installation utilisatrice modifiée. Matrice et CONTINUITY
inchangées. Aucune qualification fonctionnelle complète revendiquée.

## Commit bloqué par le sandbox

`git add` avec la liste explicite des neuf fichiers ci-dessus (sans ticket) :
**code 128**, avant staging. Preuve :

```
fatal: Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-I/index.lock': Read-only file system
```

Les métadonnées Git du worktree sont hors racine inscriptible. Aucun contournement,
changement de permissions, autre checkout ou demande d'élévation effectué.
**Aucun commit créé** ; les modifications restent dans le seul worktree Lot I,
à committer par l'intégrateur sur `streamcockpit/3.0-lot-i` après revue.
