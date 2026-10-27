export const DEVICE_PERMISSIONS = Object.freeze({
  observe:'Lire les états et les configurations', obs:'Commander OBS et les sorties', clips:'Commander le tampon et les clips',
  audio:'Commander les sons', chat:'Lire et envoyer dans les chats', cloud:'Utiliser les services cloud', planning:'Modifier et publier le planning',
  configuration:'Administration complète (toutes les permissions)',
});
export function validateDevicePermissions(value) {
  if(!Array.isArray(value)||value.some(item=>!Object.hasOwn(DEVICE_PERMISSIONS,item))||new Set(value).size!==value.length)throw new Error('Permissions d’appareil invalides.');
  if(value.includes('configuration')&&value.length!==Object.keys(DEVICE_PERMISSIONS).length)throw new Error('L’administration complète nécessite toutes les permissions. Retirez-la pour limiter cet appareil.');
  return [...value];
}
