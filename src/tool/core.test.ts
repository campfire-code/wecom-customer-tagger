// 规则命中、改动方案、AI 提示词与解析、CSV 导出。
import { describe, expect, it } from 'vitest';
import { aiClassify, aiMessages, buildPlan, checkRule, matchRule, parseAi, relKey, splitKeywords, toCsv, type Rule } from './core';
import type { CorpTag, Relation } from './wecom';

const NOW = Date.UTC(2026, 9, 23, 2, 0);
const rel = (p: Partial<Relation> = {}): Relation => ({
  userid: 'xiaoli', externalUserid: 'wmDEMO0001', name: '示例客户甲', type: 1, corpName: '', createtime: Math.floor(NOW / 1000) - 10 * 86400,
  remark: '', description: '', tagIds: [], state: '', addWay: 1, operUserid: 'xiaoli', ...p,
});
const rule = (p: Partial<Rule>): Rule => ({ id: 'r', field: 'remark', op: 'contains', value: 'VIP', tag: '重要客户', group: '自动标签', ...p });
const lib: CorpTag[] = [{ id: 'tag_vip', name: '重要客户', groupId: 'g1', groupName: '客户等级' }, { id: 'tag_group', name: '团购', groupId: 'g2', groupName: '意向' }];

describe('规则', () => {
  it('关键词支持多种分隔符且不区分大小写', () => {
    expect(splitKeywords('VIP、老客户, 复购\n团购')).toEqual(['VIP', '老客户', '复购', '团购']);
    expect(matchRule(rule({}), rel({ remark: '这是 vip 客户' }), NOW)).toBe(true);
    expect(matchRule(rule({ value: '加盟、团购' }), rel({ remark: '公司团购' }), NOW)).toBe(true);
    expect(matchRule(rule({}), rel({ remark: '普通' }), NOW)).toBe(false);
  });
  it('等于、为空、不为空、添加方式、客户类型、天数', () => {
    expect(matchRule(rule({ field: 'state', op: 'equals', value: 'xhs' }), rel({ state: 'xhs' }), NOW)).toBe(true);
    expect(matchRule(rule({ op: 'empty', value: '' }), rel({ remark: ' ' }), NOW)).toBe(true);
    expect(matchRule(rule({ op: 'notEmpty', value: '' }), rel({ remark: 'x' }), NOW)).toBe(true);
    expect(matchRule(rule({ field: 'addWay', op: 'equals', value: '16' }), rel({ addWay: 16 }), NOW)).toBe(true);
    expect(matchRule(rule({ field: 'addWay', op: 'equals', value: '16' }), rel({ addWay: undefined }), NOW)).toBe(false);
    expect(matchRule(rule({ field: 'type', op: 'equals', value: '2' }), rel({ type: 2 }), NOW)).toBe(true);
    expect(matchRule(rule({ field: 'ageDays', op: 'lt', value: '30' }), rel(), NOW)).toBe(true);
    expect(matchRule(rule({ field: 'ageDays', op: 'gt', value: '30' }), rel(), NOW)).toBe(false);
  });
  it('检查规则：标签名必填、最长 30 字、条件值必填', () => {
    expect(checkRule(rule({ tag: '' }))).toMatch(/标签名/);
    expect(checkRule(rule({ tag: '字'.repeat(31) }))).toMatch(/最长 30/);
    expect(checkRule(rule({ group: '组'.repeat(31) }))).toMatch(/标签组名/);
    expect(checkRule(rule({ value: '' }))).toMatch(/关键词/);
    expect(checkRule(rule({ field: 'ageDays', op: 'lt', value: 'abc' }))).toMatch(/天数/);
    expect(checkRule(rule({ op: 'empty', value: '' }))).toBeNull();
    expect(checkRule(rule({}))).toBeNull();
  });
});

describe('改动方案', () => {
  it('只新增、跳过已有标签、统计未命中，缺少的标签按组列入新建', () => {
    const rels = [
      rel({ externalUserid: 'a', remark: 'VIP 老客户' }),
      rel({ externalUserid: 'b', remark: 'VIP', tagIds: ['tag_vip'] }),
      rel({ externalUserid: 'c', remark: '普通' }),
      rel({ externalUserid: 'd', remark: '问加盟', tagIds: ['tag_x_unknown'] }),
    ];
    const rules = [rule({}), rule({ id: 'r2', value: '加盟', tag: '加盟咨询', group: '意向' }), rule({ id: 'bad', tag: '' })];
    const p = buildPlan(rels, rules, lib, NOW);
    expect(p.rows.map((r) => [r.rel.externalUserid, r.add])).toEqual([['a', ['重要客户']], ['d', ['加盟咨询']]]);
    expect(p.alreadyDone).toBe(1);
    expect(p.unmatched).toBe(1);
    expect([...p.toCreate]).toEqual([['意向', ['加盟咨询']]]);
    expect(p.rows[1].has).toEqual(['tag_x_unknown']);
  });
  it('AI 建议和规则合并，同一个标签不重复', () => {
    const a = rel({ externalUserid: 'a', remark: 'VIP' });
    const b = rel({ externalUserid: 'b' });
    const ai = new Map([[relKey(a), ['重要客户', '团购']], [relKey(b), ['团购']]]);
    const p = buildPlan([a, b], [rule({})], lib, NOW, ai);
    expect(p.rows[0].add).toEqual(['重要客户', '团购']);
    expect(p.rows[0].why).toEqual(['r', 'ai']);
    expect(p.rows[1].add).toEqual(['团购']);
    expect(p.toCreate.size).toBe(0);
  });
});

describe('AI 分类', () => {
  it('提示词只含备注、描述、企业名、渠道参数，不含昵称和 ID', () => {
    const msg = aiMessages([rel({ remark: '问加盟', name: '示例客户甲', corpName: '示例商贸' })], ['加盟咨询'], '');
    const all = msg.map((m) => m.content).join('\n');
    expect(all).toContain('问加盟');
    expect(all).not.toContain('示例客户甲');
    expect(all).not.toContain('wmDEMO0001');
    expect(all).not.toContain('补充说明');
  });
  it('容错解析：代码块围栏、不在候选里的标签被丢弃、序号越界忽略、坏 JSON 返回空', () => {
    const t = '```json\n{"results":[{"i":0,"tags":["团购","瞎编的"]},{"i":9,"tags":["团购"]},{"i":1,"tags":[]}]}\n```';
    expect([...parseAi(t, 2, ['团购'])]).toEqual([[0, ['团购']]]);
    expect(parseAi('不是 json', 2, ['团购']).size).toBe(0);
    expect(parseAi('{"results":"x"}', 2, ['团购']).size).toBe(0);
  });
  it('分批调用：空信息客户不发送，某批失败不影响其他批', async () => {
    const rels = Array.from({ length: 45 }, (_, i) => rel({ externalUserid: `e${i}`, remark: i === 44 ? '' : '团购' }));
    let n = 0;
    const llm = async (m: { content: string }[]) => {
      n++;
      if (n === 2) throw new Error('网络断开');
      const count = (JSON.parse(m[1].content.split('【客户】')[1]) as unknown[]).length;
      return JSON.stringify({ results: Array.from({ length: count }, (_, i) => ({ i, tags: ['团购'] })) });
    };
    const steps: string[] = [];
    const r = await aiClassify(rels, ['团购'], '', llm, (d, t) => steps.push(`${d}/${t}`));
    expect(n).toBe(3);
    expect(r.failedBatches).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.tags.size).toBe(20 + 4);
    expect(steps).toEqual(['20/44', '40/44', '44/44']);
  });
});

describe('导出', () => {
  it('CSV 带 BOM，含逗号和引号的内容正确转义', () => {
    const csv = toCsv([{ userid: 'u', externalUserid: 'e', name: '甲,乙', add: ['A', 'B'], status: '失败', error: '他说"不"' }]);
    expect(csv.startsWith('﻿跟进成员,')).toBe(true);
    expect(csv).toContain('"甲,乙",A、B,失败,"他说""不"""');
  });
});
