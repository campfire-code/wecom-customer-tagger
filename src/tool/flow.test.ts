// 批量流程：用模拟企业（按官方字段格式应答）跑完 拉取 → 方案 → 新建标签 → 打标签；不访问网络。
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPlan } from './flow';
import { buildPlan, type Rule } from './core';
import { MOCK_CORP, createMockWecom } from './mock';
import { clearTokenCache, getCorpTags, pullRelations, type Http } from './wecom';

const NOW = Date.UTC(2026, 9, 23, 2, 0);
beforeEach(() => clearTokenCache());
const rules: Rule[] = [
  { id: 'a', field: 'remark', op: 'contains', value: 'VIP、老客户', tag: '重要客户', group: '自动标签' },
  { id: 'b', field: 'remark', op: 'contains', value: '团购', tag: '企业团购', group: '自动标签' },
];

async function setup(http: Http) {
  const pulled = await pullRelations(http, 'MOCK_TOKEN');
  const lib = await getCorpTags(http, 'MOCK_TOKEN');
  return { pulled, lib, plan: buildPlan(pulled.relations, rules, lib, NOW) };
}

describe('批量打标签流程', () => {
  it('先新建缺少的标签，再逐条 mark_tag，客户身上真的有了标签', async () => {
    const m = createMockWecom(NOW);
    const { plan } = await setup(m.http);
    expect(plan.rows.length).toBeGreaterThan(3);
    expect([...plan.toCreate]).toEqual([['自动标签', ['企业团购']]]);
    const steps: number[] = [];
    const res = await applyPlan(m.http, MOCK_CORP, plan, { gapMs: 0, onStep: (d) => steps.push(d) });
    expect(res.every((r) => r.status === '成功')).toBe(true);
    expect(steps.at(-1)).toBe(plan.rows.length);
    const created = (await getCorpTags(m.http, 'T')).find((t) => t.name === '企业团购')!;
    expect(created.groupName).toBe('自动标签');
    const row = plan.rows.find((r) => r.add.includes('企业团购'))!;
    const server = m.rels.find((x) => x.userid === row.rel.userid && x.external_userid === row.rel.externalUserid)!;
    expect(server.tag_id).toContain(created.id);
    // 只发了新增，没有任何 remove_tag
    const marks = m.calls.filter((c) => c.url.includes('/mark_tag'));
    expect(marks).toHaveLength(plan.rows.length);
    expect(marks.every((c) => !('remove_tag' in (c.body as object)))).toBe(true);
    // 再算一次方案：已全部有标签，无需改动（可重复执行）
    const again = await setup(m.http);
    expect(again.plan.rows).toHaveLength(0);
    expect(again.plan.alreadyDone).toBeGreaterThan(0);
  });

  it('单条失败不影响其他条，失败原因是中文', async () => {
    const m = createMockWecom(NOW);
    const { plan } = await setup(m.http);
    const victim = plan.rows[1].rel;
    const http: Http = async (url, init) => {
      if (url.includes('/mark_tag') && JSON.parse(init!.body!).external_userid === victim.externalUserid && JSON.parse(init!.body!).userid === victim.userid)
        return { status: 200, text: async () => '{"errcode":84061,"errmsg":"not external contact"}' };
      return m.http(url, init);
    };
    const res = await applyPlan(http, MOCK_CORP, plan, { gapMs: 0 });
    expect(res[1].status).toBe('失败');
    expect(res[1].error).toContain('不存在外部联系人关系');
    expect(res.filter((r) => r.status === '成功')).toHaveLength(plan.rows.length - 1);
  });

  it('遇到频率限制 45009 等待后重试一次', async () => {
    const m = createMockWecom(NOW);
    const { plan } = await setup(m.http);
    let hit = false;
    const http: Http = async (url, init) => {
      if (url.includes('/mark_tag') && !hit) { hit = true; return { status: 200, text: async () => '{"errcode":45009,"errmsg":"reach max api daily quota limit"}' }; }
      return m.http(url, init);
    };
    const res = await applyPlan(http, MOCK_CORP, plan, { gapMs: 0, rateWaitMs: 0 });
    expect(res[0].status).toBe('成功');
    expect(res.every((r) => r.status === '成功')).toBe(true);
  });

  it('中途停止：已处理的有结果，没处理的标记未执行', async () => {
    const m = createMockWecom(NOW);
    const { plan } = await setup(m.http);
    const ac = new AbortController();
    const res = await applyPlan(m.http, MOCK_CORP, plan, { gapMs: 0, signal: ac.signal, onStep: (d) => { if (d === 2) ac.abort(); } });
    expect(res.filter((r) => r.status === '成功')).toHaveLength(2);
    expect(res.filter((r) => r.status === '未执行')).toHaveLength(plan.rows.length - 2);
  });

  it('企业 ID 或 Secret 不对时给出中文提示', async () => {
    const m = createMockWecom(NOW);
    const { plan } = await setup(m.http);
    await expect(applyPlan(m.http, { corpId: MOCK_CORP.corpId, secret: 'bad' }, plan, { gapMs: 0 })).rejects.toThrow(/Secret 不对/);
  });
});
