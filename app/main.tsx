import { createRoot } from 'react-dom/client';
import {useEffect,useState} from 'react';
import Atlas from './atlas';
import ReviewLogin from './review-login';
import MemberReviews from './member-reviews';
import './globals.css';

function App(){
  const [path,setPath]=useState(location.hash);
  const [token,setToken]=useState('');
  useEffect(()=>{
    const update=()=>setPath(location.hash);
    window.addEventListener('hashchange',update);
    return()=>window.removeEventListener('hashchange',update);
  },[]);
  if(path!=='#reviews')return <Atlas reviewToken={token}/>;
  return token?<MemberReviews token={token} onSignOut={()=>{
    window.google?.accounts?.id?.disableAutoSelect();
    setToken('');
  }}/>:<ReviewLogin onToken={setToken}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
