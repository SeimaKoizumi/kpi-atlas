export const reviewAxes = [
  {key:'workDays',titles:['稼働日数','実稼働日数'],weight:20},
  {key:'trainingDays',titles:['研修参加日数'],weight:10},
  {key:'wins',titles:['有効獲得件数','獲得件数'],weight:50},
] as const;
export const conductName='行動・コンプライアンス評価';
const deductions=[5,5,10,30,25];
type QuantitativeReview={workDays:number;trainingDays:number;wins:number};

export function reviewScore(actual:QuantitativeReview,targets:QuantitativeReview,conduct:number){
  const score=reviewAxes.reduce((sum,{key,weight})=>sum+Math.min(actual[key]/targets[key],1)*weight,conduct*0.2);
  return Math.round(score*10)/10;
}

export function reviewConduct(answer:{critical:boolean;counts:number[]}){
  if(answer.critical)return 0;
  return Math.max(0,100-answer.counts.reduce((sum,value,index)=>sum+value*deductions[index],0));
}
