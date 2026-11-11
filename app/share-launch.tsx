'use client';

import {useState} from 'react';
import {Share2,X} from 'lucide-react';
import {resolveActuals,type Board,type Metric} from '../lib/atlas';

const sharedOrigin='https://kpi-atlas-share.koizumi-legitconsult.chatgpt.site';

function snapshot(month:string,nodes:Metric[]):Board {
  const actuals=resolveActuals(nodes);
  const shared=nodes.map((node):Metric=>({
    id:node.id,parent:node.parent,name:node.name,kind:node.kind,unit:node.unit,
    source:node.source==='sum'||node.source==='price'?node.source:'manual',key:'',
    actual:node.source==='sum'||node.source==='price'?0:actuals.get(node.id)??0,target:node.target,
    x:node.x,y:node.y,order:node.order,sumIds:node.sumIds,unitPrice:node.unitPrice,
    yieldPercent:node.yieldPercent,manualYieldTarget:node.manualYieldTarget,
    cardType:node.cardType,taskDone:node.taskDone,
  }));
  return {months:{[month]:shared},auto:false,lastSync:{}};
}

export function ShareLaunch({variant,month,nodes}:{variant:'private'|'public';month:string;nodes:Metric[]}) {
  const [open,setOpen]=useState(false);
  const [notice,setNotice]=useState('');
  function launch() {
    const board=snapshot(month,nodes);
    const child=window.open(sharedOrigin+'/?import='+variant,'_blank');
    if(!child){setNotice('ポップアップを許可するか、共有用ファイルを使ってください。');return;}
    const timeout=window.setTimeout(()=>window.removeEventListener('message',receive),12000);
    function receive(event:MessageEvent) {
      if(event.origin!==sharedOrigin||event.source!==child||event.data?.type!=='atlas-share-ready')return;
      child?.postMessage({type:'atlas-share-draft',board},sharedOrigin);
      window.removeEventListener('message',receive);
      window.clearTimeout(timeout);
    }
    window.addEventListener('message',receive);
  }
  function download() {
    const file=new Blob([JSON.stringify(snapshot(month,nodes))],{type:'application/json'});
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;link.download='kpi-atlas-'+month+'.json';link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <button type="button" className="button secondary share-launch-button" onClick={()=>setOpen(true)}><Share2 size={15}/>共有</button>
    {open&&<div className="overlay" onClick={()=>setOpen(false)}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label="ツリーを共有" onClick={event=>event.stopPropagation()}
        onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}}}>
        <div className="dialog-title"><h2>ツリーを共有</h2><button type="button" autoFocus className="icon-button" aria-label="閉じる" onClick={()=>setOpen(false)}><X size={20}/></button></div>
        <p>{month}のツリーのコピーで共同編集を始めます。カードの名前、実績、目標、タスクの完了状態が引き継がれます。</p>
        <button type="button" className="button accent" onClick={launch}>共有用コピーを開く</button>
        <details><summary>ファイルから取り込む</summary>
          <p>共有画面で取り込めるJSONを保存します。</p>
          <div className="dialog-actions"><button type="button" className="button secondary" onClick={download}>共有用ファイルを保存</button><a href={sharedOrigin} target="_blank" rel="noreferrer">共有画面を開く</a></div>
        </details>
        {notice&&<p role="status">{notice}</p>}
      </section>
    </div>}
  </>;
}
