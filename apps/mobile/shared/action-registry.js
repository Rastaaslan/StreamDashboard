/** The accepted configuration contract is common to editor and executors. */
export const ACTION_LIMITS=Object.freeze({id:64,value:500,label:80,count:100});
export const ACTIONS=Object.freeze({
  'mic.toggle':{label:'Micro · basculer muet',icon:'♩',capability:'obs'},
  'scene.set':{label:'Choisir une scène',icon:'▣',capability:'obs'},
  'mode.set':{label:'Scène associée à un mode',icon:'▣',capability:'obs'},
  'timer.add':{label:'Ajouter des secondes',icon:'+',capability:'obs'},
  'sound.play':{label:'Jouer un son du catalogue',icon:'♫',capability:'audio'},
  'sound.stop':{label:'Arrêter le son en cours',icon:'■',capability:'audio'},
  'alert.play':{label:'Relancer une source média OBS',icon:'✦',capability:'obs'},
  'chat.send':{label:'Envoyer un message dans le chat',icon:'↗',capability:'chat'},
  'wizebot.command':{label:'Commande WizeBot dans Twitch',icon:'✉',capability:'chat'},
  'replay.save':{label:'Sauvegarder un clip OBS',icon:'✂',capability:'clips'},
  'replay.start':{label:'Préparer le tampon de replay',icon:'▶',capability:'clips'},
  'replay.stop':{label:'Arrêter le tampon de replay',icon:'■',capability:'clips'},
  'live.start':{label:'Lancer Twitch et YouTube',icon:'◉',capability:'obs'},
  'live.stop':{label:'Arrêter les deux diffusions',icon:'■',capability:'obs'},
});
export const ACTION_TYPES=Object.freeze(Object.keys(ACTIONS));
export const OUTCOME_LABELS=Object.freeze({running:'En cours',succeeded:'Confirmé',failed:'Échec',partial:'Partiel',uncertain:'À vérifier'});
