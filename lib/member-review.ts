import {z} from 'zod';
import {resolveTargets,usesYieldTarget,type Metric} from './atlas';
import {conductName,reviewAxes,reviewConduct,reviewScore} from './monthly-review';
import {placeTreeNode} from './tree-layout';

export const reviewMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const count = z.number().int().min(0).max(100000);
const day = z.number().int().min(1).max(31);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const shift = z.object({day,mode:z.literal('full')}).or(
  z.object({day,mode:z.literal('timed'),start:clock,end:clock}).refine(row=>row.end>row.start));
export const shifts = z.array(shift).max(31).refine(rows=>new Set(rows.map(row=>row.day)).size===rows.length);
export const memberInput = z.object({
  name:z.string().trim().min(1).max(60),
  studentEmail:z.string().trim().toLowerCase().email().max(254),
  supervisorEmail:z.string().trim().toLowerCase().email().max(254),
}).refine(value=>value.studentEmail!==value.supervisorEmail);
export const studentInput = z.object({
  attendance:z.record(z.string().regex(/^([1-9]|[12]\d|3[01])$/),z.enum(['present','absent'])),
  trainingDays:count.max(31).nullable(),wins:count.nullable(),
  reflection:z.string().trim().max(2000),nextWins:count.nullable().default(null),nextShifts:shifts,submitted:z.boolean(),
});
export const supervisorInput = z.object({
  counts:z.tuple([count,count,count,count,count]),
  critical:z.boolean(),criticalReviewed:z.boolean(),
  feedback:z.string().trim().max(2000),
});
export type ReviewShift=z.infer<typeof shift>;
export type StudentReview=z.infer<typeof studentInput>;
export type SupervisorReview=z.infer<typeof supervisorInput>;
type Values={workDays:number;trainingDays:number;wins:number};
export type ReviewPlan={
  parentId:string;
  cardIds:Record<keyof Values,string>;
  targets:Values;
  confirmedShifts:ReviewShift[];
};
export type PublishedReview={
  actual:Values;
  conduct:number;
  score:number;
  feedback:string;
  publishedAt:string;
};

export function daysInReviewMonth(month:string, offset=0) {
  const [year,index]=month.split('-').map(Number);
  return new Date(Date.UTC(year,index+offset,0)).getUTCDate();
}

export function reviewMonthEnded(month:string, now=Date.now()) {
  const [year,index]=month.split('-').map(Number);
  return now>=Date.UTC(year,index,1)-9*60*60*1000;
}

export function shiftEnded(month:string, shift:ReviewShift, now=Date.now()) {
  const [year,index]=month.split('-').map(Number);
  if(shift.mode==='full') return now>=Date.UTC(year,index-1,shift.day+1)-9*60*60*1000;
  const [hour,minute]=shift.end.split(':').map(Number);
  return now>=Date.UTC(year,index-1,shift.day,hour-9,minute);
}

export function reviewPlan(nodes:Metric[],memberId:string,confirmedShifts:ReviewShift[]):ReviewPlan|null {
  const parents=nodes.filter(node=>node.reviewMemberId===memberId&&!node.cardType&&node.source==='manual');
  if(parents.length!==1)return null;
  const [parent]=parents;
  const children=nodes.filter(node=>node.parent===parent.id&&!node.cardType&&node.source==='manual');
  const boardTargets=resolveTargets(nodes);
  const cards=reviewAxes.map(axis=>{
    const matches=children.filter(node=>axis.titles.some(title=>title===node.name.trim()));
    return matches.length===1?matches[0]:null;
  });
  if(cards.some(card=>!card))return null;
  const [work,training,wins]=cards as [Metric,Metric,Metric];
  const trainingTarget=boardTargets.get(training.id),winsTarget=boardTargets.get(wins.id);
  if(!trainingTarget||!winsTarget||!confirmedShifts.length||usesYieldTarget(work))return null;
  return {
    parentId:parent.id,cardIds:{workDays:work.id,trainingDays:training.id,wins:wins.id},
    targets:{workDays:confirmedShifts.length,trainingDays:trainingTarget,wins:winsTarget},
    confirmedShifts:[...confirmedShifts].sort((a,b)=>a.day-b.day),
  };
}

export function confirmReview(plan:ReviewPlan,student:StudentReview,supervisor:SupervisorReview,now=new Date()):PublishedReview {
  const actual={workDays:Object.values(student.attendance).filter(value=>value==='present').length,
    trainingDays:student.trainingDays!,wins:student.wins!};
  const conduct=reviewConduct(supervisor);
  return {actual,conduct,score:reviewScore(actual,plan.targets,conduct),feedback:supervisor.feedback,publishedAt:now.toISOString()};
}

export function applyMemberReview(nodes:Metric[],memberId:string,plan:ReviewPlan,result:PublishedReview|null,addConduct=true) {
  const parent=nodes.find(node=>node.id===plan.parentId&&node.reviewMemberId===memberId&&!node.cardType&&node.source==='manual');
  if(!parent)return nodes;
  const planned=nodes.map(node=>node.id===plan.cardIds.workDays&&node.parent===parent.id&&!node.cardType&&node.source==='manual'&&
    (node.target!==plan.targets.workDays||usesYieldTarget(node))
    ? {...node,target:plan.targets.workDays,manualYieldTarget:node.yieldPercent!==undefined?true:undefined} : node);
  if(!result)return planned.some((node,index)=>node!==nodes[index])?planned:nodes;
  const conduct=nodes.filter(node=>node.parent===parent.id&&node.name===conductName&&!node.cardType);
  const validConduct=conduct.length===1&&conduct[0].source==='manual'?conduct[0]:null;
  const actuals=new Map<string,number>([[parent.id,result.score]]);
  for(const {key} of reviewAxes){
    const node=nodes.find(node=>node.id===plan.cardIds[key]&&node.parent===parent.id&&!node.cardType&&node.source==='manual');
    if(node)actuals.set(node.id,result.actual[key]);
  }
  if(validConduct)actuals.set(validConduct.id,result.conduct);
  const updated=planned.map(node=>{
    const actual=actuals.get(node.id);
    return actual===undefined||actual===node.actual?node:{...node,actual};
  });
  const id='review-conduct-'+memberId;
  if(!addConduct||conduct.length||updated.length>=100||updated.some(node=>node.id===id))return updated.some((node,index)=>node!==nodes[index])?updated:nodes;
  const card:Metric={id,parent:parent.id,name:conductName,unit:'点',kind:'rate',source:'manual',key:'',actual:result.conduct,target:100,x:0,y:0};
  return placeTreeNode([...updated,card],card.id,parent.id,null);
}
