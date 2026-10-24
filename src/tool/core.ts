// 纯函数：打标签规则、生成改动方案、AI 分类的提示词与解析、结果导出。不依赖界面和网络，便于单元测试。
import type { CorpTag, Relation } from './wecom';

export type RuleField = 'remark' | 'description' | 'corpName' | 'name' | 'state' | 'userid' | 'addWay' | 'type' | 'ageDays';
export type RuleOp = 'contains' | 'equals' | 'empty' | 'notEmpty' | 'lt' | 'gt';

export interface Rule {
  id: string;
  field: RuleField;
  op: RuleOp;
  /** contains 时可用顿号、逗号、换行分隔多个关键词，命中任意一个即算；其余为单个值 */
  value: string;
  /** 命中后要打的标签名（企业标签库里已有就直接用，没有就在 group 下新建） */
  tag: string;
  /** 标签不存在时新建到哪个标签组，默认「自动标签」 */
  group: string;
}

export const DEFAULT_GROUP = '自动标签';
/** 标签名与标签组名最长 30 个字符（官方文档 path/92117） */
export const TAG_NAME_MAX = 30;

export const FIELD_LABELS: Record<RuleField, string> = {
  remark: '备注', description: '描述', corpName: '客户企业名', name: '客户名称', state: '渠道参数',
  userid: '跟进成员', addWay: '添加方式', type: '客户类型', ageDays: '添加至今天数',
};
export const FIELD_OPS: Record<RuleField, [RuleOp, string][]> = {
  remark: [['contains', '包含'], ['equals', '等于'], ['empty', '为空'], ['notEmpty', '不为空']],
  description: [['contains', '包含'], ['equals', '等于'], ['empty', '为空'], ['notEmpty', '不为空']],
  corpName: [['contains', '包含'], ['equals', '等于'], ['empty', '为空'], ['notEmpty', '不为空']],
  name: [['contains', '包含'], ['equals', '等于']],
  state: [['contains', '包含'], ['equals', '等于'], ['empty', '为空'], ['notEmpty', '不为空']],
  userid: [['equals', '等于']],
  addWay: [['equals', '等于']],
  type: [['equals', '等于']],
  ageDays: [['lt', '小于'], ['gt', '大于']],
};

export const splitKeywords = (v: string) => v.split(/[、,，;；\n]/).map((s) => s.trim()).filter(Boolean);

export function checkRule(r: Rule): string | null {
  const tag = r.tag.trim();
  if (!tag) return '还没有填标签名';
  if ([...tag].length > TAG_NAME_MAX) return `标签名最长 ${TAG_NAME_MAX} 个字符`;
  if ([...(r.group.trim() || DEFAULT_GROUP)].length > TAG_NAME_MAX) return `标签组名最长 ${TAG_NAME_MAX} 个字符`;
  if (r.op === 'empty' || r.op === 'notEmpty') return null;
  if (r.op === 'contains' && !splitKeywords(r.value).length) return '还没有填关键词';
  if (r.op !== 'contains' && !r.value.trim()) return '还没有填条件的值';
  if ((r.op === 'lt' || r.op === 'gt') && !(Number(r.value) >= 0)) return '天数要填数字';
  return null;
}

/** 判断一条规则是否命中一条客户关系；now 为毫秒时间戳 */
export function matchRule(rule: Rule, rel: Relation, now: number): boolean {
  if (rule.field === 'ageDays') {
    const days = (now / 1000 - rel.createtime) / 86400;
    const n = Number(rule.value);
    return rule.op === 'lt' ? days < n : days > n;
  }
  const raw =
    rule.field === 'addWay' ? (rel.addWay === undefined ? '' : String(rel.addWay)) :
    rule.field === 'type' ? String(rel.type) :
    String(rel[rule.field] ?? '');
  const v = raw.trim();
  switch (rule.op) {
    case 'empty': return v === '';
    case 'notEmpty': return v !== '';
    case 'equals': return v === rule.value.trim();
    case 'contains': {
      const low = v.toLowerCase();
      return splitKeywords(rule.value).some((k) => low.includes(k.toLowerCase()));
    }
    default: return false;
  }
}

export interface PlanRow {
  key: string;
  rel: Relation;
  /** 要新增的标签名（去掉客户已有的） */
  add: string[];
  /** 来源：规则 id 或 'ai' */
  why: string[];
  /** 客户已有的标签名（含标签库里查不到的 ID） */
  has: string[];
}

export interface Plan {
  rows: PlanRow[];
  /** 需要先新建的标签：标签组名 → 标签名 */
  toCreate: Map<string, string[]>;
  /** 命中了但客户已经有这些标签，所以不用改的人数 */
  alreadyDone: number;
  /** 完全没命中的人数 */
  unmatched: number;
}

export const relKey = (r: Pick<Relation, 'userid' | 'externalUserid'>) => `${r.userid}\n${r.externalUserid}`;

/** 把规则（和 AI 给出的标签）合成改动方案。只做「新增标签」，不会移除客户已有的任何标签。 */
export function buildPlan(rels: Relation[], rules: Rule[], lib: CorpTag[], now: number, ai?: Map<string, string[]>): Plan {
  const byId = new Map(lib.map((t) => [t.id, t.name]));
  const libNames = new Set(lib.map((t) => t.name));
  const valid = rules.filter((r) => !checkRule(r));
  const rows: PlanRow[] = [];
  const create = new Map<string, Set<string>>();
  let alreadyDone = 0;
  let unmatched = 0;
  for (const rel of rels) {
    const want = new Map<string, string>(); // 标签名 → 来源
    const group = new Map<string, string>(); // 标签名 → 新建时的组
    for (const rule of valid) {
      if (matchRule(rule, rel, now)) {
        const name = rule.tag.trim();
        if (!want.has(name)) want.set(name, rule.id);
        if (!group.has(name)) group.set(name, rule.group.trim() || DEFAULT_GROUP);
      }
    }
    for (const name of ai?.get(relKey(rel)) ?? []) {
      if (!want.has(name)) want.set(name, 'ai');
    }
    if (!want.size) { unmatched++; continue; }
    const has = rel.tagIds.map((id) => byId.get(id) ?? id);
    const add = [...want.keys()].filter((n) => !has.includes(n));
    if (!add.length) { alreadyDone++; continue; }
    for (const n of add) {
      if (!libNames.has(n)) {
        const g = group.get(n) ?? DEFAULT_GROUP;
        if (!create.has(g)) create.set(g, new Set());
        create.get(g)!.add(n);
      }
    }
    rows.push({ key: relKey(rel), rel, add, why: add.map((n) => want.get(n)!), has });
  }
  return { rows, toCreate: new Map([...create].map(([g, s]) => [g, [...s]])), alreadyDone, unmatched };
}

// ---------- AI 分类 ----------

export const AI_BATCH = 20;

/** 只把备注、描述、客户企业名、渠道参数发给大模型（不发客户昵称和 ID），候选标签只能从给定名单里选 */
export function aiMessages(rels: Relation[], candidates: string[], hint: string) {
  const list = rels.map((r, i) => ({ i, 备注: r.remark, 描述: r.description, 客户企业: r.corpName, 渠道参数: r.state }));
  return [
    { role: 'system' as const, content: '你是客户标签整理助手。根据每位客户的备注、描述等信息，从【候选标签】里挑出合适的标签。只能用候选标签里的原文，不要自己造标签；信息不足就返回空数组，不要猜。只输出 JSON，格式：{"results":[{"i":0,"tags":["标签"]}]}' },
    { role: 'user' as const, content: `【候选标签】${JSON.stringify(candidates)}\n${hint.trim() ? `【补充说明】${hint.trim()}\n` : ''}【客户】${JSON.stringify(list)}` },
  ];
}

/** 容错解析大模型回复：去掉代码块围栏，只保留候选名单内的标签，序号越界的忽略 */
export function parseAi(text: string, count: number, candidates: string[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const body = text.replace(/```(?:json)?/gi, '');
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e <= s) return out;
  let data: unknown;
  try { data = JSON.parse(body.slice(s, e + 1)); } catch { return out; }
  const arr = (data as { results?: unknown }).results;
  if (!Array.isArray(arr)) return out;
  const ok = new Set(candidates);
  for (const it of arr as { i?: unknown; tags?: unknown }[]) {
    if (typeof it?.i !== 'number' || it.i < 0 || it.i >= count || !Array.isArray(it.tags)) continue;
    const tags = [...new Set(it.tags.filter((t): t is string => typeof t === 'string' && ok.has(t.trim())).map((t) => t.trim()))];
    if (tags.length) out.set(it.i, tags);
  }
  return out;
}

export type Llm = (messages: ReturnType<typeof aiMessages>, opts?: { json?: boolean; temperature?: number }) => Promise<string>;

/** 分批让大模型分类；某一批失败（网络、解析）不影响其他批，失败数量返回给界面提示 */
export async function aiClassify(
  rels: Relation[], candidates: string[], hint: string, llm: Llm, onStep?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<{ tags: Map<string, string[]>; failedBatches: number; skipped: number }> {
  const tags = new Map<string, string[]>();
  // 备注、描述、企业名、渠道参数全空的客户没有可判断的信息，不发给大模型
  const usable = rels.filter((r) => r.remark || r.description || r.corpName || r.state);
  let failed = 0;
  for (let i = 0; i < usable.length; i += AI_BATCH) {
    if (signal?.aborted) throw new Error('已停止');
    const group = usable.slice(i, i + AI_BATCH);
    try {
      const reply = await llm(aiMessages(group, candidates, hint), { json: true, temperature: 0 });
      for (const [idx, t] of parseAi(reply, group.length, candidates)) tags.set(relKey(group[idx]), t);
    } catch (e) {
      if (signal?.aborted) throw e;
      failed++;
    }
    onStep?.(Math.min(i + AI_BATCH, usable.length), usable.length);
  }
  return { tags, failedBatches: failed, skipped: rels.length - usable.length };
}

// ---------- 导出 ----------

export interface ResultRow { userid: string; externalUserid: string; name: string; add: string[]; status: '成功' | '失败' | '未执行'; error: string }

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function toCsv(rows: ResultRow[]): string {
  const head = ['跟进成员', '客户编号', '客户名称', '新增标签', '结果', '失败原因'];
  const lines = [head, ...rows.map((r) => [r.userid, r.externalUserid, r.name, r.add.join('、'), r.status, r.error])];
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
