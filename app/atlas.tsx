import {AtlasTheme,ThemeButton} from './theme';
import {ShareLaunch} from './share-launch';
import {useCallback,useEffect,useEffectEvent,useMemo,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft,
  ChevronRight, CircleHelp, Database, GitBranch, GripVertical, Maximize, Minus, Mouse,
  Plus, Redo2, RefreshCw, ScanLine, Target, Undo2, X, Zap, Pencil, TriangleAlert,
  Layers3, CalendarClock, CornerDownRight, Crosshair, Network, CircleDot, CloudCheck, Lock, Sigma, Copy,
} from 'lucide-react';
import {boardSchema,emptyBoard,fmt,H,isCountMetric,monthInfo,nextMonth,performance,priceActual,requiredForYield,resolveActuals,resolveTargets,sampleBoard,signed,starterNodes,sumActual,sumUnitFactor,today,toneLabel,usesYieldTarget,W,yieldSettingsError} from '../lib/atlas';
import type {Board,Metric,Tone} from '../lib/atlas';
import { BRANCH_RUN, duplicateTreeBranch, layoutTree, placeTreeNode, planTreeDrop } from '../lib/tree-layout';
import {addChannelCards,readChannelMetrics} from '../lib/channel-sync';
import type {ChannelMetric} from '../lib/channel-sync';

const displayActual=(value:number|null)=>value===null?'—':fmt(value);
const boardStorageKey = 'kpi-atlas.public.board.v1';
const feedStorageKey = 'kpi-atlas.public.feed.v1';

function parseFeedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('クエリや認証情報を含まないHTTPSのURLを入力してください。');
  }
  return url;
}

const pct=(x:number|null)=>x===null?'—':fmt(Math.round(x*100))+'%';
const cap=(n:number,a:number,b:number)=>Math.min(b,Math.max(a,n));
function monthNodes(b:Board, m:string) {
  if(b.months[m]) return b.months[m];
  const previous=Object.keys(b.months).filter(k=>k<m).sort().at(-1);
  if(previous)return b.months[previous].map(n=>n.cardType==='task'?{...n,taskDone:false}:{...n,actual:0});
  return starterNodes();
}
const setNodes=(b:Board,m:string,n:Metric[]):Board=>({...b,months:{...b.months,[m]:n}});
const iconSize=15;
type View={x:number;y:number;k:number};
type Drag={id:string|null;sx:number;sy:number;x:number;y:number;moved:boolean};
type SaveStatus='loading'|'saved'|'error';
const statusText={loading:'読み込み中',saved:'ブラウザに保存',error:'保存エラー · 再試行'};

function PaceBar({actual,expected,tone}:{actual:number;expected:number;tone:Tone}) {
  return <div className={'pace-bar '+tone}><i style={{width:pct(cap(actual,0,1))}}/>{expected>0&&<b style={{left:pct(cap(expected,0,1))}}/>}</div>;
}

export default function Atlas() {
  const [sample,setSample]=useState(false);
  const [personalMonth,setPersonalMonth]=useState(()=>today().month);
  return <AtlasTheme><AtlasWorkspace
    key={sample?'sample':'personal'}
    sample={sample}
    initialMonth={sample?undefined:personalMonth}
    onMonthChange={sample?undefined:setPersonalMonth}
    onSwitchWorkspace={()=>setSample(current=>!current)}
  /></AtlasTheme>;
}

function AtlasWorkspace({sample,initialMonth,onMonthChange,onSwitchWorkspace}: {
  sample: boolean;
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
  onSwitchWorkspace: () => void;
}) {
  const [date,setDate]=useState(()=>today());
  const [month,setMonth]=useState(initialMonth ?? date.month);
  const [board,setBoard]=useState<Board>(()=>sample?sampleBoard(date):emptyBoard());
  const state=useRef(board);
  const [selected,setSelected]=useState<string|null>(null);
  const [save,setSave]=useState<SaveStatus>(sample?'saved':'loading');
  const [feedUrl,setFeedUrl]=useState('');
  const [feedDraft,setFeedDraft]=useState('');
  const configured=Boolean(feedUrl);
  const [syncing,setSyncing]=useState(false);
  const [feedOptions,setFeedOptions]=useState<ChannelMetric[]>([]);
  const lock=useRef(false);
  const [panel,setPanel]=useState<'sync'|'help'|null>(null);
  const [toast,setToast]=useState('');
  const [past,setPast]=useState<Board[]>([]);
  const [future,setFuture]=useState<Board[]>([]);
  const [view,setView]=useState<View>({x:18,y:12,k:1});
  const [dragging,setDragging]=useState<{id:string;x:number;y:number}|null>(null);
  const drag=useRef<Drag|null>(null);
  const [panning,setPanning]=useState(false);
  const [moveMode,setMoveMode]=useState(false);
  const canvas=useRef<HTMLDivElement>(null);
  const initialized=useRef(false);
  const framed=useRef<string|null>(null);
  const [editing,setEditing]=useState<string|null>(null);
  const [inline,setInline]=useState('');
  const [draft,setDraft]=useState<Metric|null>(null);
  const [draftError,setDraftError]=useState('');
  const [deleteOpen,setDeleteOpen]=useState(false);
  const viewRef=useRef(view);
  viewRef.current=view;
  const info=monthInfo(month,date);
  const base = useMemo(() => monthNodes(board, month), [board, month]);
  const layout = useMemo(() => layoutTree(base), [base]);
  const aggregateByInput = useMemo(() => {
    const aggregates = new Map<string, Metric>();
    for (const node of base) {
      if (node.source === 'sum') {
        for (const inputId of node.sumIds ?? []) aggregates.set(inputId, node);
      } else if (node.source === 'price' && node.unitPrice) {
        aggregates.set(node.unitPrice.quantityId, node);
      }
    }
    return aggregates;
  }, [base]);
  const actuals = useMemo(() => resolveActuals(base), [base]);
  const targets = useMemo(() => resolveTargets(base), [base]);
  const nodes = layout.nodes.map(node => ({
    ...node, actual:actuals.get(node.id) ?? null, target:targets.get(node.id) ?? 0,
  }));
  const dropPlan = dragging ? planTreeDrop(layout, dragging.id, dragging.x, dragging.y) : null;
  const dragAggregate = dragging ? aggregateByInput.get(dragging.id) : undefined;
  const dropBlocked = Boolean(dropPlan && dragAggregate && dropPlan.parent.id !== dragAggregate.id);
  const sumDraft = draft?.source === 'sum' ? draft : null;
  const sumOptions = sumDraft ? (layout.children.get(sumDraft.id) ?? []).filter(node=>node.cardType!=='task') : [];
  const eligibleSumIds = sumDraft ? sumOptions.filter(n=>n.kind==='total'&&sumUnitFactor(n.unit,sumDraft.unit)!==null).map(n=>n.id) : [];
  const selectedSumIds = sumDraft?.sumIds ?? [];
  const sumPreview = sumDraft ? sumActual(sumDraft, base, node => actuals.get(node.id) ?? null) : null;
  const priceDraft = draft?.source === 'price' ? draft : null;
  const priceSettings = priceDraft?.unitPrice;
  const priceOptions = priceDraft ? (layout.children.get(priceDraft.id) ?? []).filter(isCountMetric) : [];
  const pricePreview = priceDraft ? priceActual(priceDraft, base, node => actuals.get(node.id) ?? null) : null;
  const draftAutoTarget = Boolean(draft && usesYieldTarget(draft));
  const draftManualActual = draft?.source==='manual';
  const yieldPreview = draft?.parent && draft.yieldPercent !== undefined
    ? requiredForYield(targets.get(draft.parent) ?? null, draft.yieldPercent, draft)
    : null;
  const changesPositions = (other: Board | undefined) => {
    if (!other) return false;
    const previous = layoutTree(monthNodes(other, month));
    const existing = layout.nodes.filter(node => previous.byId.has(node.id));
    const otherExisting = previous.nodes.filter(node => layout.byId.has(node.id));
    return existing.some((node, i) => node.id !== otherExisting[i].id || node.parent !== otherExisting[i].parent);
  };
  const undoLocked=!moveMode&&changesPositions(past.at(-1));
  const redoLocked=!moveMode&&changesPositions(future[0]);
  const root=nodes.find(n=>n.parent===null)!;
  const rootStats=performance(root,info.fraction);
  const selectedNode=nodes.find(n=>n.id===selected);
  const insertionParent=selectedNode?.cardType==='task' ? selectedNode.parent??root.id : selectedNode?.id??root.id;
  const ordered=nodes.filter(n=>n.cardType!=='task').map(n=>({n,...performance(n,info.fraction)}));
  const warnings=ordered.filter(item=>item.tone==='bad'||item.tone==='warn').sort((a,b)=>(a.pace??0)-(b.pace??0));
  const counts=ordered.reduce((t,{tone})=>({...t,[tone]:t[tone]+1}),{good:0,warn:0,bad:0,neutral:0});
  const displayMonth=month.replace('-',' / ');
  const statusLine=month===date.month?'今日の目安':month<date.month?'月末目標':'月初の目安';
  const [year,mm]=month.split('-').map(Number);
  const monthRef=useRef(month);
  monthRef.current=month;

  useEffect(()=>{
    const timer=setInterval(()=>setDate(today()),30000);
    try {
      if(!sample) {
        const saved=window.localStorage.getItem(boardStorageKey);
        if(saved) {
          const stored=boardSchema.parse(JSON.parse(saved));
          state.current=stored;
          setBoard(stored);
        }
        const savedFeed=window.localStorage.getItem(feedStorageKey)??'';
        setFeedUrl(savedFeed);
        setFeedDraft(savedFeed);
      }
      initialized.current=true;
      setSave('saved');
    }catch {
      setSave('error');
    }
    return ()=>{
      initialized.current=false;
      clearInterval(timer);
    };
  },[sample]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3600);return()=>clearTimeout(t);},[toast]);
  const handleShortcut=useEffectEvent((event:KeyboardEvent)=>{
    if(event.defaultPrevented||event.isComposing||event.altKey||panel||deleteOpen||drag.current)return;
    const target=event.target;
    if(target instanceof Element && (target.closest('input:not([type=checkbox]):not([type=radio]), textarea, select, [role=dialog]') || (target instanceof HTMLElement && target.isContentEditable)))return;

    if(event.ctrlKey||event.metaKey) {
      const key=event.key.toLowerCase();
      const backwards=key==='z'&&!event.shiftKey;
      const forwards=(key==='y'&&!event.shiftKey)||(key==='z'&&event.shiftKey);
      if(!backwards&&!forwards)return;
      event.preventDefault();
      if(backwards?undoLocked:redoLocked) {
        setToast('順番や階層を変更するには移動モードをオンにしてください。');
      } else if(backwards) {
        undo();
      } else {
        redo();
      }
      return;
    }

    if(event.key!=='Enter'||event.shiftKey||event.repeat)return;
    if(target instanceof Element && target.closest('input, button, a[href], summary, [role=dialog]'))return;
    const focusedId=target instanceof Element ? target.getAttribute('data-kpi-id') : null;
    if(focusedId&&focusedId!==selected) {
      event.preventDefault();
      pick(focusedId);
    } else if(selectedNode) {
      event.preventDefault();
      addSibling();
    }
  });
  useEffect(()=>{
    const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPanel(null);setSelected(null);setEditing(null);setDeleteOpen(false);}};
    window.addEventListener('keydown',close);
    window.addEventListener('keydown',handleShortcut);
    return()=>{
      window.removeEventListener('keydown',close);
      window.removeEventListener('keydown',handleShortcut);
    };
  },[]);

  const write=useCallback((b:Board)=>{
    if(sample||!initialized.current)return;
    try {
      window.localStorage.setItem(boardStorageKey,JSON.stringify(b));
      setSave('saved');
    }catch {
      setSave('error');
    }
  },[sample]);
  const change=useCallback((b:Board,history=true)=>{
    if(!initialized.current){setToast('ブラウザの保存先を読み込んでから編集できます。');return;}
    if(history){const prior=state.current;setPast(p=>[...p.slice(-39),prior]);setFuture([]);}
    state.current=b;setBoard(b);write(b);
  },[write]);
  const retry=()=>{
    if(initialized.current)write(state.current);
    else window.location.reload();
  };
  function pick(id:string|null) {
    setSelected(id);setDeleteOpen(false);setDraftError('');
    const n=base.find(n=>n.id===id);
    setDraft(n?{...n}:null);
  }
  function undo() {
    if(!past.length||undoLocked)return;
    const before=state.current;
    setFuture(f=>[before,...f]);setPast(p=>p.slice(0,-1));
    change(past[past.length-1],false);pick(null);
  }
  function redo() {
    if(!future.length||redoLocked)return;
    const before=state.current;
    setPast(p=>[...p,before]);setFuture(f=>f.slice(1));
    change(future[0],false);pick(null);
  }
  function switchMonth(m:string) {
    if(m===month||m<'2000-01'||m>'2099-12')return;
    onMonthChange?.(m);
    drag.current=null;setMonth(m);pick(null);setEditing(null);setDragging(null);setPanning(false);
  }
  const fit=useCallback((list:Metric[])=>{
    const host=canvas.current;
    if(!host||!list.length)return;
    const left=Math.min(...list.map(n=>n.x)),top=Math.min(...list.map(n=>n.y));
    const width=Math.max(...list.map(n=>n.x+W))-left;
    const height=Math.max(...list.map(n=>n.y+H))-top;
    const k=cap(Math.min((host.clientWidth-58)/width,(host.clientHeight-52)/height),.18,1.15);
    setView({x:Math.max(20,(host.clientWidth-width*k)/2)-left*k,y:Math.max(20,(host.clientHeight-height*k)/2)-top*k,k});
  },[]);
  const frameKey=month+(save==='loading'?':preview':':ready');
  useEffect(()=>{
    const host=canvas.current;
    if(!host||framed.current===frameKey)return;
    const frame=()=>{
      if(framed.current===frameKey||!host.clientWidth||!host.clientHeight)return;
      framed.current=frameKey;
      fit(layout.nodes);
    };
    frame();
    if(framed.current===frameKey)return;
    const ob=new ResizeObserver(frame);
    ob.observe(host);
    return()=>ob.disconnect();
  },[frameKey,layout,fit]);
  const zoom=useCallback((factor:number,px?:number,py?:number)=>{
    if(!moveMode)return;
    const cx=px??(canvas.current?.clientWidth??0)/2,cy=py??(canvas.current?.clientHeight??0)/2;
    setView(v=>{const k=cap(v.k*factor,.18,2.4);return{k,x:cx-(cx-v.x)*k/v.k,y:cy-(cy-v.y)*k/v.k};});
  },[moveMode]);
  useEffect(()=>{
    if(!moveMode)return;
    const el=canvas.current;
    const wheel=(e:WheelEvent)=>{
      if((e.target as HTMLElement).closest('.inline-value'))return;
      e.preventDefault();
      if(e.ctrlKey||e.metaKey){
        const r=el!.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.008),e.clientX-r.left,e.clientY-r.top);
      } else setView(v=>({...v,x:v.x-e.deltaX,y:v.y-e.deltaY}));
    };
    el?.addEventListener('wheel',wheel,{passive:false});
    return()=>el?.removeEventListener('wheel',wheel);
  },[moveMode,zoom]);
  function focusNode(n:Pick<Metric,'id'|'x'|'y'>) {
    pick(n.id);
    if(!moveMode)return;
    const host=canvas.current;if(!host)return;
    const k=Math.max(.8,view.k);
    setView({k,x:host.clientWidth/2-(n.x+W/2)*k,y:host.clientHeight/2-(n.y+H/2)*k});
  }
  function toggleMoveMode() {
    drag.current=null;setDragging(null);setPanning(false);
    setMoveMode(on=>!on);
  }
  function pointerStart(e:ReactPointerEvent<HTMLDivElement>,n?:Pick<Metric,'id'|'x'|'y'>) {
    if(e.button!==0 || (e.target as HTMLElement).closest('button,input,.task-status'))return;
    e.stopPropagation();
    drag.current={id:n?.id??null,sx:e.clientX,sy:e.clientY,x:n?.x??view.x,y:n?.y??view.y,moved:false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e:ReactPointerEvent<HTMLDivElement>) {
    const d=drag.current;if(!d)return;
    const dx=e.clientX-d.sx,dy=e.clientY-d.sy;
    if(!d.moved&&Math.hypot(dx,dy)<5)return;
    d.moved=true;
    if(!moveMode)return;
    if(d.id)setDragging({id:d.id,x:d.x+dx/viewRef.current.k,y:d.y+dy/viewRef.current.k});
    else {setPanning(true);setView(v=>({...v,x:d.x+dx,y:d.y+dy}));}
  }
  function pointerEnd(e:ReactPointerEvent<HTMLDivElement>,cancel=false) {
    const d=drag.current;if(!d)return;
    drag.current=null;setDragging(null);setPanning(false);
    if(cancel)return;
    if(d.id&&d.moved&&moveMode){
      const x = d.x + (e.clientX - d.sx) / viewRef.current.k;
      const y = d.y + (e.clientY - d.sy) / viewRef.current.k;
      const plan = planTreeDrop(layout, d.id, x, y);
      if (!plan) return;
      const aggregate = aggregateByInput.get(d.id);
      if (aggregate && plan.parent.id !== aggregate.id) {
        setToast(aggregate.name+'の集計対象から外すと、別の階層に移動できます。');
        return;
      }
      const changedParent = layout.byId.get(d.id)?.parent !== plan.parent.id;
      const updated = placeTreeNode(base, d.id, plan.parent.id, plan.beforeId);
      change(setNodes(state.current, month, updated));
      if (changedParent) {
        setDraft(current => current?.id === d.id ? {...current,parent:plan.parent.id} : current);
        setToast('第' + (plan.depth + 1) + '階層へ移動しました');
      } else {
        setToast('順番を変更しました');
      }
    } else if(!d.moved) pick(d.id);
  }
  function openYieldSettings(id: string) {
    pick(id);
    requestAnimationFrame(() => document.getElementById('yield-percent')?.focus());
  }
  function updateYieldPercent(value: number | undefined) {
    setDraft(current => {
      if (!current) return current;
      return {...current, yieldPercent:value};
    });
    setDraftError('');
  }
  function startInline(n:Pick<Metric,'id'|'source'> & {actual:number|null}) {
    if(n.source==='sum'||n.source==='price'){pick(n.id);return;}
    if(n.source==='api'){pick(n.id);setToast('API連携の数値は「データ連携」から更新できます。');return;}
    setInline(n.actual===null?'':String(n.actual));setEditing(n.id);
  }
  function commitInline(id:string) {
    if(editing!==id)return;
    setEditing(null);
    const value=Number(inline);
    if(!inline.trim()||!Number.isFinite(value)||value<0||value>1e12){setToast('0以上の数値を入力してください。');return;}
    if(base.find(n=>n.id===id)?.actual===value)return;
    change(setNodes(state.current,month,base.map(n=>n.id===id?{...n,actual:value}:n)));
    if(draft?.id===id)setDraft(d=>d?{...d,actual:value}:d);
  }
  function addSibling() {
    if(!selectedNode?.parent) {
      setToast('最上位のKPIに子を作るには「KPIを追加」を使ってください。');
      return;
    }
    const siblings=layout.children.get(selectedNode.parent) ?? [];
    const nextSibling=siblings[siblings.findIndex(node=>node.id===selectedNode.id)+1];
    addNode(selectedNode.parent,{beforeId:nextSibling?.id,task:selectedNode.cardType==='task',focusCard:true});
  }
  function addNode(parentId:string,{beforeId,task,focusCard}: {beforeId?:string;task?:boolean;focusCard?:boolean}={}) {
    if(!initialized.current){setToast('ブラウザの保存先を読み込んでから編集できます。');return;}
    if(base.length>=100){setToast('1か月に追加できるのは100項目までです。');return;}
    const n:Metric={
      id:crypto.randomUUID(),parent:parentId,name:task?'新しいタスク':'新しいKPI',
      unit:task?'':'件',kind:'total',source:'manual',key:'',actual:0,target:0,x:0,y:0,
      ...(task?{cardType:'task',taskDone:false}:{}),
    };
    const all = placeTreeNode([...base,n], n.id, parentId, beforeId??null);
    change(setNodes(state.current,month,all));
    if(moveMode)fit(layoutTree(all).nodes);
    setSelected(n.id);setDraft(n);setDraftError('');
    requestAnimationFrame(()=>{
      if(focusCard)document.querySelector<HTMLElement>('[data-kpi-id="'+n.id+'"]')?.focus({preventScroll:true});
      else document.querySelector<HTMLInputElement>('#metric-name')?.select();
    });
  }
  function duplicateCard() {
    if(!selectedNode?.parent)return;
    if(!initialized.current){setToast('ブラウザの保存先を読み込んでから編集できます。');return;}
    const result=duplicateTreeBranch(base,selectedNode.id);
    if(!result.ok){
      if(result.reason==='limit')setToast('複製すると1か月の上限（100項目）を超えます。');
      return;
    }
    change(setNodes(state.current,month,result.nodes));
    if(moveMode)fit(layoutTree(result.nodes).nodes);
    setSelected(result.copy.id);setDraft(result.copy);setDraftError('');setDeleteOpen(false);setEditing(null);
    setToast('カードを複製しました。');
    requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('#metric-name')?.select());
  }
  function setTaskDone(id:string,taskDone:boolean) {
    change(setNodes(state.current,month,base.map(node=>node.id===id?{...node,taskDone}:node)));
    setDraft(current=>current?.id===id?{...current,taskDone}:current);
  }
  function setSumIds(sumIds: string[]) {
    setDraft(current => current ? {...current,sumIds} : current);
    setDraftError('');
  }
  function saveDraft() {
    if(!draft||!initialized.current)return;
    if(!draft.name.trim()){setDraftError('名前を入力してください。');return;}
    if(!draftAutoTarget&&(!Number.isFinite(draft.target)||draft.target<0||draft.target>1e12)){
      setDraftError('目標は0以上の数値にしてください。');return;
    }
    if(draftManualActual&&(!Number.isFinite(draft.actual)||draft.actual<0||draft.actual>1e12)){
      setDraftError('実績は0以上の数値にしてください。');return;
    }
    if(draft.source==='api'&&!draft.key.trim()){setDraftError('連携キーを入力してください。');return;}
    const yieldError = yieldSettingsError(draft);
    if (yieldError) {setDraftError(yieldError);return;}

    const savedNode = base.find(node => node.id === draft.id);
    if (!savedNode) return;
    const n: Metric = {
      ...draft,
      order:savedNode.order,
      name:draft.name.trim(),
      key:draft.key.trim(),
      target:draftAutoTarget ? savedNode.target : draft.target,
      actual:draftManualActual ? draft.actual : draft.source==='api' && draft.key.trim()!==savedNode.key ? 0 : savedNode.actual,
      manualYieldTarget:draft.yieldPercent!==undefined && draft.manualYieldTarget ? true : undefined,
      sumIds:draft.source==='sum' ? draft.sumIds : undefined,
      unitPrice:draft.source==='price' ? draft.unitPrice : undefined,
    };
    let all = base.map(old => old.id === n.id ? n : old);
    if (n.parent && n.parent !== savedNode.parent) all = placeTreeNode(all, n.id, n.parent, null);
    for (const aggregate of all) {
      if (aggregate.source !== 'sum' && aggregate.source !== 'price') continue;
      const result = aggregate.source === 'price' ? priceActual(aggregate, all) : sumActual(aggregate, all);
      if (!result.ok) {
        setDraftError(aggregate.id === n.id ? result.message : aggregate.name+'の集計設定を確認してください。'+result.message);
        return;
      }
    }
    const enabledChannels = n.channelSync && !savedNode.channelSync;
    const updated = setNodes(state.current,month,all);
    change(enabledChannels ? {...updated,auto:true} : updated);
    setDraft(n);setDraftError('');setToast(n.cardType==='task'?'タスクを更新しました':'KPIを更新しました');
    if (configured && (enabledChannels || (n.source==='api' && (savedNode.source!=='api' || n.key!==savedNode.key)))) void sync();
  }
  function removeNode() {
    if(!selectedNode?.parent)return;
    const {id,parent}=selectedNode;
    const aggregate = aggregateByInput.get(id);
    if (aggregate) {
      setToast(aggregate.name+'の集計対象から外してから削除してください。');return;
    }
    const siblings = layout.children.get(parent) ?? [];
    const beforeId = siblings[siblings.findIndex(n => n.id === id) + 1]?.id ?? null;
    let remaining = base.filter(n => n.id !== id);
    for (const child of layout.children.get(id) ?? []) {
      remaining = placeTreeNode(remaining, child.id, parent, beforeId);
    }
    change(setNodes(state.current, month, remaining));
    pick(null);setToast(selectedNode.cardType==='task'?'タスクを削除しました':'KPIを削除しました');
  }
  function saveFeed(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const entered=feedDraft.trim();
      const next=entered ? parseFeedUrl(entered).href : '';
      window.localStorage.setItem(feedStorageKey,next);
      setFeedOptions([]);
      setFeedUrl(next);
      setFeedDraft(next);
      setToast(next?'連携先を保存しました。':'連携先の設定を解除しました。');
    }catch(error) {
      setToast(error instanceof TypeError?'有効なHTTPSのURLを入力してください。':error instanceof Error?error.message:'連携先を保存できませんでした。');
    }
  }

  const sync=useCallback(async (quiet=false)=>{
    if(lock.current)return;
    const m=monthRef.current,b=state.current;
    const initial=monthNodes(b,m);
    if(!configured){if(!quiet)setToast('先に連携先を設定してください。');return;}
    if(quiet && !initial.some(n=>n.source==='api'||n.channelSync)) return;
    lock.current=true;setSyncing(true);
    try {
      const url=parseFeedUrl(feedUrl);
      url.searchParams.set('month',m);
      const r=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!r.ok)throw Error('連携先から数値を取得できませんでした。');
      const data=await r.json() as {metrics?:unknown;channels?:unknown} | null;
      if(!data?.metrics || typeof data.metrics!=='object' || Array.isArray(data.metrics)) {
        throw Error('連携先の応答に metrics がありません。');
      }
      const metrics=Object.fromEntries(Object.entries(data.metrics).filter(
        ([key,value])=>key.length>0 && key.length<=100 && typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1e12,
      )) as Record<string,number>;
      const channels=readChannelMetrics(data.channels,metrics);
      const labels=new Map(channels.map(channel=>[channel.key,channel.label]));
      setFeedOptions(Object.keys(metrics).map(key=>({key,label:labels.get(key)??key})));
      const latest=state.current;
      const live=monthNodes(latest,m);
      let updated=0,missing=0;
      const all=live.map(n=>{
        if(n.source!=='api')return n;
        if(!Object.hasOwn(metrics,n.key)){missing++;return n;}
        updated++;
        return {...n,actual:metrics[n.key]};
      });
      const imported = addChannelCards(all, channels, metrics);
      if(updated||imported.added) {
        change({...setNodes(latest,m,imported.nodes),lastSync:{...latest.lastSync,[m]:new Date().toISOString()}},false);
      }
      if(!quiet||imported.added) {
        const summary = [
          updated ? updated+'件を同期' : '',
          imported.added ? imported.added+'件の媒体KPIを追加' : '',
          imported.skipped ? 'カード上限のため'+imported.skipped+'件を保留' : '',
          missing ? 'キー不一致 '+missing+'件' : '',
        ].filter(Boolean);
        setToast(summary.join(' · ') || '連携キーを読み込みました。');
      }
    }catch(e){setToast(e instanceof Error?e.message:'同期に失敗しました。');}
    finally{lock.current=false;setSyncing(false);}
  },[change,configured,feedUrl]);
  useEffect(()=>{
    if(!board.auto||!configured)return;
    void sync(true);
    const id=setInterval(()=>{if(document.visibilityState==='visible')void sync(true);},60000);
    return()=>clearInterval(id);
  },[board.auto,configured,month,sync]);
  const descendants=new Set<string>();
  if(selectedNode){
    const visit=(id:string)=>{if(descendants.has(id))return;descendants.add(id);base.filter(n=>n.parent===id).forEach(n=>visit(n.id));};
    visit(selectedNode.id);
  }
  const lastSync=board.lastSync[month]?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(board.lastSync[month])):null;
  const rootLabel=rootStats.pace===null?'判定前':toneLabel[rootStats.tone];
  const required=root.kind==='total'&&root.actual!==null&&info.remaining>0?Math.max(0,(root.target-root.actual)/info.remaining):null;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Network size={20} strokeWidth={2.15}/></span><span>KPI <strong>ATLAS</strong></span></div>
      <span className="header-divider"/><div className="breadcrumb">ワークスペース <ChevronRight size={12}/> <strong>KPIツリー</strong></div>
      <div className="top-actions">
        <div className="save-state" role="status">
          {sample?'サンプルモード':save==='error'?<button onClick={retry}>{statusText[save]}</button>:<><span className={save==='saved'?'saved-dot':'waiting-dot'}/>{statusText[save]}</>}
        </div>
        {!sample&&<button className="button secondary sync-button" onClick={()=>setPanel('sync')}><Database size={iconSize}/>データ連携{configured&&<span className="saved-dot"/>}</button>}
        {!sample&&<ShareLaunch variant="public" month={month} nodes={base}/>}
        <ThemeButton/>
        <button className="icon-button help-button" aria-label="使い方" onClick={()=>setPanel('help')}><CircleHelp size={19}/></button>
      </div>
    </header>
    <main>
      <section className="overview">
        <div className="overview-head">
          <div>
            <div className="eyebrow"><span/> MONTHLY PERFORMANCE</div>
            <h1>月間KPIツリー</h1>
            <p>目標へのペースを見渡し、次に手を打つべき指標を見つける。</p>
            <div className="sample-controls">
              <button type="button" className="button secondary" onClick={onSwitchWorkspace}>
                {sample?'自分のツリーに戻る':'サンプルを見る'}
              </button>
              {sample&&<p>架空の体験教室のツリーです。ここでの編集はサンプルを閉じるとリセットされます。</p>}
            </div>
          </div>
          <div className="month-section">
            <div className="month-picker">
              <button className="icon-button" aria-label="前月" onClick={()=>switchMonth(nextMonth(month,-1))}><ChevronLeft size={17}/></button>
              <label title="月を選択"><CalendarDays size={15}/><span>{displayMonth}</span><input type="month" aria-label="表示する月" value={month} min="2000-01" max="2099-12" onChange={e=>e.target.value&&switchMonth(e.target.value)} onClick={e=>{try{e.currentTarget.showPicker();}catch{}}}/></label>
              <button className="icon-button" aria-label="翌月" onClick={()=>switchMonth(nextMonth(month,1))}><ChevronRight size={17}/></button>
            </div>
            <span className="month-caption">{month===date.month?<><i/> 今月 · {mm}月{date.day}日現在</>:<button onClick={()=>switchMonth(date.month)}>今月に戻る <ArrowRight size={11}/></button>}</span>
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat primary-stat">
            <div className="stat-label"><Target/>月間実績 <span className="stat-tag">KGI</span></div>
            <div className="stat-value">{displayActual(root.actual)} <small>{root.unit}</small></div>
            <PaceBar actual={rootStats.progress} expected={root.kind==='total'?info.fraction:(info.fraction>0?1:0)} tone="good"/>
            <div className="stat-meta"><span>目標 {fmt(root.target)} {root.unit}</span><strong>{root.target>0?pct(rootStats.progress):'—'} 達成</strong></div>
          </div>
          <div className="stat">
            <div className="stat-label"><Activity/> {statusLine}に対するペース</div>
            <div className={'stat-value '+rootStats.tone}>{pct(rootStats.pace)} <span className={'status '+rootStats.tone}>{rootStats.tone==='good'?<ArrowUpRight size={12}/>:rootStats.tone==='bad'?<ArrowDownRight size={12}/>:<CircleDot size={10}/>} {rootLabel}</span></div>
            <div className="stat-meta"><span>目安 {fmt(rootStats.expected)} {root.unit}</span><strong className={rootStats.tone}>{rootStats.gap===null||rootStats.pace===null?'—':signed(rootStats.gap)+' '+root.unit}</strong></div>
          </div>
          <div className="stat">
            <div className="stat-label"><Zap/>月末着地見込み</div>
            <div className="stat-value">{rootStats.forecast===null?'—':fmt(Math.round(rootStats.forecast*10)/10)} <small>{root.unit}</small></div>
            <div className="stat-meta"><span>{root.kind==='rate'?'現在の率を維持した場合':'同じペースが続いた場合'}</span><strong className={rootStats.tone}>{rootStats.forecast!==null&&root.target>0?pct(rootStats.forecast/root.target):'—'}</strong></div>
          </div>
          <div className="stat">
            <div className="stat-label"><CalendarClock/>月間カレンダー</div>
            <div className="stat-value">{info.elapsed}<small className="day-denom"> / {info.days} 日</small></div>
            <div className="day-track">{Array.from({length:info.days},(_,i)=><i key={i} className={i<info.elapsed?'passed':''}/>)}</div>
            <div className="stat-meta"><span>残り {info.remaining} 日</span><strong>{required!==null?fmt(required)+' '+root.unit+'/日':pct(info.fraction)+' 経過'}</strong></div>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="KPIツリー編集">
        <div className="workspace-head">
          <div className="workspace-title"><span className="tree-icon"><GitBranch size={17}/></span><h2>ツリーエディター</h2><span className="node-count">{nodes.length} ノード</span></div>
          <div className="workspace-actions">
            <button type="button" role="switch" aria-checked={moveMode} className="button move-toggle" onClick={toggleMoveMode}>
              <span className="switch-track" aria-hidden="true"/><span>移動モード</span>
            </button>
            <button className="icon-button" onClick={undo} disabled={!past.length||undoLocked} aria-label="元に戻す" aria-keyshortcuts="Control+Z Meta+Z" title={undoLocked?'位置を元に戻すには移動モードをオンに':'元に戻す（Ctrl+Z / ⌘Z）'}><Undo2 size={17}/></button>
            <button className="icon-button" onClick={redo} disabled={!future.length||redoLocked} aria-label="やり直す" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Y Meta+Shift+Z" title={redoLocked?'位置をやり直すには移動モードをオンに':'やり直す（Ctrl+Y / ⌘⇧Z）'}><Redo2 size={17}/></button>
            <span className="header-divider"/>
            <button className="button secondary" onClick={()=>addNode(insertionParent,{task:true})}><Plus size={17}/> タスクを追加</button>
            <button className="button accent" onClick={()=>addNode(insertionParent)}><Plus size={17}/> KPIを追加</button>
          </div>
        </div>
        <div className="workspace-body">
          <div className={'canvas'+(panning?' panning':'')+(moveMode?' move-mode':'')} ref={canvas} onPointerDown={e=>pointerStart(e)} onPointerMove={pointerMove} onPointerUp={e=>pointerEnd(e)} onPointerCancel={e=>pointerEnd(e,true)}>
            <div className="canvas-label"><span/><b>LIVE CANVAS</b><span className="canvas-label-divider"/><span>{year}年{mm}月</span></div>
            {moveMode&&<div className={'hierarchy-hint'+(dropPlan?' active':'')+(dropBlocked?' blocked':'')}>
              <GitBranch size={13} aria-hidden="true"/>
              {dropBlocked?'先に親KPIの集計対象から外してください':dropPlan
                ?dropPlan.parent.id===layout.byId.get(dragging?.id??'')?.parent
                  ?'この位置に並べ替え'
                  :'第'+(dropPlan.depth+1)+'階層 · '+dropPlan.parent.name+'の子に移動'
                :'上下で順番を変更 · 左右で階層を変更'}
            </div>}
            <div className="world" style={{transform:'translate('+view.x+'px,'+view.y+'px) scale('+view.k+')'}}>
              <svg className="connections" aria-hidden="true">
                {layout.nodes.map(parent => {
                  const children = layout.children.get(parent.id) ?? [];
                  if (!children.length) return null;
                  const from = parent.x + W;
                  const to = children[0].x;
                  const trunk = to - BRANCH_RUN;
                  const middle = parent.y + H / 2;
                  const first = children[0].y + H / 2;
                  const last = children[children.length - 1].y + H / 2;
                  return <g key={parent.id} className="edge">
                    <path d={`M${from},${middle} H${trunk} M${trunk},${first} V${last}`}/>
                    <circle cx={from} cy={middle} r="3"/>
                    {children.map(child => {
                      const y = child.y + H / 2;
                      return <g key={child.id} className={'edge'+(selected===child.id?' active':'')}>
                        <path d={`M${trunk},${y} H${to}`}/><circle cx={to} cy={y} r="3"/>
                      </g>;
                    })}
                  </g>;
                })}
              </svg>
              {nodes.filter(n => n.parent !== null && n.cardType!=='task').map(n => {
                const configured = n.yieldPercent !== undefined;
                return <button
                  key={'yield-'+n.id}
                  type="button"
                  className={'yield-edge'+(configured?' configured':'')+(usesYieldTarget(n)?' calculating':'')}
                  style={{left:n.x-BRANCH_RUN/2,top:n.y+H/2}}
                  onClick={()=>openYieldSettings(n.id)}
                  aria-label={n.name+'の歩留まりを設定'}
                  title={configured?(usesYieldTarget(n)?'歩留まりで目標を逆算':'歩留まりを表示'):'歩留まりを追加'}
                >{configured?fmt(n.yieldPercent!)+'%':'+%'}</button>;
              })}
              {dropPlan&&!dropBlocked&&<div className="hierarchy-slot" aria-hidden="true" style={{left:dropPlan.x,top:dropPlan.y,width:W}}/>}
              {nodes.map(n=>{
                const task=n.cardType==='task';
                const p=task?null:performance(n,info.fraction), isRoot=n.parent===null;
                return <div key={n.id} className={'node '+(p?.tone??'neutral')+(task?' task-node':'')+(n.taskDone?' done':'')+(selected===n.id?' selected':'')+(isRoot?' root-node':'')+(dragging?.id===n.id?' dragging':'')+(dropPlan?.parent.id===n.id&&!dropBlocked?' hierarchy-parent':'')} style={{left:n.x,top:n.y,width:W,height:H}} tabIndex={0} role="group" aria-label={task?n.name+' · タスク':n.name+' '+displayActual(n.actual)+n.unit}
                    data-kpi-id={n.id}
                    onPointerDown={e=>pointerStart(e,n)} onPointerUp={e=>{e.stopPropagation();pointerEnd(e);}}>
                  <div className="node-head"><span className={'node-type '+(isRoot?'kgi':'')}>{task?'タスク':isRoot?'KGI':'KPI'}</span>{!task&&<span className="node-source">{n.source==='api'?<><Database size={10}/> API連携</>:n.source==='price'?<>単価×件数</>:n.source==='sum'?<><Sigma size={10}/> 合算</>:<><Pencil size={9}/> 手動</>}</span>}{moveMode&&<GripVertical size={13} className="grip" aria-hidden="true"/>}</div>
                  <div className="node-name">{n.name}</div>
                  {p?<>
                  <div className="node-number">
                    {editing===n.id?<input autoFocus className="inline-value" aria-label={n.name+'の実績'} type="number" min="0" step="any" value={inline} onFocus={e=>e.target.select()} onChange={e=>setInline(e.target.value)} onBlur={()=>commitInline(n.id)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.stopPropagation();setEditing(null);}}}/>:<button className="value-button" onClick={()=>startInline(n)} aria-label={n.name+(n.source==='price'?'の単価設定を開く':n.source==='sum'?'の合算設定を開く':'の実績を編集')}>{displayActual(n.actual)} <small>{n.unit}</small></button>}
                    <span className={'node-pace '+p.tone} title={toneLabel[p.tone]}>
                      {p.tone==='good'?<ArrowUpRight size={10} aria-hidden="true"/>:p.tone==='bad'?<ArrowDownRight size={10} aria-hidden="true"/>:p.tone==='warn'?<Minus size={9} aria-hidden="true"/>:null}{pct(p.pace)}
                    </span>
                  </div>
                  <PaceBar actual={p.progress} expected={n.target>0?(n.kind==='rate'&&info.fraction>0?1:info.fraction):0} tone={p.tone}/>
                  <div className="node-foot"><span>目安 {fmt(p.expected)}</span><span>目標 {displayActual(targets.get(n.id) ?? null)}</span></div>
                  </>:<label className="task-status">
                    <input type="checkbox" checked={Boolean(n.taskDone)} aria-label={n.name+'の完了'} onChange={e=>setTaskDone(n.id,e.target.checked)}/>
                    <span>{n.taskDone?'完了':'未完了'}</span>
                  </label>}
                </div>;
              })}
            </div>
            <div className="canvas-controls">
              <button className="icon-button" onClick={()=>zoom(1/1.2)} disabled={!moveMode} aria-label="縮小"><Minus size={15}/></button><span className="zoom-value">{pct(view.k)}</span><button className="icon-button" onClick={()=>zoom(1.2)} disabled={!moveMode} aria-label="拡大"><Plus size={15}/></button><span className="header-divider"/><button className="icon-button" aria-label="全体を表示" title="全体を表示" disabled={!moveMode} onClick={()=>{if(moveMode)fit(layout.nodes);}}><Maximize size={15}/></button>{!moveMode&&<span className="canvas-lock"><Lock size={11} aria-hidden="true"/>固定中</span>}
            </div>
          </div>

          <aside className="sidebar" aria-label={selectedNode?.cardType==='task'?'タスクの詳細':selectedNode?'KPIの詳細':'ボトルネック'}>
            {selectedNode&&draft?.id===selectedNode.id?<div className="inspector">
              <div className="rail-kicker"><ScanLine size={14}/> NODE INSPECTOR <button className="icon-button close-inspector" aria-label="詳細を閉じる" onClick={()=>pick(null)}><X size={16}/></button></div>
              <h3>{draft.cardType==='task'?'タスクを編集':'KPIを編集'}</h3>
              <p className="rail-description">項目の設定や親子関係を変更できます。</p>
              <form onSubmit={e=>{e.preventDefault();saveDraft();}} className="inspector-form">
                <label>{draft.cardType==='task'?'タスク名':'指標名'}<input id="metric-name" required maxLength={60} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
                {draft.cardType!=='task'&&<>
                <div className="input-pair">
                  <label>月間目標{draftAutoTarget
                    ? <input readOnly value={displayActual(yieldPreview)}/>
                    : <input type="number" min="0" max={1e12} step="any" required value={Number.isNaN(draft.target)?'':draft.target} onChange={e=>setDraft({...draft,target:e.target.valueAsNumber})}/>}</label>
                  <label>単位<input maxLength={12} value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></label>
                </div>
                <label>指標の種類<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as Metric['kind']})}><option value="total">積み上げ（売上・件数など）</option><option value="rate">比率・平均（固定目標）</option></select></label>
                {draft.parent!==null&&<label>歩留まり（%・任意）
                  <input
                    id="yield-percent"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    placeholder="例: 50"
                    value={draft.yieldPercent??''}
                    onChange={e=>updateYieldPercent(e.target.value===''?undefined:e.target.valueAsNumber)}
                  />
                </label>}
                {draft.parent!==null&&draft.yieldPercent!==undefined&&<label className="channel-sync-option">
                  <input type="checkbox" checked={Boolean(draft.manualYieldTarget)} onChange={e=>setDraft({...draft,manualYieldTarget:e.target.checked})}/>
                  <span>月間目標を手入力する</span>
                </label>}
                {draftAutoTarget&&<output className="yield-preview">
                  <span>左の月間目標 ÷ 歩留まり</span>
                  <strong>{yieldPreview===null?'—':fmt(yieldPreview)+(draft.unit?' '+draft.unit:'')}</strong>
                </output>}
                {draftAutoTarget&&draft.yieldPercent===0&&<p className="yield-note">0%では目標を逆算できません。</p>}
                <label>実績の入力方法
                  <select value={draft.source} onChange={e=>{
                    const source = e.target.value as Metric['source'];
                    if(source==='price') {
                      const options=(layout.children.get(draft.id) ?? []).filter(isCountMetric);
                      setDraft({...draft,source,kind:'total',unit:sumUnitFactor('円',draft.unit)===null?'円':draft.unit,
                        unitPrice:draft.unitPrice ?? {amount:Number.NaN,unit:'円',quantityId:options.length===1?options[0].id:''}});
                    } else {
                      setDraft({...draft,source,kind:source==='sum'?'total':draft.kind});
                    }
                    setDraftError('');
                  }}>
                    <option value="manual">手動入力</option>
                    <option value="sum">選択して合算</option>
                    <option value="price">単価 × 件数</option>
                    {!sample&&<option value="api">外部API連携</option>}
                  </select>
                </label>
                {draftManualActual&&<label>実績<input type="number" min="0" max={1e12} step="any" required value={Number.isNaN(draft.actual)?'':draft.actual} onChange={e=>setDraft({...draft,actual:e.target.valueAsNumber})}/></label>}
                {draft.source==='api'&&<label>連携キー<input required maxLength={100} placeholder="例: total_revenue" list="feed-key-options" value={draft.key} onChange={e=>setDraft({...draft,key:e.target.value})}/></label>}
                {priceDraft&&priceSettings&&<fieldset className="sum-fields">
                  <legend>単価と件数</legend>
                  <div className="input-pair">
                    <label>単価<input type="number" min="0" max={1e12} step="any" required
                      value={Number.isNaN(priceSettings.amount)?'':priceSettings.amount}
                      onChange={e=>setDraft({...priceDraft,unitPrice:{...priceSettings,amount:e.target.valueAsNumber}})}/></label>
                    <label>単価の単位<select value={priceSettings.unit}
                      onChange={e=>setDraft({...priceDraft,unitPrice:{...priceSettings,unit:e.target.value as '円'|'万円'}})}>
                      <option value="円">円</option><option value="万円">万円</option>
                    </select></label>
                  </div>
                  <label>件数KPI<select required value={priceSettings.quantityId}
                    onChange={e=>setDraft({...priceDraft,unitPrice:{...priceSettings,quantityId:e.target.value}})}>
                    <option value="">直下のKPIを選択</option>
                    {priceOptions.map(node=><option key={node.id} value={node.id}>{node.name}（{node.unit}）</option>)}
                  </select></label>
                  {!priceOptions.length&&<p>直下に「件」や「社」などの単位のKPIを追加してください。</p>}
                  <output className="sum-preview">
                    <span>金額プレビュー</span>
                    <strong>{pricePreview?.ok&&pricePreview.value!==null?fmt(pricePreview.value)+' '+priceDraft.unit:'—'}</strong>
                  </output>
                </fieldset>}
                {sumDraft&&<fieldset className="sum-fields">
                  <legend>合算するKPI</legend>
                  <p>直下のKPIをまとめて選べます。円・万円などの金額単位は自動で換算します。</p>
                  {sumOptions.length ? <>
                    <div className="sum-actions">
                      <button type="button" className="button secondary" disabled={!eligibleSumIds.length||eligibleSumIds.every(id=>selectedSumIds.includes(id))} onClick={()=>setSumIds(eligibleSumIds)}>すべて選択</button>
                      <button type="button" className="button secondary" disabled={!selectedSumIds.length} onClick={()=>setSumIds([])}>選択を解除</button>
                    </div>
                    <div className="sum-choices">
                      {sumOptions.map(n=>{
                        const compatible=eligibleSumIds.includes(n.id);
                        const checked=selectedSumIds.includes(n.id);
                        return <label key={n.id} className="sum-choice">
                          <input type="checkbox" checked={checked} disabled={!compatible&&!checked} onChange={e=>setSumIds(e.target.checked?[...selectedSumIds,n.id]:selectedSumIds.filter(id=>id!==n.id))}/>
                          <span>{n.name}{n.unit?'（'+n.unit+'）':''}{!compatible&&<small>対象外</small>}</span>
                        </label>;
                      })}
                    </div>
                  </> : <p>直下にKPIを追加すると選択できます。</p>}
                  <output className="sum-preview">
                    <span>合算プレビュー</span>
                    <strong>{sumPreview?.ok&&sumPreview.value!==null?fmt(sumPreview.value)+(sumDraft.unit?' '+sumDraft.unit:''):'—'}</strong>
                  </output>
                </fieldset>}
                {!sample&&<label className="channel-sync-option">
                  <input type="checkbox" checked={Boolean(draft.channelSync)} onChange={e=>setDraft({...draft,channelSync:e.target.checked})}/>
                  <span>連携先の内訳KPIを自動追加</span>
                </label>}
                </>}
                {selectedNode.parent!==null&&<label>親のKPI<select value={draft.parent??''} onChange={e=>setDraft({...draft,parent:e.target.value})}>{base.filter(n=>n.cardType!=='task'&&!descendants.has(n.id)).map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}
                {draftError&&<p className="field-error">{draftError}</p>}
                <button type="submit" className="button accent full"><Check size={15}/> 変更を保存</button>
              </form>
              {selectedNode.parent!==null&&<button type="button" className="button secondary full" onClick={duplicateCard}><Copy size={15}/>{layout.children.get(selectedNode.id)?.length?'子カードごと複製':'カードを複製'}</button>}
              {selectedNode.parent!==null&&(deleteOpen?<div className="confirm-delete"><p>{draft.cardType==='task'?'このタスクを削除しますか？':'このKPIを削除しますか？ 子のカードはひとつ上の親に移ります。'}</p><button className="button secondary" onClick={()=>setDeleteOpen(false)}>戻る</button><button className="button danger" onClick={removeNode}>削除する</button></div>:<button className="delete-link" onClick={()=>setDeleteOpen(true)}>{draft.cardType==='task'?'このタスクを削除':'このKPIを削除'}</button>)}
            </div>:<>
              <div className="rail-kicker"><Crosshair size={14}/> FOCUS AREA</div>
              <div className="rail-heading"><h3>ボトルネック</h3><span className="issue-count">{warnings.length} 件</span></div>
              <p className="rail-description">目安に対するペースが低い順に表示。<br/>{moveMode?'クリックすると対象のKPIに移動します。':'クリックすると対象のKPIを編集できます。'}</p>
              <div className="issues">
                {warnings.length===0?<div className="no-issues"><Check size={18}/>{info.fraction===0?'月が始まると判定が表示されます。':'注意が必要なKPIはありません。'}</div>:warnings.map(({n,pace,expected,gap,tone},i)=><button className={'issue '+tone} key={n.id} onClick={()=>focusNode(n)}>
                  <span className="issue-index">{String(i+1).padStart(2,'0')}</span>
                  <span className="issue-content"><span className="issue-title"><strong>{n.name}</strong><b>{pct(pace)}</b></span><span className="issue-detail"><span>{displayActual(n.actual)} / 目安 {fmt(expected)} {n.unit}</span><span className={tone}>{gap===null?'—':signed(gap)}</span></span><span className="issue-bar"><i style={{width:pct(cap(pace??0,0,1))}}/></span></span>
                </button>)}
              </div>
              <div className="rail-guide"><Mouse size={15}/><div><strong>操作のヒント</strong><p>{moveMode?'カードや背景をドラッグして移動。':'カードと表示位置は固定中です。'}<br/>カードの数値をクリックして直接入力。</p></div></div>
            </>}
          </aside>
        </div>
        <footer className="workspace-foot">
          <div className="legend"><span><i className="good"/> 順調 {counts.good}</span><span><i className="warn"/> 注意 {counts.warn}</span><span><i className="bad"/> ビハインド {counts.bad}</span><span className="marker-legend"><i/> 目安ライン</span></div>
          <span className="timezone"><Layers3 size={13}/> 暦日ベース · JST{board.months[month]?'':Object.keys(board.months).some(m=>m<month)?' · 前月以前の構成':' · 初期構成'}</span>
        </footer>
      </section>
    </main>
    <datalist id="feed-key-options">{feedOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</datalist>
    {toast&&<div className="toast" role="status"><Activity size={15}/>{toast}</div>}
    {panel&&<div className="overlay" onClick={()=>setPanel(null)}><section className="dialog" role="dialog" aria-modal="true" aria-label={panel==='sync'?'データ連携':'使い方'} onClick={e=>e.stopPropagation()}>
      <div className="dialog-title"><span className="tree-icon">{panel==='sync'?<Database size={18}/>:<CircleHelp size={18}/>}</span><h2>{panel==='sync'?'データ連携':'ツリーの使い方'}</h2><button autoFocus className="icon-button" aria-label="閉じる" onClick={()=>setPanel(null)}><X size={20}/></button></div>
      {panel==='sync'?<>
        <p>自分の集計APIから、月ごとの実績を取り込めます。認証不要のHTTPS APIで、このページからのアクセスを許可してください。</p>
        <form className="inspector-form" onSubmit={saveFeed}>
          <label>連携先URL<input type="url" value={feedDraft} placeholder="https://example.com/kpi" disabled={syncing} onChange={event=>setFeedDraft(event.target.value)}/></label>
          <button className="button secondary" type="submit" disabled={syncing}>連携先を保存</button>
        </form>
        <div className={'connection-state '+(configured?'good':'warn')}>{configured?<CloudCheck size={18}/>:<TriangleAlert size={17}/>} {configured?'連携先を設定済み':'連携先は未設定です'}</div>
        <details><summary>APIの応答形式</summary><p><code>GET ?month=YYYY-MM</code> に、集計値だけをJSONで返してください。</p><pre>{'{"metrics":{"completed":12}}'}</pre></details>
        {feedOptions.length>0&&<details><summary>取得した連携キー（{feedOptions.length}件）</summary>
          <ul className="feed-keys">{feedOptions.map(option=><li key={option.key}><span>{option.label}</span><code>{option.key}</code></li>)}</ul>
        </details>}
        <label className="auto-row"><span><strong>自動同期</strong><small>画面を開いている間、1分ごとに更新</small></span><input type="checkbox" checked={board.auto} disabled={!configured} onChange={e=>change({...state.current,auto:e.target.checked})}/></label>
        <div className="dialog-actions"><span>{lastSync?'最終同期 '+lastSync:'この月の同期履歴なし'}</span><button className="button accent" onClick={()=>sync()} disabled={!configured||syncing}><RefreshCw size={15} className={syncing?'spinning':''}/>{syncing?'同期中':'今すぐ同期'}</button></div>
      </>:<>
        <div className="help-item"><Pencil size={16}/><div><strong>数値をその場で更新</strong><p>カードの実績をクリックして入力し、Enterで確定します。カード本体を選ぶと目標・単位・親KPIを編集できます。</p></div></div>
        <div className="help-item"><CornerDownRight size={17}/><div><strong>ツリーを組み替える</strong><p>「移動モード」をオンにすると、カードの移動、背景のドラッグ、ズームができます。カードを上下にドラッグすると同じ親の中で順番が変わり、別の列にドロップすると表示された親の下に移動します。「KPIを追加」で選択中のカードに子を作れます。</p></div></div>
        <div className="help-item"><Check size={16}/><div><strong>KPIの下にタスクを追加</strong><p>KPIを選んで「タスクを追加」を押します。カードのチェックボックスで完了を切り替えられます。</p></div></div>
        <div className="help-item"><Undo2 size={16}/><div><strong>キーボードで編集</strong><p>カードを選んで Enter を押すと、同じ種類のカードを同じ階層に追加します。Ctrl+Z で元に戻し、Ctrl+Y でやり直せます。Mac は ⌘Z／⌘⇧Z です。</p></div></div>
        <div className="help-item"><Target size={17}/><div><strong>今日の目安と比べる</strong><p>積み上げ型の目安は月間目標 × 経過日数 ÷ 月の日数。比率・平均は月間目標と比較します。目安の100%以上で順調、90%以上で注意、それ未満でビハインドです。</p></div></div>
      </>}
    </section></div>}
  </div>;
}
