const types = new Set(['mic.toggle','scene.set','mode.set','timer.add','sound.play','sound.stop','alert.play','chat.send','wizebot.command','replay.save','replay.start','replay.stop','live.start','live.stop']);
// Fields that determine a side effect. Presentation and shortcut changes do not
// change its meaning; device, target action and parameters always do.
export function actionDefinition(value) {
  if (!value || typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.value !== 'string' || value.value.length > 1000 || !types.has(value.type) || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)) return null;
  return JSON.stringify([value.id, value.type, value.value, value.wizebot?.channel || '', value.wizebot?.id || '']);
}
export function actionCapability(type) {
  if (type.startsWith('replay.')) return 'clips';
  if (type.startsWith('sound.')) return 'audio';
  if (type === 'chat.send' || type === 'wizebot.command') return 'chat';
  return 'obs';
}
