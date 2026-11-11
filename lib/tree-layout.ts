import { H, W } from './atlas';
import type { Metric } from './atlas';

const COLUMN_STEP = W + 96;
export const BRANCH_RUN = 62;
const ROW_GAP = 24;
const ORIGIN = 24;

export type PositionedMetric = Metric & {depth: number};
type TreeLayout = {
  nodes: PositionedMetric[];
  byId: Map<string, PositionedMetric>;
  children: Map<string, PositionedMetric[]>;
};

export function sortSiblings<T extends Metric>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order || a.y - b.y;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return a.y - b.y;
  });
}

export function layoutTree(metrics: Metric[]): TreeLayout {
  const groups = new Map<string, Metric[]>();
  const root = metrics.find(metric => metric.parent === null);
  const layout: TreeLayout = {nodes: [], byId: new Map(), children: new Map()};
  if (!root) return layout;

  for (const metric of metrics) {
    if (metric.parent === null) continue;
    const siblings = groups.get(metric.parent) ?? [];
    siblings.push(metric);
    groups.set(metric.parent, siblings);
  }

  let nextRow = ORIGIN;
  function visit(metric: Metric, depth: number): PositionedMetric {
    const node = {...metric, depth, x: ORIGIN + depth * COLUMN_STEP, y: 0};
    layout.nodes.push(node);
    layout.byId.set(node.id, node);
    const children = sortSiblings(groups.get(metric.id) ?? []).map(child => visit(child, depth + 1));
    layout.children.set(node.id, children);
    if (children.length) {
      node.y = (children[0].y + children[children.length - 1].y) / 2;
    } else {
      node.y = nextRow;
      nextRow += H + ROW_GAP;
    }
    return node;
  }
  visit(root, 0);
  return layout;
}

export type TreeDrop = {
  parent: PositionedMetric;
  depth: number;
  beforeId: string | null;
  x: number;
  y: number;
};

export function planTreeDrop(layout: TreeLayout, id: string, x: number, y: number): TreeDrop | null {
  const moving = layout.byId.get(id);
  if (!moving?.parent) return null;
  const originalParent = layout.byId.get(moving.parent);
  if (!originalParent) return null;

  const branch = new Set<string>();
  function collect(nodeId: string) {
    branch.add(nodeId);
    for (const child of layout.children.get(nodeId) ?? []) collect(child.id);
  }
  collect(id);

  // A margin around the midpoint keeps ordinary vertical reordering in its column.
  let parent = originalParent;
  let distance = Math.abs(x - moving.x) - 18;
  for (const candidate of layout.nodes) {
    if (candidate.cardType==='task' || branch.has(candidate.id) || candidate.depth === originalParent.depth) continue;
    const columnDistance = Math.abs(x - (candidate.x + COLUMN_STEP));
    if (columnDistance > distance) continue;
    if (columnDistance === distance && Math.abs(y - candidate.y) >= Math.abs(y - parent.y)) continue;
    distance = columnDistance;
    parent = candidate;
  }

  const siblings = layout.children.get(parent.id) ?? [];
  const others = siblings.filter(sibling => sibling.id !== id);
  const next = others.find(sibling => y < sibling.y);
  const beforeId = next?.id ?? null;
  if (parent.id === originalParent.id && (siblings[siblings.findIndex(sibling => sibling.id === id) + 1]?.id ?? null) === beforeId) return null;

  const previous = next ? others[others.indexOf(next) - 1] : others.at(-1);
  let markerY = parent.y + H / 2;
  if (previous && next) markerY = (previous.y + H + next.y) / 2;
  else if (next) markerY = next.y - ROW_GAP / 2;
  else if (previous) markerY = previous.y + H + ROW_GAP / 2;
  return {parent, depth:parent.depth + 1, beforeId, x:parent.x + COLUMN_STEP, y:markerY};
}

export function placeTreeNode(nodes: Metric[], id: string, parentId: string, beforeId: string | null): Metric[] {
  const siblings = sortSiblings(nodes.filter(node => node.parent === parentId && node.id !== id));
  const before = siblings.findIndex(node => node.id === beforeId);
  const ids = siblings.map(node => node.id);
  ids.splice(before < 0 ? ids.length : before, 0, id);
  const order = new Map(ids.map((siblingId, index) => [siblingId, index]));
  return nodes.map(node => {
    const index = order.get(node.id);
    return index === undefined ? node : {...node, parent:parentId, order:index};
  });
}

export function duplicateTreeBranch(nodes: Metric[], id: string) {
  const layout = layoutTree(nodes);
  const source = layout.byId.get(id);
  if (!source?.parent) return {ok:false, reason:'root'} as const;

  const branch = new Set<string>();
  function collect(nodeId: string) {
    branch.add(nodeId);
    for (const child of layout.children.get(nodeId) ?? []) collect(child.id);
  }
  collect(id);
  if (nodes.length + branch.size > 100) return {ok:false, reason:'limit'} as const;

  const ids = new Map([...branch].map(nodeId => [nodeId, crypto.randomUUID()]));
  const suffix = '（コピー）';
  const name = source.name.slice(0, 60 - suffix.length).replace(/[\uD800-\uDBFF]$/, '').trimEnd() + suffix;
  const copies = nodes.filter(node => branch.has(node.id)).map(node => {
    const parent = node.parent!;
    return {
      ...node,
      id: ids.get(node.id)!,
      reviewMemberId: undefined,
      name: node.id === id ? name : node.name,
      parent: ids.get(parent) ?? parent,
      sumIds: node.sumIds?.map(inputId => ids.get(inputId) ?? inputId),
      unitPrice: node.unitPrice && {
        ...node.unitPrice,
        quantityId: ids.get(node.unitPrice.quantityId) ?? node.unitPrice.quantityId,
      },
    };
  });
  const siblings = layout.children.get(source.parent) ?? [];
  const afterSource = siblings[siblings.findIndex(sibling => sibling.id === id) + 1];
  const copyId = ids.get(id)!;
  const updated = placeTreeNode([...nodes, ...copies], copyId, source.parent, afterSource?.id ?? null);
  return {ok:true, nodes:updated, copy:updated.find(node => node.id === copyId)!} as const;
}
