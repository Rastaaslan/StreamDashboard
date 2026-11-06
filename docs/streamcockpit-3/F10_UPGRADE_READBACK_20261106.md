# F10 — Relecture indépendante après installation ou rollback incertains

**06/11/2026 — FIXE Windows 11, RDC uniquement.** Branche canonique, départ `fd88e6599102a99e60bb25a4dba83945547418b2`. Lot autonome « readback » ; aucune modification F05/mixeur, Settings, CONTINUITY, OBS, Twitch, installation ni profil utilisateur.

## Lacune traitée et parcours vérifié

Le journal SQLite et son verrou interprocessus existent, mais, après une perte d'accusé de réception d'installation ou de rollback, une simple déclaration d'adaptateur ne suffit pas à confirmer ce qui est réellement sur disque. `createUpgradeReadbackReconciler` fournit à l'adaptateur d'effet un **lecteur strictement passif** : inventaire exhaustif de deux racines explicitement fournies (image applicative et données), tailles et SHA-256 de tous les fichiers, absence d'ajouts, relectures métadonnées avant/après, refus de liens/situations inconnues. Il compare avec deux inventaires de confiance *pré-épinglés indépendamment*, et exige deux observations fraîches de l'identité/version/signataire du programme par un **attesteur OS indépendant**.

Le lecteur ne confirme **que** l'opération `install` ou `rollback` correspondant à la clé pendante. `stage`, `backup`, `migrate`, identité absente, signature divergente, fichiers manquants/altérés/ajoutés, erreur ou données incomplètes : retour `undefined`, **aucun nouvel effet**. Les références de récupération sont des empreintes, non des données de compte ou chemins utilisateurs. Aucune lecture d'identité depuis un simple JSON fourni avec l'application ne vaut attestation.

Un scénario intégré réalise de **vraies écritures de fichiers synthétiques** dans un répertoire temporaire Windows, perd volontairement l'ACK de l'installation, récupère l'effet via le journal SQLite du planificateur sans relancer `install`, puis répète le cycle pour le rollback. Un autre laisse un profil partiellement modifié et prouve que le journal demeure `pending` sans réessai. La vérification du signataire reste **simulée dans ces tests** : aucune signature de production n'est attestée.

## Régressions et limites de livraison

- RED : **1 suite non chargée / 0 test exécuté** (module encore absent), log `.git/sc3-f10-readback-red.log`.
- GREEN final : **13 suites / 162 PASS / 0 FAIL / 0 skipped**, dont **6 nouveaux tests** F10 : récupération installation+rollback, rejet d'altérations, inventaire exact, absence de preuve d'identité et opérations incertaines. Log `.git/sc3-f10-readback-final-tests.log`.
- `npm run build:types`, `npm run check:browser-types`, `npm run security:check` (**6 804 fichiers**) et `git diff --check` : **PASS**, exit 0. Pas de parcours navigateur requis (module Windows sans UI) ; fournisseurs externes et tests physiques **non exécutés**.

**Séparation essentielle :** ce module de relecture peut être fourni au `createDurableDesktopUpgradePlanner`, et le contrat est testé avec lui ; il n'est **pas activé** dans `startUpdater`. L'attestation Windows/Android réellement signée, la preuve d'inventaires de sauvegarde indépendamment épinglés, les adaptateurs Squirrel/Android, la suspension de tous les writers, l'installation sur appareil et les essais de coupure électrique restent manquants. G2 `in_progress`, F10 `partial`, G3-G5 `open`. Aucun produit installé modifié, aucun packaging, aucune candidate promue.

**Prochaine action de convergence :** raccordement de l'authenticité de release et des adaptateurs d'installation/récupération à ce lecteur, sous exclusion globale des writers, avec tests hors installations ; réception réelle du trio et des signatures ensuite sous accord de l'opérateur.
