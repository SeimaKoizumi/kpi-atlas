import { z } from 'zod';

export const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const number = z.number().finite().min(0).max(1e12);
export const metricSchema = z.object({
  id: z.string().min(1).max(80), parent: z.string().max(80).nullable(),
  name: z.string().trim().min(1).max(60), unit: z.string().max(12),
  kind: z.enum(['total','rate']), source: z.enum(['manual','api','sum']),
  cardType: z.literal('task').optional(),
  taskDone: z.boolean().optional(),
  channelSync: z.boolean().optional(),
  yieldPercent: z.number().min(0).max(100).optional(),
  manualYieldTarget: z.boolean().optional(),
  sumIds: z.array(z.string().min(1).max(80)).max(99).optional(),
  key: z.string().max(100), actual: number, target: number,
  order: z.number().int().min(0).max(99).optional(),
  x: z.number().min(0).max(10000), y: z.number().min(0).max(10000),
});
export const boardSchema = z.object({
  months: z.record(z.string().regex(monthPattern), z.array(metricSchema).min(1).max(100)).refine(m => Object.keys(m).length <= 120),
  auto: z.boolean(), lastSync: z.record(z.string().regex(monthPattern), z.string().max(40)),
}).superRefine(({months}, ctx) => {
  for (const nodes of Object.values(months)) {
    const map = new Map(nodes.map(n => [n.id,n]));
    if (map.size !== nodes.length || nodes.filter(n => n.parent === null).length !== 1) {
      ctx.addIssue({code:'custom',message:'Invalid tree'}); return;
    }
    for (const n of nodes) {
      if ((n.cardType==='task' && (n.parent===null || n.source!=='manual' || n.yieldPercent!==undefined || n.channelSync)) ||
          (n.parent!==null && map.get(n.parent)?.cardType==='task')) {
        ctx.addIssue({code:'custom',message:'Tasks must be placed below a KPI'}); return;
      }
      const yieldError = yieldSettingsError(n);
      if (yieldError) {
        ctx.addIssue({code:'custom',message:yieldError}); return;
      }
      if (n.source === 'sum') {
        const result = sumActual(n, nodes);
        if (!result.ok) {
          ctx.addIssue({code:'custom',message:result.message}); return;
        }
      }
      const seen = new Set([n.id]);
      let p = n.parent;
      while (p !== null) {
        const parent = map.get(p);
        if (!parent || seen.has(p)) {ctx.addIssue({code:'custom',message:'Invalid parent'});return;}
        seen.add(p); p = parent.parent;
      }
    }
  }
});
export type Metric = z.infer<typeof metricSchema>;
export type Board = z.infer<typeof boardSchema>;

const yenUnits = new Map([
  ['円', 1], ['千円', 1e3], ['万円', 1e4], ['百万円', 1e6], ['億円', 1e8],
]);

export function sumUnitFactor(from: string, to: string): number | null {
  const source = from.normalize('NFKC').trim();
  const target = to.normalize('NFKC').trim();
  if (source === target) return 1;
  const sourceFactor = yenUnits.get(source);
  const targetFactor = yenUnits.get(target);
  return sourceFactor && targetFactor ? sourceFactor / targetFactor : null;
}

type SumResult = {ok: true; value: number | null} | {ok: false; message: string};
export function sumActual(
  aggregate: Metric,
  nodes: Metric[],
  readActual: (node: Metric) => number | null = node => node.actual,
): SumResult {
  if (aggregate.kind !== 'total') {
    return {ok:false,message:'合算は積み上げ型のKPIで使えます。'};
  }

  const ids = aggregate.sumIds ?? [];
  if (!ids.length || ids.some(id => !id)) {
    return {ok:false,message:'合算するKPIを選択してください。'};
  }
  if (new Set(ids).size !== ids.length) {
    return {ok:false,message:'同じKPIは一度だけ選択できます。'};
  }

  let value = 0;
  let unavailable = false;
  for (const id of ids) {
    const node = nodes.find(n => n.id === id && n.parent === aggregate.id && n.cardType!=='task');
    if (!node) return {ok:false,message:'合算対象はこのKPIの直下から選んでください。'};
    const factor = sumUnitFactor(node.unit, aggregate.unit);
    if (node.kind !== 'total' || factor === null) {
      return {ok:false,message:node.name+'を合算できません。対象の種類と単位を確認してください。'};
    }
    const actual = readActual(node);
    if (actual === null) unavailable = true;
    else value += actual * factor;
  }
  return {ok:true,value:unavailable || !Number.isFinite(value) ? null : value};
}

export function yieldSettingsError(node: Metric): string | null {
  const percent = node.yieldPercent;
  if (node.parent === null && percent !== undefined) {
    return '歩留まりは親があるKPIに設定できます。';
  }
  if (percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    return '歩留まりは0〜100%で入力してください。';
  }
  return null;
}

const countUnits = new Set(['件','人','名','回','社','通','枠','本','個','台']);

export function requiredForYield(leftTarget: number | null, percent: number, metric: Pick<Metric,'kind'|'unit'>): number | null {
  if (leftTarget === null || percent <= 0 || percent > 100) return null;
  if (leftTarget === 0) return 0;

  const required = leftTarget / (percent / 100);
  if (!Number.isFinite(required)) return null;
  if (metric.kind !== 'total' || !countUnits.has(metric.unit.normalize('NFKC').trim())) return required;

  // Skip extra rounding when floating point division lands just above an integer.
  const nearest = Math.round(required);
  return Math.abs(required - nearest) <= Number.EPSILON * required * 2
    ? nearest
    : Math.ceil(required);
}

type YieldTargetSettings = Pick<Metric,'parent'|'yieldPercent'|'manualYieldTarget'>;

export function usesYieldTarget(node: YieldTargetSettings): node is YieldTargetSettings & {yieldPercent: number} {
  return node.parent !== null && node.yieldPercent !== undefined && !node.manualYieldTarget;
}

export function resolveTargets(nodes: Metric[]): Map<string, number | null> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const targets = new Map<string, number | null>();
  function resolve(node: Metric): number | null {
    const existing = targets.get(node.id);
    if (existing !== undefined) return existing;
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    const target = usesYieldTarget(node)
      ? requiredForYield(parent ? resolve(parent) : null, node.yieldPercent, node)
      : node.target;
    targets.set(node.id, target);
    return target;
  }
  for (const node of nodes) resolve(node);
  return targets;
}

export function resolveActuals(nodes: Metric[]): Map<string, number | null> {
  const actuals = new Map<string, number | null>();
  function resolve(node: Metric): number | null {
    const existing = actuals.get(node.id);
    if (existing !== undefined) return existing;

    let actual: number | null = node.actual;
    if (node.source === 'sum') {
      const sum = sumActual(node, nodes, resolve);
      if (sum.ok) actual = sum.value;
    }
    actuals.set(node.id, actual);
    return actual;
  }
  for (const node of nodes) resolve(node);
  return actuals;
}

export const emptyBoard = (): Board => ({months:{},auto:false,lastSync:{}});
export const fmt = (value: number) => new Intl.NumberFormat('ja-JP',{maximumFractionDigits:2}).format(value);
export const signed = (value: number) => (value < 0 ? '−' : value > 0 ? '+' : '') + fmt(Math.abs(value));
const jst = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'});
export function today(date = new Date()) {
  const parts = Object.fromEntries(jst.formatToParts(date).map(p=>[p.type,p.value]));
  return {month:parts.year+'-'+parts.month, day:+parts.day};
}
export function monthInfo(month: string, date: ReturnType<typeof today>) {
  const [y,m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y,m,0)).getUTCDate();
  const elapsed = month === date.month ? date.day : month < date.month ? days : 0;
  return {days,elapsed,remaining:days-elapsed,fraction:elapsed/days};
}
export function nextMonth(month: string, by: number) {
  const [y,m] = month.split('-').map(Number);
  return new Date(Date.UTC(y,m-1+by,1)).toISOString().slice(0,7);
}
export type Tone = 'good'|'warn'|'bad'|'neutral';
export function performance(n: Pick<Metric,'target'|'kind'> & {actual:number|null}, fraction: number) {
  const expected = n.target * (n.kind === 'rate' && fraction > 0 ? 1 : fraction);
  const actual = n.actual;
  const pace = actual !== null && expected > 0 ? actual / expected : null;
  const tone:Tone = pace === null ? 'neutral' : pace >= 1 ? 'good' : pace >= .9 ? 'warn' : 'bad';
  return {
    expected, pace, tone,
    gap:actual===null ? null : actual-expected,
    progress:actual!==null && n.target>0 ? actual/n.target : 0,
    forecast:actual!==null && fraction>0 ? actual/(n.kind==='rate'?1:fraction) : null,
  };
}
export const toneLabel:Record<Tone,string> = {good:'順調',warn:'注意',bad:'ビハインド',neutral:'判定前'};
export const W = 224, H = 116;
export function starterNodes(): Metric[] {
  return [{
    id:'root', parent:null, name:'主要KPI', unit:'件', kind:'total', source:'manual',
    key:'', target:0, actual:0, x:0, y:0,
  }];
}

export function sampleBoard(date: ReturnType<typeof today>): Board {
  const fraction = monthInfo(date.month, date).fraction;
  const [starter] = starterNodes();
  const root: Metric = {
    ...starter, name:'体験教室の申込数', target:40, source:'sum', sumIds:['web','event'],
  };
  const child = (id: string, parent: string, name: string, target: number, forecast: number, yieldPercent?: number): Metric => ({
    ...starter, id, parent, name, target, actual:Math.round(forecast * fraction), yieldPercent,
  });
  return {
    ...emptyBoard(),
    months:{[date.month]:[
      root,
      child('web', root.id, 'Web経由の申込', 24, 28),
      child('event', root.id, 'イベント経由の申込', 16, 10),
      child('inquiries', 'web', 'Webの問い合わせ', 0, 110, 25),
      child('visits', 'inquiries', '案内ページの訪問', 0, 1020, 10),
      {...starter,id:'email',parent:'inquiries',name:'体験日程を案内する',unit:'',cardType:'task',taskDone:false},
    ]},
  };
}
