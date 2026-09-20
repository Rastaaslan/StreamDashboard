export const fixture = {
  live: { active: true, duration: '02:14:32', title: 'Survie hardcore — jour 42', category: 'Minecraft', viewers: 17, chatters: 6, scene: 'Gameplay' },
  scenes: ['Intro', 'Gameplay', 'Chatting', 'Pause', 'Fin'],
  audio: [
    { name: 'Micro', volume: 82, level: 68, muted: false, primary: true },
    { name: 'Jeu', volume: 64, level: 45, muted: false },
    { name: 'Discord', volume: 52, level: 22, muted: false },
    { name: 'Soundboard', volume: 75, level: 0, muted: false },
  ],
  sounds: [
    { id: 'bonk', name: 'BONK', category: 'Réactions', favorite: true, enabled: true, sourceAvailable: true },
    { id: 'gg', name: 'GG', category: 'Réactions', favorite: true, enabled: true, sourceAvailable: true },
    { id: 'oh-non', name: 'OH NON', category: 'Réactions', favorite: true, enabled: true, sourceAvailable: true },
    { id: 'creeper', name: 'CREEPER', category: 'Minecraft', favorite: true, enabled: true, sourceAvailable: true },
    { id: 'tnt', name: 'TNT', category: 'Minecraft', favorite: false, enabled: true, sourceAvailable: false },
  ],
  planning: [
    { day: 'Aujourd’hui', time: '20:30', title: 'Survie hardcore', kind: 'Twitch' },
    { day: 'Samedi', time: '18:00', title: 'Préparation du live', kind: 'Production' },
    { day: 'Dimanche', time: '14:00', title: 'Repos', kind: 'Personnel' },
  ],
};
