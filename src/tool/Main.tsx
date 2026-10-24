// 企微客户标签批量整理：连接企业微信 → 拉客户和标签库 → 写规则（可加 AI）→ 看改动方案 → 确认后批量打标签 → 导出结果。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Download, Loader2, Plus, RefreshCw, Sparkles, Tags, Trash2, Users } from 'lucide-react';
import type { RunContext } from '../kit/types';
import { settingsStore } from '../kit/platform';
import { llmReady, useSettings } from '../kit/settings';
import { addWayName, getCorpTags, pullRelations, withToken, type CorpTag, type Relation } from './wecom';
import {
  DEFAULT_GROUP, FIELD_LABELS, FIELD_OPS, aiClassify, buildPlan, checkRule, toCsv,
  type Rule, type RuleField, type RuleOp, type ResultRow,
} from './core';
import { applyPlan } from './flow';
import { SetupPanel, SourceSwitch, useConn } from './Setup';
import './setup.css';
import './tool.css';

type Ctx = Pick<RunContext, 'writeText' | 'join' | 'llm'>;
type Notice = { kind: 'ok' | 'err'; text: string } | null;
export interface DemoState { rels: Relation[]; lib: CorpTag[]; rules: Rule[]; results?: ResultRow[]; ai?: Map<string, string[]>; notice?: Notice }

const RULES_KEY = 'wecom-tagger.rules';
let seq = 0;
export const newRule = (p: Partial<Rule> = {}): Rule => ({ id: `r${Date.now().toString(36)}${seq++}`, field: 'remark', op: 'contains', value: '', tag: '', group: DEFAULT_GROUP, ...p });
const fmtDate = (sec: number) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '');

export function Main({ ctx }: { ctx: Ctx }) {
  const preview = location.pathname.endsWith('preview.html');
  const conn = useConn(preview);
  const settings = useSettings();
  const [setupOpen, setSetupOpen] = useState(false);
  const [rels, setRels] = useState<Relation[]>([]);
  const [lib, setLib] = useState<CorpTag[]>([]);
  const [rules, setRules] = useState<Rule[]>([newRule()]);
  const [useAi, setUseAi] = useState(false);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [aiHint, setAiHint] = useState('');
  const [ai, setAi] = useState<Map<string, string[]>>(new Map());
  const [results, setResults] = useState<ResultRow[]>([]);
  const [busy, setBusy] = useState<'' | 'pull' | 'ai' | 'apply'>('');
  const [progress, setProgress] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const stop = useRef<AbortController | null>(null);
  const now = useMemo(() => Date.now(), [rels]);

  useEffect(() => {
    if (preview) {
      import('./preview').then((m) => { setRels(m.demo.rels); setLib(m.demo.lib); setRules(m.demo.rules); setResults(m.demo.results ?? []); setAi(m.demo.ai ?? new Map()); setNotice(m.demo.notice ?? null); setUseAi(false); });
      return;
    }
    settingsStore().then((s) => s.get<Rule[]>(RULES_KEY)).then((r) => { if (r?.length) setRules(r); }).catch(() => {});
  }, [preview]);
  const saveRules = (r: Rule[]) => { setRules(r); setResults([]); setConfirming(false); if (!preview) settingsStore().then((s) => s.set(RULES_KEY, r)).catch(() => {}); };
  const patch = (id: string, p: Partial<Rule>) => saveRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const plan = useMemo(() => buildPlan(rels, rules, lib, now, useAi ? ai : undefined), [rels, rules, lib, now, ai, useAi]);
  const fail = (e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });

  const pull = async () => {
    setBusy('pull'); setNotice(null); setResults([]); setAi(new Map()); setConfirming(false);
    try {
      const r = await withToken(conn.http, conn.activeCred, async (t) => ({ pulled: await pullRelations(conn.http, t, setProgress), lib: await getCorpTags(conn.http, t) }));
      setRels(r.pulled.relations); setLib(r.lib);
      const extra = r.pulled.unlicensed.length ? `；${r.pulled.unlicensed.length} 位成员没有互通账号许可，客户未取到` : '';
      setNotice({ kind: 'ok', text: `取到 ${r.pulled.users.length} 位成员的 ${r.pulled.relations.length} 条客户关系、${r.lib.length} 个企业标签${extra}` });
    } catch (e) { fail(e); }
    setBusy('');
  };

  const runAi = async () => {
    const cands = aiTags.filter((n) => lib.some((t) => t.name === n));
    if (!cands.length) return setNotice({ kind: 'err', text: '先在下面选几个允许 AI 使用的标签' });
    const ac = new AbortController(); stop.current = ac; setBusy('ai'); setNotice(null);
    try {
      const r = await aiClassify(rels, cands, aiHint, (m, o) => ctx.llm(m, o), (d, t) => setProgress(`AI 分类中：${d} / ${t}`), ac.signal);
      setAi(r.tags); setConfirming(false);
      setNotice({ kind: r.failedBatches ? 'err' : 'ok', text: `AI 给 ${r.tags.size} 位客户建议了标签${r.skipped ? `；${r.skipped} 位没有备注/描述，未发送` : ''}${r.failedBatches ? `；有 ${r.failedBatches} 批请求或解析失败，那些客户没有建议` : ''}` });
    } catch (e) { fail(e); }
    setBusy('');
  };

  const apply = async () => {
    const ac = new AbortController(); stop.current = ac; setBusy('apply'); setConfirming(false); setNotice(null);
    try {
      const r = await applyPlan(conn.http, conn.activeCred, plan, { signal: ac.signal, gapMs: conn.source === 'demo' ? 0 : 120, onStep: (d, t) => setProgress(`正在打标签：${d} / ${t}`) });
      setResults(r);
      const okN = r.filter((x) => x.status === '成功').length;
      setNotice({ kind: okN === r.length ? 'ok' : 'err', text: `完成：成功 ${okN} 条，失败 ${r.filter((x) => x.status === '失败').length} 条，未执行 ${r.filter((x) => x.status === '未执行').length} 条` });
      if (conn.source === 'demo') setRels((old) => old.map((x) => { const m = conn.mock.rels.find((y) => y.userid === x.userid && y.external_userid === x.externalUserid); return m ? { ...x, tagIds: [...m.tag_id] } : x; }));
    } catch (e) { fail(e); }
    setBusy('');
  };

  const exportCsv = async () => {
    try {
      const p = await ctx.join(await (await import('../kit/platform')).defaultOutputDir('企微客户标签批量整理'), `打标签结果-${new Date().toISOString().slice(0, 10)}.csv`);
      await ctx.writeText(p, toCsv(results));
      setNotice({ kind: 'ok', text: `结果已导出：${p}` });
    } catch (e) { fail(e); }
  };

  const bad = rules.map(checkRule);
  const namesInUse = (id: string) => (id === 'ai' ? 'AI' : `规则 ${rules.findIndex((r) => r.id === id) + 1}`);
  const idle = busy === '';
  const hasResults = results.length > 0;

  return (
    <div className="wt-root">
      <div className="wt-top">
        <SourceSwitch conn={conn} disabled={!idle} />
        {conn.source === 'demo' && <span className="k-help">示例数据：虚构的企业和客户，打标签只改内存里的模拟数据</span>}
      </div>
      {conn.source === 'wecom' && <SetupPanel conn={conn} open={setupOpen || !conn.ready} setOpen={setSetupOpen} onMsg={setNotice} />}
      {notice && <div className={`k-notice ${notice.kind}`} role="status">{notice.text}</div>}

      <section className="k-panel wt-card wt-step" data-n="1">
        <div className="wt-hd"><b>拉取客户和标签库</b>
          {rels.length > 0 && <span className="k-help">{rels.length} 条跟进关系（同一客户被多位成员添加算多条，标签按「成员 + 客户」分别打），标签库 {lib.length} 个标签</span>}
          <span className="wt-grow" />
          <button className="k-btn primary" disabled={!idle || !conn.ready} onClick={() => void pull()}>{busy === 'pull' ? <Loader2 size={15} className="k-spin" /> : rels.length ? <RefreshCw size={15} /> : <Users size={15} />}{rels.length ? '重新拉取' : '拉取客户'}</button>
        </div>
      </section>

      <section className="k-panel wt-card wt-step" data-n="2">
        <div className="wt-hd"><b>打标签规则</b><span className="k-help">命中任意规则就加上对应标签；只新增，不会移除客户已有的标签</span>
          <span className="wt-grow" />
          <button className="k-btn" disabled={!idle} onClick={() => saveRules([...rules, newRule()])}><Plus size={15} />加一条规则</button>
        </div>
        <div className="wt-rules">
          {rules.map((r, i) => (
            <div key={r.id} className="wt-rule">
              <span className="wt-no k-num">{i + 1}</span>
              <select className="k-input" aria-label="条件字段" value={r.field} onChange={(e) => { const f = e.target.value as RuleField; patch(r.id, { field: f, op: FIELD_OPS[f][0][0], value: '' }); }}>
                {(Object.keys(FIELD_LABELS) as RuleField[]).map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
              </select>
              <select className="k-input" aria-label="条件" value={r.op} onChange={(e) => patch(r.id, { op: e.target.value as RuleOp })}>
                {FIELD_OPS[r.field].map(([o, l]) => <option key={o} value={o}>{l}</option>)}
              </select>
              {r.op === 'empty' || r.op === 'notEmpty' ? <span className="wt-val k-muted">—</span>
                : r.field === 'addWay' ? <select className="k-input wt-val" aria-label="添加方式" value={r.value} onChange={(e) => patch(r.id, { value: e.target.value })}><option value="">选择…</option>{[1, 2, 3, 4, 5, 6, 9, 10, 16, 201, 202].map((n) => <option key={n} value={n}>{addWayName(n)}</option>)}</select>
                : r.field === 'type' ? <select className="k-input wt-val" aria-label="客户类型" value={r.value} onChange={(e) => patch(r.id, { value: e.target.value })}><option value="">选择…</option><option value="1">微信用户</option><option value="2">企业微信用户</option></select>
                : <input className="k-input wt-val" aria-label="条件的值" value={r.value} placeholder={r.op === 'contains' ? '关键词，多个用顿号隔开' : r.field === 'ageDays' ? '天数' : '值'} onChange={(e) => patch(r.id, { value: e.target.value })} />}
              <span className="wt-arrow">→ 打标签</span>
              <input className="k-input wt-tag" list="wt-lib" aria-label="标签名" value={r.tag} placeholder="标签名" onChange={(e) => patch(r.id, { tag: e.target.value })} />
              {r.tag.trim() && rels.length > 0 && !lib.some((t) => t.name === r.tag.trim()) && (
                <input className="k-input wt-grp" aria-label="新建标签的标签组" value={r.group} placeholder="标签组" title="标签库里还没有这个标签，会在该标签组下新建" onChange={(e) => patch(r.id, { group: e.target.value })} />
              )}
              <button className="k-btn ghost" aria-label="删除规则" disabled={!idle} onClick={() => saveRules(rules.length > 1 ? rules.filter((x) => x.id !== r.id) : [newRule()])}><Trash2 size={15} /></button>
              {bad[i] && r.tag + r.value !== '' && <span className="wt-bad">{bad[i]}</span>}
            </div>
          ))}
        </div>
        <datalist id="wt-lib">{lib.map((t) => <option key={t.id} value={t.name}>{t.groupName}</option>)}</datalist>

        <label className="wt-check"><input type="checkbox" checked={useAi} disabled={!idle} onChange={(e) => setUseAi(e.target.checked)} /><Sparkles size={14} />再用 AI 根据备注和描述补充分类（可选）</label>
        {useAi && (
          <div className="wt-ai">
            {!llmReady(settings.llm) && !preview && <p className="wt-bad">还没配置大模型：到本工具的「设置」页填接口地址、密钥和模型名（兼容 OpenAI 接口格式）。</p>}
            <p className="k-help">只会把客户的备注、描述、客户企业名、渠道参数发给你配置的大模型，不发客户昵称和 ID；AI 只能从下面勾选的标签里选，不会新建标签。</p>
            <div className="wt-chips" role="group" aria-label="允许 AI 使用的标签">
              {lib.length === 0 && <span className="k-muted">先拉取客户，才有标签库可选</span>}
              {lib.map((t) => (
                <label key={t.id} className={`wt-chip${aiTags.includes(t.name) ? ' on' : ''}`}><input type="checkbox" checked={aiTags.includes(t.name)} onChange={(e) => setAiTags(e.target.checked ? [...aiTags, t.name] : aiTags.filter((n) => n !== t.name))} />{t.name}</label>
              ))}
            </div>
            <input className="k-input" aria-label="给 AI 的补充说明" value={aiHint} placeholder="补充说明（可选），例如：备注里写“问加盟”的是加盟咨询" onChange={(e) => setAiHint(e.target.value)} />
            <div className="wt-hd">
              <button className="k-btn" disabled={!idle || !rels.length || (!llmReady(settings.llm) && !preview)} onClick={() => void runAi()}>{busy === 'ai' ? <Loader2 size={15} className="k-spin" /> : <Sparkles size={15} />}让 AI 分类</button>
              {ai.size > 0 && <span className="k-help">已有 {ai.size} 位客户的 AI 建议，下方方案里标注「AI」</span>}
            </div>
          </div>
        )}
      </section>

      {busy && <div className="wt-progress"><Loader2 size={15} className="k-spin" />{progress || '处理中…'}{busy !== 'pull' && <button className="k-btn" onClick={() => stop.current?.abort()}>停止</button>}</div>}

      {rels.length > 0 && (
        <section className="k-panel wt-card wt-plan wt-step" data-n="3">
          <div className="wt-hd"><b>改动方案</b><span className="k-help">先核对，再执行；只新增标签</span></div>
          <div className="wt-hero" aria-label="改动概览">
            {([['将新增标签', plan.rows.length, 'hit', '条跟进关系'], ['已有标签', plan.alreadyDone, 'done', '条无需改'], ['没命中规则', plan.unmatched, 'miss', '条保持原样']] as const).map(([k, n, c, u]) => (
              <div key={k} className={`wt-big ${c}`}><span className="wt-big-k">{k}</span><b className="k-num">{n}</b><span className="wt-big-u">{u}</span></div>
            ))}
            <div className="wt-bar" aria-hidden>{[plan.rows.length, plan.alreadyDone, plan.unmatched].map((n, i) => <i key={i} className={['hit', 'done', 'miss'][i]} style={{ flexGrow: n }} />)}</div>
          </div>
          {plan.toCreate.size > 0 && <span className="wt-stat warn">需先新建标签 {[...plan.toCreate].flatMap(([g, n]) => n.map((x) => `${g}/${x}`)).join('、')}</span>}
          {plan.rows.length === 0 ? <p className="k-muted">现在的规则没有需要新增的标签。</p> : (
            <div className="k-scroll wt-tablebox">
              <table className="k-table">
                <thead><tr><th>客户</th><th>跟进成员</th><th>添加时间</th><th>备注</th><th>标签：现有 → 新增</th><th>{hasResults ? '结果' : '依据'}</th></tr></thead>
                <tbody>
                  {plan.rows.slice(0, 300).map((p, i) => {
                    const res = hasResults ? results[i] : undefined;
                    return (
                      <tr key={p.key}>
                        <td>{p.rel.name}{p.rel.corpName ? <span className="k-muted"> · {p.rel.corpName}</span> : null}</td>
                        <td className="k-num">{p.rel.userid}</td><td className="k-num">{fmtDate(p.rel.createtime)}</td>
                        <td className="wt-remark">{p.rel.remark || <span className="k-muted">—</span>}</td>
                        <td><span className="wt-diff">{p.rel.tagIds.map((id) => <span key={id} className="wt-oldtag">{lib.find((t) => t.id === id)?.name ?? '其他标签'}</span>)}{p.rel.tagIds.length > 0 && <ArrowRight size={13} className="wt-darrow" aria-hidden />}{p.add.map((n) => <span key={n} className="wt-tagpill">+ {n}</span>)}</span></td>
                        <td>{res ? <span className={`wt-st ${res.status === '成功' ? 'ok' : 'err'}`}>{res.status}{res.error ? `：${res.error}` : ''}</span> : <span className="k-muted">{[...new Set(p.why.map(namesInUse))].join('、')}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {plan.rows.length > 300 && <div className="k-muted wt-more">只显示前 300 条，执行和导出包含全部 {plan.rows.length} 条。</div>}
            </div>
          )}
          <div className="wt-hd wt-foot">
            <span className="wt-grow" />
            {hasResults && <button className="k-btn" onClick={() => void exportCsv()}><Download size={15} />导出结果表</button>}
            {!confirming && <button className="k-btn primary" disabled={!idle || !plan.rows.length || bad.some((b, i) => b && rules[i].tag.trim())} onClick={() => setConfirming(true)}>执行打标签</button>}
            {confirming && (
              <span className="wt-confirm">
                将在{conn.source === 'demo' ? '示例数据' : '企业微信'}里给 {plan.rows.length} 条客户关系新增标签{plan.toCreate.size ? '，并先新建缺少的标签' : ''}。标签不会自动撤回，需要在企业微信里手动去掉。
                <button className="k-btn" onClick={() => setConfirming(false)}>取消</button>
                <button className="k-btn primary" onClick={() => void apply()}><Check size={15} />确认执行</button>
              </span>
            )}
          </div>
        </section>
      )}
      {rels.length === 0 && idle && <section className="k-panel wt-empty">
        <div className="wt-demo" aria-hidden>
          <ul className="wt-d-src"><li>备注：贵宾 生日 6 月</li><li>备注：团购 下午茶</li><li>渠道：小红书笔记</li></ul>
          <span className="wt-d-mid"><Tags size={18} />规则</span>
          <ul className="wt-d-out"><li><i>+</i>重要客户</li><li><i>+</i>团购</li><li><i>+</i>小红书</li></ul>
        </div>
        <b>杂乱的备注，变成整齐的标签</b><span className="k-muted">先在上方连接企业微信（或切到「示例数据」体验），拉取客户后写规则，看过改动方案再执行。</span></section>}
    </div>
  );
}
