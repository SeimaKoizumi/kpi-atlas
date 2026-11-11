'use client';

import {createContext,useContext,useEffect,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {Palette,X} from 'lucide-react';
import './theme.css';

const palettes=[
  ['アトラス・ネイビー','#0a1020','#17243b','#80afff','#253550'],
  ['クラシックブルー','#101c34','#203352','#82b6ff','#2b4161'],
  ['インディゴの夜','#181533','#2e2950','#b8a6ff','#423c68'],
  ['ミッドナイト・ゴールド','#161823','#2d3142','#f2c56d','#474158'],
  ['グラファイト','#15181e','#2a3039','#9ed5f4','#3c4552'],
  ['深海ティール','#0b242b','#153c41','#5ee0d0','#245457'],
  ['フォレスト','#11261e','#213d30','#90d8a5','#315644'],
  ['オリーブと真鍮','#25271a','#393d26','#dec579','#505337'],
  ['ワインレッド','#2a1520','#462537','#f6a5bf','#5e3449'],
  ['ダークモカ','#251b18','#3b2e28','#f1b690','#554038'],
  ['ライトスレート','#edf1f7','#ffffff','#3458b9','#dce6f3'],
  ['スカイブルー','#eaf5ff','#ffffff','#2166b9','#d8ebfa'],
  ['ペールミント','#e7f5ef','#ffffff','#16725e','#d4ece3'],
  ['セージグリーン','#edf0e7','#fafbf6','#4a704e','#e0e8d7'],
  ['ラベンダー','#f0eafa','#fdfaff','#704cb0','#e9def7'],
  ['ローズクォーツ','#f8e9ef','#fff9fb','#9b3f66','#f4dce8'],
  ['サンドベージュ','#f3eee1','#fffcf5','#85592b','#efe4cf'],
  ['コーラル','#fff0e9','#fffaf6','#ac4836','#f9dfd5'],
  ['インクと紙','#ece9e1','#fffdf7','#384a61','#e5dfd1'],
  ['シトラス','#faf3d8','#fffdf3','#785d00','#f2e6b7'],
] as const;

type Colors=[string,string,string,string];
type Theme={preset:number|null;colors:Colors};
const defaultTheme:Theme={preset:0,colors:[...palettes[0].slice(1)] as Colors};
const storageKey='kpi-atlas.theme.v1';
const ThemeContext=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}>({
  theme:defaultTheme,setTheme:()=>{},
});
const colorPattern=/^#[0-9a-f]{6}$/i;

function luminance(hex:string) {
  const channels=hex.slice(1).match(/../g)!.map(value=>{
    const s=Number.parseInt(value,16)/255;
    return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
  });
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}

const darkInk='#111827';
const darkInkLuminance=luminance(darkInk);

function ink(hex:string) {
  const light=luminance(hex);
  if((light+.05)/(darkInkLuminance+.05)>=4.5)return darkInk;
  return light>.179?'#000000':'#ffffff';
}

export function AtlasTheme({children}:{children:ReactNode}) {
  const [theme,update]=useState(defaultTheme);
  useEffect(()=>{
    try {
      const value=JSON.parse(localStorage.getItem(storageKey)??'null') as {preset?:number|null;colors?:unknown}|null;
      if(!value||!Array.isArray(value.colors)||![3,4].includes(value.colors.length)||
        !value.colors.every(color=>typeof color==='string'&&colorPattern.test(color)))return;
      const [main,sub,accent,badge]=value.colors;
      const preset=typeof value.preset==='number'&&palettes[value.preset]?value.preset:null;
      const fallbackBadge=preset===null
        ? (ink(sub)==='#ffffff'?'#26374b':'#dce6f3')
        : palettes[preset][4];
      update({preset,colors:[main,sub,accent,badge??fallbackBadge]});
    }catch{}
  },[]);
  function setTheme(value:Theme) {
    update(value);
    try { localStorage.setItem(storageKey,JSON.stringify(value)); }catch{}
  }
  const [main,sub,accent,badge]=theme.colors;
  const style={
    '--theme-main':main,'--theme-sub':sub,'--theme-accent':accent,'--theme-badge':badge,
    '--theme-main-ink':ink(main),'--theme-sub-ink':ink(sub),'--theme-accent-ink':ink(accent),'--theme-badge-ink':ink(badge),
  } as CSSProperties;
  return <ThemeContext.Provider value={{theme,setTheme}}>
    <div className={theme.preset===0?'atlas-theme':'atlas-theme atlas-custom-theme'} data-light-surface={ink(sub)!=='#ffffff' || undefined} style={style}>{children}</div>
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
        <div className="theme-colors">{['メイン','サブ','アクセント','案内・バッジ'].map((label,index)=><label key={label}>
          <span>{label}</span>
          <input type="color" value={theme.colors[index]} onInput={event=>{
            const colors=[...theme.colors] as Colors;
            colors[index]=event.currentTarget.value;
            setTheme({preset:null,colors});
          }}/>
          <code>{theme.colors[index]}</code>
        </label>)}</div>
        <div className="theme-presets" aria-label="配色テーマ">{palettes.map(([title,main,sub,accent,badge],index)=><button key={title}
          type="button" aria-pressed={theme.preset===index} onClick={()=>setTheme({preset:index,colors:[main,sub,accent,badge]})}>
          <span className="theme-swatches" aria-hidden="true">{[main,sub,accent,badge].map((color,swatch)=><i key={swatch} style={{background:color}}/>)}</span>
          <span>{title}</span>
        </button>)}</div>
      </section>
    </div>}
  </>;
}
