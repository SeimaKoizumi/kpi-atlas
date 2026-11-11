import {useEffect,useRef,useState} from 'react';
import {reviewApi} from '../lib/review-api';
import './member-reviews.css';

type GoogleIdentity={
  initialize(options:{client_id:string;callback:(value:{credential:string})=>void;auto_select:boolean}):void;
  renderButton(target:HTMLElement,options:{theme:string;size:string;text:string;locale:string}):void;
  disableAutoSelect():void;
};
declare global{interface Window{google?:{accounts?:{id?:GoogleIdentity}}}}
let library:Promise<GoogleIdentity>|undefined;
function googleLibrary(){
  if(!library)library=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.onload=()=>{
      const identity=window.google?.accounts?.id;
      if(identity)resolve(identity);
      else reject(Error('Googleログインを読み込めませんでした。'));
    };
    script.onerror=()=>reject(Error('Googleログインを読み込めませんでした。'));
    document.head.appendChild(script);
  });
  return library;
}

export default function ReviewLogin({onToken}:{onToken:(token:string)=>void}){
  const target=useRef<HTMLDivElement>(null);
  const [notice,setNotice]=useState('Googleログインを準備しています。');
  useEffect(()=>{
    let active=true;
    reviewApi('/config').then(async({clientId})=>{
      if(!active)return;
      if(typeof clientId!=='string'){setNotice('評価のGoogleログインは設定待ちです。');return;}
      const id=await googleLibrary();
      if(!active||!target.current)return;
      id.initialize({client_id:clientId,callback:({credential})=>{if(active&&credential)onToken(credential);},auto_select:false});
      id.renderButton(target.current,{theme:'outline',size:'large',text:'signin_with',locale:'ja'});
      setNotice('');
    }).catch(error=>{if(active)setNotice(error.message);});
    return()=>{active=false;};
  },[onToken]);
  return <main className="review-preview">
    <header className="review-header"><a href="#tree">KPIツリーへ</a></header>
    <h1>メンバーの月次評価</h1>
    <p className="review-description">登録されたGoogleアカウントでログインしてください。</p>
    <div ref={target}/>
    {notice&&<p role="status">{notice}</p>}
  </main>;
}
