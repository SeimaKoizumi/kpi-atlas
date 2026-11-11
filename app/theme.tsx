'use client';

import {createContext,useContext,useEffect,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {Palette,X} from 'lucide-react';
import './theme.css';

const palettes=[
  ['アトラス・ネイビー','#0a1020','#17243b','#80afff'],
  ['クラシックブルー','#101c34','#203352','#82b6ff'],
  ['インディゴの夜','#181533','#2e2950','#b8a6ff'],
  ['ミッドナイト・ゴールド','#161823','#2d3142','#f2c56d'],
  ['グラファイト','#15181e','#2a3039','#9ed5f4'],
  ['深海ティール','#0b242b','#153c41','#5ee0d0'],
  ['フォレスト','#11261e','#213d30','#90d8a5'],
  ['オリーブと真鍮','#25271a','#393d26','#dec579'],
  ['ワインレッド','#2a1520','#462537','#f6a5bf'],
  ['ダークモカ','#251b18','#3b2e28','#f1b690'],
  ['ライトスレート','#edf1f7','#ffffff','#3458b9'],
  ['スカイブルー','#eaf5ff','#ffffff','#2166b9'],
  ['ペールミント','#e7f5ef','#ffffff','#16725e'],
  ['セージグリーン','#edf0e7','#fafbf6','#4a704e'],
  ['ラベンダー','#f0eafa','#fdfaff','#704cb0'],
  ['ローズクォーツ','#f8e9ef','#fff9fb','#9b3f66'],
  ['サンドベージュ','#f3eee1','#fffcf5','#85592b'],
  ['コーラル','#fff0e9','#fffaf6','#ac4836'],
  ['インクと紙','#ece9e1','#fffdf7','#384a61'],
  ['シトラス','#faf3d8','#fffdf3','#785d00'],
] as const;

type Colors=[string,string,string];
type Theme={preset:number|null;colors:Colors};
const defaultTheme:Theme={preset:0,colors:[...palettes[0].slice(1)] as Colors};
const storageKey='kpi-atlas.theme.v1';
const ThemeContext=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}>({
  theme:defaultTheme,setTheme:()=>{},
});
const colorPattern=/^#[0-9a-f]{6}$/i;

function ink(hex:string) {
  const channels=hex.slice(1).match(/../g)!.map(value=>{
    const s=Number.parseInt(value,16)/255;
    return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
  });
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.179?'#111827':'#ffffff';
}

export function AtlasTheme({children}:{children:ReactNode}) {
  const [theme,update]=useState(defaultTheme);
  useEffect(()=>{
    try {
      const value=JSON.parse(localStorage.getItem(storageKey)??'null') as Theme|null;
      if(value&&Array.isArray(value.colors)&&value.colors.length===3&&value.colors.every(color=>colorPattern.test(color)))update(value);
    }catch{}
  },[]);
  function setTheme(value:Theme) {
    update(value);
    try { localStorage.setItem(storageKey,JSON.stringify(value)); }catch{}
  }
  const [main,sub,accent]=theme.colors;
  const style={
    '--theme-main':main,'--theme-sub':sub,'--theme-accent':accent,
    '--theme-main-ink':ink(main),'--theme-sub-ink':ink(sub),'--theme-accent-ink':ink(accent),
  } as CSSProperties;
  return <ThemeContext.Provider value={{theme,setTheme}}>
    <div className={theme.preset===0?'':'atlas-custom-theme'} style={style}>{children}</div>
  </ThemeContext.Provider>;
}

export function ThemeButton() {
  const {theme,setTheme}=useContext(ThemeContext);
  const [open,setOpen]=useState(false);
  return <>
    <button type="button" className="icon-button help-button" aria-label="配色を編集" title="配色を編集" onClick={()=>setOpen(true)}><Palette size={18}/></button>
    {open&&<div className="overlay" onClick={()=>setOpen(false)}>
      <section className="dialog theme-dialog" role="dialog" aria-modal="true" aria-label="配色を編集" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
        if(event.key==='Escape'){event.stopPropagation();setOpen(false);}
      }}>
        <div className="dialog-title"><h2>配色を編集</h2><button type="button" autoFocus className="icon-button" aria-label="閉じる" onClick={()=>setOpen(false)}><X size={20}/></button></div>
        <div className="theme-colors">{['メイン','サブ','アクセント'].map((label,index)=><label key={label}>
          <span>{label}</span>
          <input type="color" value={theme.colors[index]} onInput={event=>{
            const colors=[...theme.colors] as Colors;
            colors[index]=event.currentTarget.value;
            setTheme({preset:null,colors});
          }}/>
          <code>{theme.colors[index]}</code>
        </label>)}</div>
        <div className="theme-presets" aria-label="配色テーマ">{palettes.map(([title,main,sub,accent],index)=><button key={title}
          type="button" aria-pressed={theme.preset===index} onClick={()=>setTheme({preset:index,colors:[main,sub,accent]})}>
          <span className="theme-swatches" aria-hidden="true">{[main,sub,accent].map((color,swatch)=><i key={swatch} style={{background:color}}/>)}</span>
          <span>{title}</span>
        </button>)}</div>
      </section>
    </div>}
  </>;
}
