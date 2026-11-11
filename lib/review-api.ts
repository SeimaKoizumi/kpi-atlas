const reviewOrigin='https://kpi-atlas-review-api.koizumi-legitconsult.chatgpt.site';
export const boardStorageKey='kpi-atlas.public.board.v1';

export async function reviewApi(path:string,token?:string,body?:unknown){
  const response=await fetch(reviewOrigin+path,{
    method:body===undefined?'GET':'POST',
    cache:'no-store',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(result?.error??'評価サービスに接続できませんでした。');
  return result;
}
