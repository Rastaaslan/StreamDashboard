/** Compose an OBS password mutation without ever interpreting a blank field as a reset.
 * Clearing requires the FIXE desktop owner's explicit confirmation; the server
 * still enforces its settings revision and authorization before any mutation.
 */
export function obsPasswordChange({enteredPassword='',clearRequested=false,canClear=false,confirmClear}={}) {
  if(!clearRequested)return enteredPassword ? {obsPassword:enteredPassword} : {};
  if(!canClear)throw new Error('Effacement du mot de passe OBS réservé à la régie FIXE disponible avec un secret enregistré.');
  if(enteredPassword)throw new Error('Choisissez soit un nouveau mot de passe OBS, soit son effacement, pas les deux.');
  if(typeof confirmClear!=='function'||confirmClear('Effacer le mot de passe OBS enregistré sur FIXE ? OBS sera reconnecté sans mot de passe.')!==true)
    throw new Error('Effacement du mot de passe OBS annulé.');
  return {clearObsPassword:true};
}
