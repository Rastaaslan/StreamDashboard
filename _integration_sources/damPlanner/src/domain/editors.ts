import type{EventTemplate,LiveRoutine}from'./models.js';import{duplicateRoutine}from'./cockpit.js';
export{duplicateRoutine};
export function duplicateTemplate(template:EventTemplate):EventTemplate{return{...template,id:crypto.randomUUID(),name:`${template.name} — copie`}}
export function moveRoutineStep(steps:LiveRoutine['steps'],index:number,direction:-1|1){const target=index+direction;if(index<0||index>=steps.length||target<0||target>=steps.length)return[...steps];const copy=[...steps],[step]=copy.splice(index,1);copy.splice(target,0,step!);return copy}
export function duplicateRoutineStep(steps:LiveRoutine['steps'],index:number){const step=steps[index];if(!step)return[...steps];const copy=[...steps];copy.splice(index+1,0,{...step,id:crypto.randomUUID()});return copy}
