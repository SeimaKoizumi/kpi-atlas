'use client';

import {useEffect,useState,type FormEvent} from 'react';
import {
  daysInReviewMonth,reviewMonthEnded,shiftEnded,shifts,type ReviewShift,
  type PublishedReview,type ReviewPlan,type StudentReview,
  reviewPlan,
} from '../lib/member-review';
import {boardSchema} from '../lib/atlas';
import {boardStorageKey,reviewApi} from '../lib/review-api';
import './member-reviews.css';

type Member={id:string;name:string;studentEmail?:string;supervisorEmail?:string};
type Entry={memberId:string;name:string;month:string;revision:number;role:'student'|'supervisor';
  plan:ReviewPlan;student:StudentReview|null;result:PublishedReview|null};
type Dashboard={admin:boolean;members:Member[];reviews:Entry[]};
type Save=(payload:unknown)=>Promise<void>;
type EditableShift={mode:'off'|'full'|'timed';start:string;end:string};
const off:EditableShift={mode:'off',start:'',end:''};
const counts=['業務改善の指摘（−5点）','研修・稼働時の遅刻（−5点）',
  '事前申告なしの当日欠勤（−10点）','当日の無断欠勤（−30点）','重大な違反（−25点）'];
const key=(entry:Entry)=>entry.memberId+'-'+entry.month;
const monthLabel=(month:string)=>month.replace('-','年')+'月';
const nextMonth=(month:string)=>{
  const [year,index]=month.split('-').map(Number);
  return new Date(Date.UTC(year,index,1)).toISOString().slice(0,7);
};
const optionalCount=(form:FormData,name:string)=>{
  const value=String(form.get(name)??'').trim();
  return value===''?null:Number(value);
};
const describeShift=(shift:ReviewShift)=>shift.mode==='full'?'フル':shift.start+'–'+shift.end;

export default function MemberReviews({token,onSignOut}:{token:string;onSignOut:()=>void}){
  const [data,setData]=useState<Dashboard>();
  const [selected,setSelected]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  async function refresh(){
    const result=await reviewApi('/reviews',token) as Dashboard;
    setData(result);
  }
  useEffect(()=>{void refresh().catch(error=>setNotice(error.message));},[]);
  async function save(payload:unknown){
    setBusy(true);setNotice('');
    try{
      await reviewApi('/reviews',token,payload);
      await refresh();setNotice('保存しました。');
    }catch(error){setNotice(error instanceof Error?error.message:'保存できませんでした。');}
    finally{setBusy(false);}
  }
  const entry=data?.reviews.find(review=>key(review)===selected)??data?.reviews[0];
  return <main className="review-preview">
    <header className="review-header"><a href="#tree">KPIツリーへ</a><button type="button" onClick={onSignOut}>ログアウト</button></header>
    <h1>メンバーの月次評価</h1>
    {!data&&!notice&&<p role="status">読み込み中</p>}
    {data?.admin&&<AdminSetup members={data.members} save={save} busy={busy} setNotice={setNotice}/>}
    {data&&<section className="review-section">
      {entry?<label className="review-field">閲覧するメンバー・対象月
        <select value={key(entry)} onChange={event=>{setSelected(event.target.value);setNotice('');}}>
          {data.reviews.map(review=><option key={key(review)} value={key(review)}>{review.name} ・ {monthLabel(review.month)}</option>)}
        </select>
      </label>:<p>閲覧できる月次評価がありません。</p>}
    </section>}
    {entry&&<>
      <History entries={data!.reviews.filter(review=>review.memberId===entry.memberId)}/>
      <section className="review-section">
        <div className="review-section-head"><h2>{monthLabel(entry.month)}の評価</h2>
          <strong>{entry.result?`${entry.result.score} / 100点`:entry.student?.submitted?'上長確認待ち':'学生の提出待ち'}</strong></div>
        {entry.result?<Result entry={entry}/>:
          entry.role==='student'&&!entry.student?.submitted
            ? <StudentForm key={key(entry)+'-'+entry.revision} entry={entry} save={save} busy={busy}/>
            : entry.role==='supervisor'&&entry.student?.submitted
              ? <SupervisorForm key={key(entry)+'-'+entry.revision} entry={entry} save={save} busy={busy}/>
              : <p className="review-muted">{entry.role==='student'?'提出済みです。担当上長の確定後に評価が表示されます。':'学生の提出後に評価を確定できます。'}</p>}
      </section>
    </>}
    {notice&&<p role="status" className="review-notice">{notice}</p>}
  </main>;
}

function AdminSetup({members,save,busy,setNotice}:{members:Member[];save:Save;busy:boolean;setNotice:(message:string)=>void}){
  function register(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const fields=new FormData(event.currentTarget);
    void save({action:'member',member:{name:fields.get('name'),studentEmail:fields.get('student'),supervisorEmail:fields.get('supervisor')}});
  }
  function issue(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const fields=new FormData(event.currentTarget);
    const month=String(fields.get('month'));
    const entries=String(fields.get('shifts')).normalize('NFKC').trim().split(/\r?\n/).filter(row=>row.trim()).map(row=>{
      const match=/^(\d{1,2})\s+(フル|(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2}))$/.exec(row.trim());
      if(!match)return null;
      return match[2]==='フル'?{day:Number(match[1]),mode:'full'}:{day:Number(match[1]),mode:'timed',start:match[3],end:match[4]};
    });
    const parsed=shifts.safeParse(entries);
    if(!parsed.success){setNotice('確定シフトを「3 フル」「4 18:00-20:00」の形式で1日ずつ記入してください。');return;}
    const memberId=String(fields.get('member'));
    try{
      const board=boardSchema.parse(JSON.parse(localStorage.getItem(boardStorageKey)??'null'));
      const plan=reviewPlan(board.months[month]??[],memberId,parsed.data);
      if(plan){void save({action:'issue',memberId,month,plan});return;}
    }catch{}
    setNotice('同じブラウザのKPIツリーで対象月を保存し、親カードにメンバーを紐付けて、稼働日数・研修参加日数・獲得件数を設定してください。');
  }
  return <section className="review-section">
    <details><summary>メンバー登録とフォーム発行</summary>
      <form className="review-fields" onSubmit={register}>
        <label>メンバー表示名<input name="name" required maxLength={60}/></label>
        <label>学生のログイン用メール<input name="student" type="email" required/></label>
        <label>担当上長のログイン用メール<input name="supervisor" type="email" required/></label>
        <button type="submit" disabled={busy}>メンバーを登録・更新</button>
      </form>
      {members.length>0&&<form className="review-fields" onSubmit={issue}>
        <label>発行するメンバー<select name="member">{members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label>対象月<input type="month" name="month" required/></label>
        <label>確定シフト<textarea name="shifts" rows={4} required placeholder={'3 フル\n4 18:00-20:00'}/></label>
        <p className="review-muted">対象月のKPIカードでメンバーを紐付けてから発行してください。</p>
        <button type="submit" disabled={busy}>振り返りフォームを発行</button>
      </form>}
    </details>
  </section>;
}

function History({entries}:{entries:Entry[]}){
  const records=entries.filter(entry=>entry.result).sort((a,b)=>a.month.localeCompare(b.month));
  if(!records.length)return null;
  const width=400, height=148;
  const months=records.map(record=>{const [year,month]=record.month.split('-').map(Number);return year*12+month;});
  const span=months.at(-1)!-months[0];
  const points=records.map((record,index)=>({
    x:span?34+(months[index]-months[0])*332/span:200,y:12+(100-record.result!.score)*1.05,
    month:record.month,score:record.result!.score,
  }));
  const segments:typeof points[]=[];
  points.forEach((point,index)=>{
    if(index===0||months[index]-months[index-1]>1)segments.push([]);
    segments.at(-1)!.push(point);
  });
  return <section className="review-section">
    <h2>総合評価の推移</h2>
    <svg className="review-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={points.map(point=>`${monthLabel(point.month)} ${point.score}点`).join('、')}>
      {[0,50,100].map(score=><g key={score}><line x1="34" x2="366" y1={12+(100-score)*1.05} y2={12+(100-score)*1.05} stroke="#dbe4ef"/>
        <text x="28" y={16+(100-score)*1.05} textAnchor="end">{score}</text></g>)}
      {segments.map((segment,index)=><polyline key={index} points={segment.map(({x,y})=>`${x},${y}`).join(' ')} fill="none" stroke="#2857a5" strokeWidth="3"/>)}
      {points.map((point,index)=><g key={point.month}><circle cx={point.x} cy={point.y} r="4" fill="#2857a5"/>
        {(points.length<=6||index===0||index===points.length-1)&&<text x={point.x} y="138" textAnchor="middle">{point.month.slice(2).replace('-','/')}</text>}</g>)}
    </svg>
  </section>;
}

function Result({entry}:{entry:Entry}){
  const {result,plan,student}=entry;
  if(!result)return null;
  return <>
    <dl className="review-result">
      <div><dt>稼働日数</dt><dd>実績 {result.actual.workDays}日 ／ 予定 {plan.targets.workDays}日</dd></div>
      <div><dt>研修参加日数</dt><dd>実績 {result.actual.trainingDays}日 ／ 目標 {plan.targets.trainingDays}日</dd></div>
      <div><dt>有効獲得件数</dt><dd>実績 {result.actual.wins}件 ／ 目標 {plan.targets.wins}件</dd></div>
      <div><dt>行動・コンプライアンス</dt><dd>{result.conduct} / 100点</dd></div>
    </dl>
    {student?.reflection&&<><h3>本人の振り返り</h3><p className="review-copy">{student.reflection}</p></>}
    {student?.nextWins!=null&&<p>翌月の獲得目標案　{student.nextWins}件</p>}
    {student&&<details><summary>日別の出勤確認と翌月の希望シフト</summary>
      <ul>{plan.confirmedShifts.map(shift=><li key={shift.day}>{shift.day}日　{describeShift(shift)}　{student.attendance[shift.day]==='present'?'出勤':'欠勤'}</li>)}</ul>
      <h4>{monthLabel(nextMonth(entry.month))}の希望シフト</h4>
      {student.nextShifts.length?<ul>{student.nextShifts.map(shift=><li key={shift.day}>{shift.day}日　{describeShift(shift)}</li>)}</ul>:<p>希望シフトなし</p>}
    </details>}
    {result.feedback&&<><h3>上長のコメント</h3><p className="review-copy">{result.feedback}</p></>}
  </>;
}

function StudentForm({entry,save,busy}:{entry:Entry;save:Save;busy:boolean}){
  const {plan,student,month,revision,memberId}=entry;
  const [attendance,setAttendance]=useState<StudentReview['attendance']>(student?.attendance??{});
  const [nextShifts,setShifts]=useState<Record<number,EditableShift>>(()=>Object.fromEntries(
    (student?.nextShifts??[]).map(shift=>[shift.day,shift.mode==='full'?{...off,mode:'full'}:shift])));
  const [error,setError]=useState('');
  function setShift(day:number,patch:Partial<EditableShift>){
    setShifts(current=>({...current,[day]:{...(current[day]??off),...patch}}));
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    const fields=new FormData(event.currentTarget);
    const submitted=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='final';
    const parsed=shifts.safeParse(Object.entries(nextShifts).filter(([,shift])=>shift.mode!=='off')
      .map(([day,shift])=>({...shift,day:Number(day)})));
    if(!parsed.success){setError('時間指定した日付の開始・終了時刻を確認してください。');return;}
    void save({action:'student',memberId,month,revision,student:{attendance,submitted,
      trainingDays:optionalCount(fields,'training'),wins:optionalCount(fields,'wins'),
      reflection:fields.get('reflection'),nextWins:optionalCount(fields,'nextWins'),nextShifts:parsed.data}});
  }
  return <form className="review-fields" onSubmit={submit}>
    <h3>確定シフトの出勤確認</h3>
    {plan.confirmedShifts.map(shift=><div className="review-row" key={shift.day}>
      <label htmlFor={'attendance-'+shift.day}>{shift.day}日 <small>{describeShift(shift)}</small></label>
      {shiftEnded(month,shift)?<select id={'attendance-'+shift.day} value={attendance[shift.day]??''}
        onChange={event=>{const value=event.target.value;setAttendance(current=>{
          const next={...current};if(value==='present'||value==='absent')next[shift.day]=value;else delete next[shift.day];return next;
        });}}>
        <option value="">未回答</option><option value="present">出勤した</option><option value="absent">出勤しなかった</option>
      </select>:<span className="review-muted">稼働日終了後に回答</span>}
    </div>)}
    <label>研修参加日数（目標 {plan.targets.trainingDays}日）<input name="training" type="number" min="0" max="31" defaultValue={student?.trainingDays??''}/></label>
    <label>有効獲得件数（目標 {plan.targets.wins}件）<input name="wins" type="number" min="0" max="100000" defaultValue={student?.wins??''}/></label>
    <label>今月の振り返り<textarea name="reflection" rows={3} maxLength={2000} defaultValue={student?.reflection??''}/></label>
    <label>翌月の獲得目標案<input name="nextWins" type="number" min="0" max="100000" defaultValue={student?.nextWins??''}/></label>
    <h3>{monthLabel(nextMonth(month))}の希望シフト</h3>
    {Array.from({length:daysInReviewMonth(month,1)},(_,index)=>{
      const day=index+1,shift=nextShifts[day]??off;
      return <div className="review-row review-shift-row" key={day}>
        <label htmlFor={'shift-'+day}>{day}日</label>
        <select id={'shift-'+day} value={shift.mode} onChange={event=>setShift(day,{mode:event.target.value as EditableShift['mode']})}>
          <option value="off">休み</option><option value="full">フル</option><option value="timed">時間指定</option>
        </select>
        {shift.mode==='timed'&&<div className="review-times">
          <label>開始<input type="time" aria-label={day+'日の開始時刻'} value={shift.start} onChange={event=>setShift(day,{start:event.target.value})}/></label>
          <label>終了<input type="time" aria-label={day+'日の終了時刻'} value={shift.end} onChange={event=>setShift(day,{end:event.target.value})}/></label>
        </div>}
      </div>;
    })}
    <div className="review-form-actions"><button type="submit" value="draft" disabled={busy}>下書きを保存</button>
      <button type="submit" value="final" disabled={busy||!reviewMonthEnded(month)}>提出する</button></div>
    {!reviewMonthEnded(month)&&<p className="review-muted">提出は対象月が終了してからできます。</p>}
    {error&&<p role="alert">{error}</p>}
  </form>;
}

function SupervisorForm({entry,save,busy}:{entry:Entry;save:Save;busy:boolean}){
  const [critical,setCritical]=useState(false);
  const [expanded,setExpanded]=useState<number[]>([]);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const fields=new FormData(event.currentTarget);
    void save({action:'publish',memberId:entry.memberId,month:entry.month,revision:entry.revision,supervisor:{
      counts:counts.map((_,index)=>Number(fields.get(expanded.includes(index)?'extra-'+index:'count-'+index))),
      critical,criticalReviewed:fields.get('reviewed')==='on',feedback:fields.get('feedback')}});
  }
  return <form className="review-fields" onSubmit={submit}>
    <p>提出実績　稼働 {Object.values(entry.student!.attendance).filter(value=>value==='present').length}日 ／ 研修 {entry.student!.trainingDays}日 ／ 獲得 {entry.student!.wins}件</p>
    {entry.student?.reflection&&<p className="review-copy">{entry.student.reflection}</p>}
    {counts.map((label,index)=><label key={label}>{label}
      <select name={'count-'+index} defaultValue="0" onChange={event=>{
        const extra=event.target.value==='more';
        setExpanded(current=>extra?[...current,index]:current.filter(item=>item!==index));
      }}>
        {Array.from({length:11},(_,count)=><option key={count} value={count}>{count}回</option>)}
        <option value="more">11回以上</option>
      </select>
      {expanded.includes(index)&&<input name={'extra-'+index} type="number" min="11" max="100000" required aria-label={label+'の実際の回数'}/>}
    </label>)}
    <label className="review-check"><input type="checkbox" checked={critical} onChange={event=>setCritical(event.target.checked)}/>最重大の違反あり</label>
    {critical&&<label className="review-check"><input name="reviewed" type="checkbox" required/>個別確認を完了した</label>}
    <label>本人に共有するコメント<textarea name="feedback" rows={3} maxLength={2000}/></label>
    <button type="submit" disabled={busy}>評価を確定する</button>
  </form>;
}
