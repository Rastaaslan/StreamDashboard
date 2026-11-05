# F05 — revue contradictoire de la reprise du mixeur après coupure (05/11/2026)

## Portée / propriétaire
Exclusivement FIXE Windows 11 via Remote Desktop Commander, dépôt canonique `streamcockpit/3.0-full-experience` au HEAD initial `81d6179`, origin GitHub conforme, index Git sans verrou. Les quatre fichiers F05 non committés (`streamcockpit-mixer-control.js`, `streamcockpit-mixer-page.js`, `streamcockpit-mixer.js` et `streamcockpit3-mixer-browser.test.ts`) ainsi que `CONTINUITY.md` appartiennent à un propriétaire distinct : **pas de modification ni indexation** de ces fichiers. Aucun accès à une autre machine/projet, à OBS réel, aux installations ni à un fournisseur Twitch.

## Traitement : vérification indépendante de la correction F05 en cours
Le patch non committé ajoute des gardes sur `offline`/`online`, l'invalidation de la table, un `verifiedOnline` et une nouvelle vérification navigateur. Ces modifications sont positives mais **ne corrigent pas le chemin asynchrone en cours de lecture de routage** : dans `streamcockpit-mixer-page.js`, le `finally` du clic « Lire les pistes OBS » effectue encore :

```js
inspecting = false;
if (available) button.disabled = !select.options?.length;
```

Ici, `available` reste `true` lors de l'événement réseau `offline`; même si `inspection` a été invalidée et `linkInterrupted=true`, le `finally` redonne l'accès au bouton. C'est une violation observable de l'état fail-closed, sans écriture OBS dans le scénario.

Preuve reproduite sur le **patch F05 courant non committé** par Microsoft Edge réel headless (320x720, réseau/OBS synthétiques), script indépendant déjà conservé dans `.git/sc3-f05-routing-disconnect-repro-20261105.cjs` ; journal actualisé `.git/sc3-f05-routing-disconnect-recheck-20261105.log` :
- `disabledImmediately=true` après `offline` ;
- résolution tardive de la requête routing GET en vol ;
- `disabledAfterLateRouting=false` **alors que la connexion est encore hors ligne** ;
- `regressionReproduced=true`.

La suite Edge existante sur ces fichiers non committés reste **2 PASS / 0 FAIL / 0 skipped**, journal `.git/sc3-f05-patch-review-edge-20261105.log` : les deux scénarios réussis ne comprennent pas ce chemin de résolution tardive. Le succès d'un script qui **reproduit le bug** n'est évidemment pas un PASS produit.

## Correction très étroite pour le propriétaire F05
Dans le `finally` de la lecture du routage, ne modifier `inspecting` et le bouton que si `stamp === inspection` ; réactivation autorisée seulement si `available && !linkInterrupted && select.options.length > 0`. Ajouter une régression Edge montrant (1) GET routing suspendu, (2) offline, (3) fin du GET tardif toujours désactivée, puis (4) online et nouvelle lecture maître confirmée avant réactivation. Vérifier qu'un ancien `finally` ne perturbe pas une nouvelle lecture `inspection`. Le nouvel état ne doit pas déclencher de POST ou de retry silencieux.

## État / gates
F05 reste **partial**, G2 **in_progress**, G3/G4/G5 **open**. Aucun test physique, signature de production, installation ni release. Les contrôles de compilation et sécurité devront être attribués au patch corrigé, jamais aux anciens HEAD. Avant fusion F05, relancer cette régression et les deux tests Edge courants, puis types/sécurité/diff. Le présent rapport est une **revue sur sources non committées** et n'autorise aucune promotion de gate.
