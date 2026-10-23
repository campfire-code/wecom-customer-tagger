// 桌面端请求函数：Tauri HTTP 插件（没有跨域限制），给 wecom.ts 用
import { httpFetch } from '../kit/platform';
import type { Http } from './wecom';

export const tauriHttp: Http = async (url, init = {}) => {
  const res = await httpFetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/abort|timeout/i.test(msg) ? '连接企业微信超时，请检查网络' : `连不上企业微信：${msg}`);
  });
  return { status: res.status, text: () => res.text() };
};
