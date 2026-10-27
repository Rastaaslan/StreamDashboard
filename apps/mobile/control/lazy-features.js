/** Optional assistants do not load until an explicit task/form addresses them. */
export function createLazyTask(prefix, load, factory, options) {
  let instance, opening;
  const get=()=>instance?Promise.resolve(instance):(opening??=load().then(module=>instance=module[factory](options)).finally(()=>{opening=undefined;}));
  return {
    async task(name,button){return name.startsWith(prefix)?(await get()).task(name,button):false;},
    async submit(form){return form.id.startsWith(prefix)?(await get()).submit(form):false;},
  };
}
export function createLazyPlanning(options) {
  let instance, opening;
  const get=()=>instance?Promise.resolve(instance):(opening??=import('./local-planning.js').then(module=>instance=module.createLocalPlanning(options)).finally(()=>{opening=undefined;}));
  return {
    async route(path,...args){return /^\/api\/v[12]\/(planning|google\/(calendars|sync)|twitch\/categories)/.test(path)?(await get()).route(path,...args):undefined;},
    async adopt(...args){return (await get()).adopt(...args);},
    async handoff(...args){return (await get()).handoff(...args);},
    async wait(){if(opening)await opening;return instance?.wait();},
  };
}
