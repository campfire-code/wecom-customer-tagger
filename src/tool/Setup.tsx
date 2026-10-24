// 企业微信连接设置：企业 ID + 自建应用 Secret（只存本机），前置条件说明，测试连接；以及「示例数据」体验模式。
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, KeyRound, Loader2 } from 'lucide-react';
import { settingsStore } from '../kit/platform';
import { CRED_KEY, clearTokenCache, credReady, getFollowUsers, getToken, type Http, type WecomCred } from './wecom';
import { MOCK_CORP, createMockWecom, type MockWecom } from './mock';
import { tauriHttp } from './net';

export type Source = 'wecom' | 'demo';
const EMPTY: WecomCred = { corpId: '', secret: '' };

export interface Conn {
  source: Source;
  setSource(s: Source): void;
  cred: WecomCred;
  saveCred(c: WecomCred): Promise<void>;
  /** 当前数据来源对应的请求函数与凭证（示例模式用模拟企业） */
  http: Http;
  activeCred: WecomCred;
  ready: boolean;
  mock: MockWecom;
}

/** 读取本机保存的凭证；预览页不读本机设置，直接用示例数据 */
export function useConn(preview: boolean, now = Date.now()): Conn {
  const [cred, setCred] = useState<WecomCred>(EMPTY);
  const [source, setSourceState] = useState<Source>(preview ? 'demo' : 'wecom');
  const mock = useMemo(() => createMockWecom(now), []);
  useEffect(() => {
    if (preview) return;
    (async () => {
      try {
        const st = await settingsStore();
        const c = (await st.get<WecomCred>(CRED_KEY)) ?? EMPTY;
        setCred(c);
        const s = await st.get<Source>(`${CRED_KEY}.source`);
        setSourceState(s ?? (credReady(c) ? 'wecom' : 'demo'));
      } catch { /* 首次打开 */ }
    })();
  }, [preview]);
  const setSource = (s: Source) => {
    setSourceState(s);
    if (!preview) settingsStore().then((st) => st.set(`${CRED_KEY}.source`, s)).catch(() => {});
  };
  const saveCred = async (c: WecomCred) => {
    setCred(c);
    clearTokenCache();
    if (!preview) { try { await (await settingsStore()).set(CRED_KEY, c); } catch { /* 预览页 */ } }
  };
  const demo = source === 'demo';
  return { source, setSource, cred, saveCred, http: demo ? mock.http : tauriHttp, activeCred: demo ? MOCK_CORP : cred, ready: demo || credReady(cred), mock };
}

export function SourceSwitch({ conn, disabled }: { conn: Conn; disabled?: boolean }) {
  return (
    <div className="k-seg wx-src" role="radiogroup" aria-label="数据来源">
      {([['wecom', '企业微信'], ['demo', '示例数据']] as const).map(([v, l]) => (
        <button key={v} role="radio" aria-checked={conn.source === v} className={conn.source === v ? 'on' : ''} disabled={disabled} onClick={() => conn.setSource(v)}>{l}</button>
      ))}
    </div>
  );
}

export function SetupPanel({ conn, open, setOpen, onMsg }: { conn: Conn; open: boolean; setOpen(v: boolean): void; onMsg(m: { kind: 'ok' | 'err'; text: string }): void }) {
  const [draft, setDraft] = useState<WecomCred>(conn.cred);
  const [testing, setTesting] = useState(false);
  useEffect(() => setDraft(conn.cred), [conn.cred]);
  const ok = credReady(conn.cred);
  const changed = draft.corpId !== conn.cred.corpId || draft.secret !== conn.cred.secret;
  return (
    <section className="k-panel wx-setup" aria-label="企业微信设置">
      <button className="wx-setup-hd" aria-expanded={open} onClick={() => setOpen(!open)}>
        <KeyRound size={15} /><b>企业微信设置</b>
        <span className={`k-st ${ok ? 'ok' : 'wait'}`}>{ok ? `已填写 ${conn.cred.corpId.slice(0, 6)}…` : '未填写'}</span>
        <ChevronDown size={15} className={`wx-chev${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="wx-setup-body">
          <div className="wx-setup-grid">
            <div className="k-field"><label className="k-label" htmlFor="wx-corp">企业 ID</label><input id="wx-corp" className="k-input" autoComplete="off" value={draft.corpId} placeholder="管理后台里的企业 ID，共 18 位" onChange={(e) => setDraft({ ...draft, corpId: e.target.value })} /></div>
            <div className="k-field"><label className="k-label" htmlFor="wx-secret">自建应用的 Secret（应用密钥）</label><input id="wx-secret" className="k-input" type="password" autoComplete="off" value={draft.secret} placeholder="应用详情里的 Secret" onChange={(e) => setDraft({ ...draft, secret: e.target.value })} /></div>
          </div>
          <ol className="wx-pre">
            <li>企业 ID 在管理后台「我的企业 → 企业信息」里查看；Secret 用<b>自建应用</b>的（2023 年 12 月 1 日起，新企业不能再用系统应用的 Secret 调接口）。</li>
            <li>在管理后台的客户联系设置里，把这个自建应用加入<b>「客户联系 可调用接口的应用」</b>，否则会提示没有权限。</li>
            <li>应用的<b>可见范围</b>要包含需要处理的成员，成员还要开通了客户联系功能。</li>
            <li>在应用详情里配置<b>「企业可信IP」</b>，填本机所在网络的公网出口 IP（要固定 IP，动态 IP 会变），否则报 60020。</li>
          </ol>
          <p className="k-help">企业 ID 和 Secret 只保存在这台电脑上，不会上传到别处。</p>
          <div className="wx-row">
            <button className="k-btn primary" disabled={!changed} onClick={async () => { await conn.saveCred({ corpId: draft.corpId.trim(), secret: draft.secret.trim() }); onMsg({ kind: 'ok', text: '企业微信设置已保存在本机' }); }}>保存</button>
            <button className="k-btn" disabled={!credReady(draft) || testing} onClick={async () => {
              setTesting(true);
              try {
                const c = { corpId: draft.corpId.trim(), secret: draft.secret.trim() };
                await conn.saveCred(c);
                const users = await getFollowUsers(tauriHttp, await getToken(tauriHttp, c));
                conn.setSource('wecom');
                onMsg({ kind: 'ok', text: `连接成功：能读取 ${users.length} 位开通了客户联系的成员` });
                setOpen(false);
              } catch (e) {
                onMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
              }
              setTesting(false);
            }}>{testing && <Loader2 size={15} className="k-spin" />}{testing ? '测试中…' : '保存并测试连接'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
