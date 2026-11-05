# SC3-SETTINGS-P01 — Conservation des réglages OBS pendant une déconnexion (05/11/2026)

## Portée et propriété des paramètres

- **FIXE, régie maîtresse** : `obsUrl`, mot de passe OBS, `primaryMicInput`, `modeScenes`, `chattingScene`, source navigateur du minuteur, mode de lancement, politique d'overlay, chemin OBS, autorisation LAN sont gérés par `apps/server/src/index.ts` via `PUT /api/v2/settings` avec `expectedRevision`. Les clients associés affichent/modifient le **hôte sélectionné**, sans posséder un second OBS.
- **Client laptop / Android** : appairage, rôle d'appareil, navigation et écran éveillé appartiennent à l'appareil client ; ils ne doivent ni importer les secrets OBS, ni démarrer un maître local par défaut.
- **Intégrations** : Twitch, Google, Discord et WizeBot ont des parcours d'authentification distincts ; être appairé ne prouve ni que le compte est connecté ni que les données sont fraîches.
- **Surface observée** : `apps/mobile/control/settings-view.js`, panneau « OBS et scènes ». Aucun profil utilisateur, secret, installation, OBS, stream ou appareil distant n'a été modifié durant ce lot.

## Défaut confirmé — risque de perte silencieuse de configuration

Les sélecteurs de micro principal, INTRO/JEU/PAUSE/FIN et Discussion ne proposaient que les périphériques/scènes **observés à l'instant T** via OBS. Quand OBS était déconnecté, ou qu'un nom configuré n'était plus détecté, le `<select>` HTML revenait à la valeur vide. Enregistrer **un autre champ** du formulaire renvoyait alors une configuration vide pour ces choix. Ce comportement est une **dégradation des paramètres sauvegardés**, pas une preuve que ces scènes ont été supprimées dans OBS.

## Correctif ciblé

`observedOptions` fusionne les choix actuellement détectés et la valeur enregistrée : si cette dernière manque à la lecture OBS, elle reste présélectionnée, libellée **« non détecté actuellement (conservé) »**. Les choix réellement détectés restent affichés normalement ; le choix « Non associée / Choisir une source » permet toujours de vider volontairement une association. Aucun appel réseau, changement de stockage, migration, suppression ni réessai OBS/Twitch n'a été ajouté.

## Preuves et limites

- Préflight FIXE uniquement : quatre documents d'autorité lus, branche `streamcockpit/3.0-full-experience`, remote GitHub correct, HEAD initial `aa36d2f`, aucun `index.lock`/merge/rebase ; OBS et QA existants uniquement observés.
- Modifications **F05 appartenant à un autre chantier** détectées (trois JS mixeur, test mixeur et `CONTINUITY.md`), **non modifiées et non indexées**. Processus de tests World Director laissés intacts. L'entrée de continuité est reportée pour ne pas violer le propriétaire unique de ce fichier ; cette note sert de trace propre.
- Test RED avant correction : `3 FAIL / 0 PASS / 0 skipped`, dont un véritable navigateur **Microsoft Edge 390 px** : valeurs envoyables `primaryMicInput,scene-intro,scene-live,scene-pause,scene-end,chattingScene` toutes vides lorsque le hôte est OBS-offline.
- Après correction : **6 PASS / 0 FAIL / 0 skipped** sur 2 suites ciblées (`streamcockpit3-settings-preserve-options` et `streamcockpit3-desktop-settings-role`) ; 1 test Edge réel 390 px, aucun appel fournisseur/OBS.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6753 fichiers avant cette note et la matrice**) ; `git diff --check` PASS, avertissements LF/CRLF seulement sur les fichiers F05 d'autrui. Journaux : `%TEMP%\\sc3-settings-preserve-{red,green,types,browser-types,security,diff}-20261105.log`.
- **F00 partial ; G2 in_progress ; G3–G5 open.** Tests navigateur rendus avec données et formulaire **synthétiques** : pas une validation de l'OBS réel, de l'APK ou d'une réinitialisation après coupure.

## Suite de l'audit Settings

La vue mélange actuellement réglages de régie, préférences locales, comptes et intégrations ; son sous-titre en mode appairé laisse croire que les paramètres de la régie sont d'abord sauvegardés sur le client. Un prochain lot peut clarifier la propriété hôte/client et l'état de connexion réel, notamment l'adresse WebSocket, l'authentification et les valeurs périmées, sans réinitialiser les profils ni masquer les problèmes. Ne pas lever une gate sur cette simple amélioration UX.
