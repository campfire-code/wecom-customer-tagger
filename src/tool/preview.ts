// 截图与预览用的示例数据（不会进入正式运行）。客户、企业、成员均为虚构的「示例」。
import { createMockWecom } from './mock';
import { relKey, type Rule } from './core';
import { getCorpTags, pullRelations } from './wecom';
import type { DemoState } from './Main';

export const rows = () => [];
export const params = {};

const NOW = Date.UTC(2026, 9, 23, 2, 0);
const m = createMockWecom(NOW);
const pulled = await pullRelations(m.http, 'T');
const lib = await getCorpTags(m.http, 'T');
const mk = (p: Partial<Rule> & Pick<Rule, 'id' | 'tag'>): Rule => ({ field: 'remark', op: 'contains', value: '', group: '自动标签', ...p });
const rules: Rule[] = [
  mk({ id: 'p1', value: '贵宾、老客户', tag: '重要客户' }),
  mk({ id: 'p2', value: '团购、下午茶', tag: '团购' }),
  mk({ id: 'p3', field: 'state', op: 'equals', value: 'xhs_note', tag: '小红书' }),
];
const rels = pulled.relations;
const ai = new Map<string, string[]>();
for (const r of rels) if (/加盟/.test(r.description) && !/加盟/.test(r.remark)) ai.set(relKey(r), ['加盟咨询']);
export const demo: DemoState = { rels, lib, rules, ai, notice: null };
