// 执行流程：新建缺少的标签 → 逐条调用 mark_tag → 汇总结果。http 从外面传入，测试用假函数。
import { WxError, addCorpTags, getCorpTags, markTag, sleep, withToken, type CorpTag, type Http, type WecomCred } from './wecom';
import { DEFAULT_GROUP, type Plan, type PlanRow, type ResultRow } from './core';

export interface ApplyOptions {
  onStep?(done: number, total: number): void;
  signal?: AbortSignal;
  /** 两次 mark_tag 之间的间隔毫秒，默认 120；官方该接口页面未写明单独的频率限制（未核实） */
  gapMs?: number;
  /** 遇到频率限制（45009 / 45033）时等多久再重试一次，默认 60 秒 */
  rateWaitMs?: number;
}

/** 补建缺少的标签，返回完整标签库（名字 → ID）。同名标签在不同组时取第一个。 */
export async function ensureTags(http: Http, cred: WecomCred, toCreate: Plan['toCreate']): Promise<Map<string, string>> {
  let lib: CorpTag[] = await withToken(http, cred, (t) => getCorpTags(http, t));
  for (const [group, names] of toCreate) {
    const missing = names.filter((n) => !lib.some((t) => t.name === n));
    if (!missing.length) continue;
    await withToken(http, cred, (t) => addCorpTags(http, t, group || DEFAULT_GROUP, missing));
  }
  if (toCreate.size) lib = await withToken(http, cred, (t) => getCorpTags(http, t));
  const map = new Map<string, string>();
  for (const t of lib) if (!map.has(t.name)) map.set(t.name, t.id);
  return map;
}

const isRate = (e: unknown) => e instanceof WxError && (e.code === 45009 || e.code === 45033);

export async function applyPlan(http: Http, cred: WecomCred, plan: Plan, opts: ApplyOptions = {}): Promise<ResultRow[]> {
  const ids = await ensureTags(http, cred, plan.toCreate);
  const out: ResultRow[] = plan.rows.map((r) => ({ userid: r.rel.userid, externalUserid: r.rel.externalUserid, name: r.rel.name, add: r.add, status: '未执行', error: '' }));
  for (let i = 0; i < plan.rows.length; i++) {
    if (opts.signal?.aborted) break;
    const row: PlanRow = plan.rows[i];
    const tagIds = row.add.map((n) => ids.get(n));
    if (tagIds.some((x) => !x)) { out[i].status = '失败'; out[i].error = '标签库里找不到这个标签（可能新建失败）'; continue; }
    const call = () => withToken(http, cred, (t) => markTag(http, t, row.rel.userid, row.rel.externalUserid, tagIds as string[]));
    try {
      try { await call(); } catch (e) {
        if (!isRate(e)) throw e;
        await sleep(opts.rateWaitMs ?? 60_000, opts.signal);
        await call();
      }
      out[i].status = '成功';
    } catch (e) {
      out[i].status = '失败';
      out[i].error = e instanceof Error ? e.message : String(e);
    }
    opts.onStep?.(i + 1, plan.rows.length);
    if (opts.gapMs !== 0) await sleep(opts.gapMs ?? 120, opts.signal).catch(() => {});
  }
  return out;
}
