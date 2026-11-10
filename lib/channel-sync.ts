import type { Metric } from './atlas';
import { placeTreeNode } from './tree-layout';

export type ChannelMetric = { key: string; label: string };

export function readChannelMetrics(value: unknown, metrics: Record<string, number>): ChannelMetric[] {
  if (!Array.isArray(value)) return [];
  const channels = new Map<string, ChannelMetric>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const {key, label} = item as Record<string, unknown>;
    if (typeof key !== 'string' || !Object.hasOwn(metrics, key)) continue;
    if (typeof label !== 'string' || !label.trim()) continue;
    channels.set(key, {key, label:label.trim().slice(0, 60)});
    if (channels.size >= 200) break;
  }
  return [...channels.values()];
}

export function addChannelCards(nodes: Metric[], channels: ChannelMetric[], metrics: Record<string, number>) {
  let next = nodes;
  let added = 0;
  let skipped = 0;
  for (const parent of nodes.filter(node => node.channelSync)) {
    const existing = new Set(next.filter(node => node.parent === parent.id).map(node => node.key));
    for (const channel of channels) {
      if (existing.has(channel.key)) continue;
      if (next.length >= 100) {
        skipped++;
        continue;
      }
      const child: Metric = {
        id:crypto.randomUUID(), parent:parent.id, name:channel.label, unit:'件', kind:'total',
        source:'api', key:channel.key, actual:metrics[channel.key], target:0, x:0, y:0,
      };
      next = placeTreeNode([...next, child], child.id, parent.id, null);
      existing.add(channel.key);
      added++;
    }
  }
  return {nodes:next, added, skipped};
}
