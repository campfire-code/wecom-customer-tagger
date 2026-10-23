// 企业微信「客户联系」官方接口（服务端 API，域名 qyapi.weixin.qq.com）。
// 接口地址、参数与限制核对自企业微信开发者中心文档（developer.work.weixin.qq.com），2026-10-23：
//   GET  /cgi-bin/gettoken?corpid=ID&corpsecret=SECRET                         path/91039  有效期 7200 秒，可能提前失效，需缓存
//   GET  /cgi-bin/externalcontact/get_follow_user_list                          path/92571  配置了客户联系功能的成员
//   GET  /cgi-bin/externalcontact/list?userid=USERID                            path/92113  某成员添加的客户 external_userid
//   POST /cgi-bin/externalcontact/batch/get_by_user                             path/92994  userid_list 最多 100 个，limit 最大 100，next_cursor 翻页
//   POST /cgi-bin/externalcontact/get_corp_tag_list                             path/92117  企业标签库
//   POST /cgi-bin/externalcontact/add_corp_tag                                  path/92117  标签 / 标签组名最长 30 个字符，企业最多 10000 个标签
//   POST /cgi-bin/externalcontact/mark_tag                                      path/92118  userid + external_userid + add_tag / remove_tag
//   POST /cgi-bin/externalcontact/add_contact_way | get_contact_way | list_contact_way   path/92228  「联系我」
//   POST /cgi-bin/externalcontact/get_user_behavior_data                        path/92132  按成员按天的联系客户统计
// 权限：自建应用要配置到「客户联系 可调用接口的应用」里；应用只能拿到可见范围内的成员；
//       2023-12-01 起不再支持用系统应用 secret 调用（存量企业暂不受影响）。
// 请求的构造与响应的解析都是纯函数；真正发请求的 http 函数从外面传入，测试和示例模式里用模拟响应代替。

export const API = 'https://qyapi.weixin.qq.com/cgi-bin';
const ext = (p: string, token: string, q = '') => `${API}/externalcontact/${p}?access_token=${encodeURIComponent(token)}${q}`;
export const urls = {
  token: (corpId: string, secret: string) => `${API}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
  followUsers: (t: string) => ext('get_follow_user_list', t),
  list: (t: string, userid: string) => ext('list', t, `&userid=${encodeURIComponent(userid)}`),
  batchGet: (t: string) => ext('batch/get_by_user', t),
  corpTags: (t: string) => ext('get_corp_tag_list', t),
  addCorpTag: (t: string) => ext('add_corp_tag', t),
  markTag: (t: string) => ext('mark_tag', t),
  addContactWay: (t: string) => ext('add_contact_way', t),
  getContactWay: (t: string) => ext('get_contact_way', t),
  listContactWay: (t: string) => ext('list_contact_way', t),
  behavior: (t: string) => ext('get_user_behavior_data', t),
};

/** 全局错误码（path/90313）里核对过含义的部分 → 中文提示 */
const ERRORS: Record<number, string> = {
  [-1]: '企业微信系统繁忙，请稍后再试',
  40001: 'Secret 不对。请确认填的是「自建应用」的 Secret，并且和企业 ID 属于同一个企业',
  40013: '企业 ID（corpid）不对，请到管理后台「我的企业 → 企业信息」底部核对',
  40014: 'access_token 不合法，请重试',
  40056: 'agentid 不合法',
  40068: '标签或标签组 ID 不存在，可能已在后台删除，请重新同步标签库',
  40096: '客户的 external_userid 不合法',
  40098: '成员尚未实名认证',
  41001: '缺少 access_token 参数',
  41054: '该成员尚未激活',
  42001: 'access_token 已过期，请重试',
  45009: '接口调用超过频率限制，请过一会儿再试（按分钟拦截约 60 秒后解除）',
  45033: '接口并发调用超过限制，请稍后再试',
  48002: '这个应用没有调用该接口的权限。请在管理后台把它加入「客户联系 → 可调用接口的应用」',
  60011: '应用对指定的成员、部门或标签没有权限，请把成员加进应用的可见范围',
  60111: '成员 UserID 不存在',
  84061: '该成员和这个客户之间不存在外部联系人关系（客户可能已删除）',
  84074: '没有外部联系人权限，请把应用加入「客户联系 → 可调用接口的应用」',
  701008: '这些成员都没有已激活的互通账号',
};

export class WxError extends Error {
  constructor(public code: number, public raw: string, message: string) {
    super(message);
  }
}

/** 60020 的报错文字里一般带着企业微信看到的来源 IP（格式未用真实账号核对，取不到就不显示） */
export function ipFromErrmsg(errmsg: string): string | null {
  return errmsg.match(/from ip:?\s*([0-9a-fA-F.:]+)/i)?.[1]?.replace(/[,.]$/, '') ?? null;
}

export function wxErrorText(code: number, errmsg = ''): string {
  if (code === 60020) {
    const ip = ipFromErrmsg(errmsg);
    return `本机的公网 IP 不在应用的「企业可信IP」里${ip ? `（企业微信看到的 IP 是 ${ip}）` : ''}。请到管理后台「应用管理 → 这个自建应用 → 企业可信IP」里加入本机所在网络的公网出口 IP，约 1 分钟后生效。注意：动态 IP 会变，需要固定 IP（错误码 60020）`;
  }
  const base = ERRORS[code];
  const short = errmsg.replace(/,?\s*hint:.*$/i, '').replace(/,?\s*more info at \S+/i, '').trim();
  return base ? `${base}（错误码 ${code}）` : `企业微信接口返回错误 ${code}${short ? `：${short}` : ''}`;
}

/** 解析企业微信接口的 JSON：errcode 非 0 时抛出带中文说明的错误 */
export function parseWx<T>(status: number, text: string): T {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WxError(status, text, `企业微信接口返回了无法识别的内容（HTTP ${status}）`);
  }
  const code = typeof data.errcode === 'number' ? data.errcode : 0;
  if (code !== 0) throw new WxError(code, String(data.errmsg ?? ''), wxErrorText(code, String(data.errmsg ?? '')));
  if (status >= 400) throw new WxError(status, text, `企业微信接口请求失败（HTTP ${status}）`);
  return data as T;
}

// ---------- 发请求（http 从外面传入） ----------

export interface HttpResponse { status: number; text(): Promise<string> }
export type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export async function call<T>(http: Http, url: string, body?: unknown): Promise<T> {
  const res = await http(url, body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parseWx<T>(res.status, await res.text());
}

export interface WecomCred { corpId: string; secret: string }
export const CRED_KEY = 'wecom';
export const credReady = (c: WecomCred) => Boolean(c.corpId.trim() && c.secret.trim());

/** access_token 缓存：按企业 + Secret 区分，提前 5 分钟换新；企业微信可能提前让它失效，遇到 40014 / 42001 时清掉重取 */
const tokenCache = new Map<string, { token: string; expireAt: number }>();
export const clearTokenCache = () => tokenCache.clear();

export async function getToken(http: Http, cred: WecomCred, now = Date.now()): Promise<string> {
  const corpId = cred.corpId.trim();
  const secret = cred.secret.trim();
  if (!corpId || !secret) throw new Error('还没有填写企业 ID 和 Secret');
  const key = `${corpId}\n${secret}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expireAt - 300_000 > now) return hit.token;
  const r = await call<{ access_token: string; expires_in: number }>(http, urls.token(corpId, secret));
  tokenCache.set(key, { token: r.access_token, expireAt: now + r.expires_in * 1000 });
  return r.access_token;
}

/** 带 token 调用；token 失效（40014 / 42001）时自动换新重试一次 */
export async function withToken<T>(http: Http, cred: WecomCred, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getToken(http, cred));
  } catch (e) {
    if (e instanceof WxError && (e.code === 40014 || e.code === 42001)) {
      clearTokenCache();
      return fn(await getToken(http, cred));
    }
    throw e;
  }
}

// ---------- 客户 ----------

/** add_way 取值（path/92114「获取客户详情」） */
export const ADD_WAYS: Record<number, string> = {
  0: '未知来源', 1: '扫描二维码', 2: '搜索手机号', 3: '名片分享', 4: '群聊', 5: '手机通讯录', 6: '微信联系人',
  8: '安装第三方应用时自动添加的客服人员', 9: '搜索邮箱', 10: '视频号添加', 11: '日程参与人', 12: '会议参与人',
  13: '添加微信好友对应的企业微信', 14: '智慧硬件专属客服', 15: '上门服务客服', 16: '获客链接', 17: '定制开发',
  18: '需求回复', 21: '第三方售前客服', 22: '可能的商务伙伴', 24: '接受微信账号收到的好友申请', 201: '内部成员共享', 202: '管理员/负责人分配',
};
export const addWayName = (n: number | undefined) => (n === undefined ? '' : ADD_WAYS[n] ?? `其他（${n}）`);

/** 一条「成员 - 客户」跟进关系（同一个客户被多个成员添加时有多条） */
export interface Relation {
  userid: string;
  externalUserid: string;
  name: string;
  /** 1 微信用户，2 企业微信用户 */
  type: number;
  corpName: string;
  /** 添加时间（秒） */
  createtime: number;
  remark: string;
  description: string;
  tagIds: string[];
  state: string;
  addWay?: number;
  operUserid: string;
}

interface RawBatch {
  external_contact_list?: {
    external_contact: { external_userid: string; name?: string; type?: number; corp_name?: string };
    follow_info: { userid: string; remark?: string; description?: string; createtime?: number; tag_id?: string[]; state?: string; add_way?: number; oper_userid?: string };
  }[];
  next_cursor?: string;
  fail_info?: { unlicensed_userid_list?: string[] };
}

export function toRelations(raw: RawBatch): Relation[] {
  return (raw.external_contact_list ?? []).map(({ external_contact: c, follow_info: f }) => ({
    userid: f.userid,
    externalUserid: c.external_userid,
    name: c.name ?? '',
    type: c.type ?? 1,
    corpName: c.corp_name ?? '',
    createtime: f.createtime ?? 0,
    remark: f.remark ?? '',
    description: f.description ?? '',
    tagIds: f.tag_id ?? [],
    state: f.state ?? '',
    addWay: f.add_way,
    operUserid: f.oper_userid ?? '',
  }));
}

export async function getFollowUsers(http: Http, token: string): Promise<string[]> {
  return (await call<{ follow_user?: string[] }>(http, urls.followUsers(token))).follow_user ?? [];
}

export interface PullResult { users: string[]; relations: Relation[]; unlicensed: string[] }

/** 拉全部客户关系：先取配置了客户联系的成员，再按每 100 个成员一组批量取客户详情（每页 100 条，按 next_cursor 翻页） */
export async function pullRelations(http: Http, token: string, onStep?: (text: string) => void, signal?: AbortSignal): Promise<PullResult> {
  const users = await getFollowUsers(http, token);
  const relations: Relation[] = [];
  const unlicensed: string[] = [];
  for (let i = 0; i < users.length; i += 100) {
    const group = users.slice(i, i + 100);
    let cursor = '';
    do {
      if (signal?.aborted) throw new Error('已停止');
      const r = await call<RawBatch>(http, urls.batchGet(token), { userid_list: group, cursor, limit: 100 });
      relations.push(...toRelations(r));
      unlicensed.push(...(r.fail_info?.unlicensed_userid_list ?? []));
      cursor = r.next_cursor ?? '';
      onStep?.(`正在拉取客户：已取到 ${relations.length} 条跟进关系…`);
    } while (cursor);
  }
  return { users, relations, unlicensed: [...new Set(unlicensed)] };
}

// ---------- 企业标签 ----------

export interface CorpTag { id: string; name: string; groupId: string; groupName: string }

export async function getCorpTags(http: Http, token: string): Promise<CorpTag[]> {
  const r = await call<{ tag_group?: { group_id: string; group_name: string; tag?: { id: string; name: string; deleted?: boolean }[] }[] }>(http, urls.corpTags(token), {});
  return (r.tag_group ?? []).flatMap((g) => (g.tag ?? []).filter((t) => !t.deleted).map((t) => ({ id: t.id, name: t.name, groupId: g.group_id, groupName: g.group_name })));
}

/** 在指定标签组（按名字，不存在时会新建该组）下新建标签，返回新标签 */
export async function addCorpTags(http: Http, token: string, groupName: string, names: string[]): Promise<CorpTag[]> {
  const r = await call<{ tag_group: { group_id: string; group_name: string; tag?: { id: string; name: string }[] } }>(http, urls.addCorpTag(token), {
    group_name: groupName,
    tag: names.map((name) => ({ name })),
  });
  const g = r.tag_group;
  return (g.tag ?? []).map((t) => ({ id: t.id, name: t.name, groupId: g.group_id, groupName: g.group_name }));
}

export async function markTag(http: Http, token: string, userid: string, externalUserid: string, addTag: string[], removeTag: string[] = []): Promise<void> {
  if (!addTag.length && !removeTag.length) throw new Error('add_tag 与 remove_tag 不能同时为空');
  const body: Record<string, unknown> = { userid, external_userid: externalUserid };
  if (addTag.length) body.add_tag = addTag;
  if (removeTag.length) body.remove_tag = removeTag;
  await call(http, urls.markTag(token), body);
}

// ---------- 「联系我」 ----------

export interface ContactWay {
  configId: string;
  /** 1 单人，2 多人 */
  type: number;
  remark: string;
  state: string;
  qrCode: string;
  users: string[];
  skipVerify: boolean;
}

export interface NewContactWay { type: 1 | 2; remark: string; state: string; users: string[]; skipVerify: boolean }

/** 「联系我」的 remark 与 state 都最长 30 个字符；单人类型只能有 1 个成员；每个最多 100 个成员（path/92228） */
export function checkContactWay(w: NewContactWay): string | null {
  if (!w.state.trim()) return '渠道参数 state 不能为空，统计时就靠它区分渠道';
  if ([...w.state].length > 30) return '渠道参数 state 最长 30 个字符';
  if ([...w.remark].length > 30) return '备注最长 30 个字符';
  if (!w.users.length) return '至少选择 1 个使用成员';
  if (w.type === 1 && w.users.length !== 1) return '单人活码只能选 1 个成员；要多人轮流接待请选「多人」';
  if (w.users.length > 100) return '每个活码最多 100 个使用成员';
  return null;
}

export async function addContactWay(http: Http, token: string, w: NewContactWay): Promise<{ configId: string; qrCode: string }> {
  const r = await call<{ config_id: string; qr_code?: string }>(http, urls.addContactWay(token), {
    type: w.type, scene: 2, remark: w.remark, skip_verify: w.skipVerify, state: w.state, user: w.users,
  });
  return { configId: r.config_id, qrCode: r.qr_code ?? '' };
}

export async function getContactWay(http: Http, token: string, configId: string): Promise<ContactWay> {
  const r = await call<{ contact_way: { config_id: string; type?: number; remark?: string; state?: string; qr_code?: string; user?: string[]; skip_verify?: boolean } }>(http, urls.getContactWay(token), { config_id: configId });
  const c = r.contact_way;
  return { configId: c.config_id, type: c.type ?? 1, remark: c.remark ?? '', state: c.state ?? '', qrCode: c.qr_code ?? '', users: c.user ?? [], skipVerify: c.skip_verify ?? true };
}

/** list_contact_way 只返回 config_id（只能取到 2021-07-10 以后创建的、非临时会话的），时间默认最近 90 天，limit 最大 1000 */
export async function listContactWayIds(http: Http, token: string, startTime?: number, endTime?: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor = '';
  do {
    const body: Record<string, unknown> = { limit: 1000 };
    if (startTime) body.start_time = startTime;
    if (endTime) body.end_time = endTime;
    if (cursor) body.cursor = cursor;
    const r = await call<{ contact_way?: { config_id: string }[]; next_cursor?: string }>(http, urls.listContactWay(token), body);
    ids.push(...(r.contact_way ?? []).map((c) => c.config_id));
    cursor = r.next_cursor ?? '';
  } while (cursor);
  return ids;
}

// ---------- 联系客户统计 ----------

export interface BehaviorDay {
  statTime: number;
  newApply: number;
  newContact: number;
  chat: number;
  message: number;
  replyPercentage?: number;
  avgReplyTime?: number;
  negativeFeedback: number;
}

/** 单次最多 30 天、最近 180 天；传多个成员时返回的是合计，所以要分成员看就逐个调用（path/92132） */
export async function getBehavior(http: Http, token: string, userids: string[], startTime: number, endTime: number): Promise<BehaviorDay[]> {
  const r = await call<{ behavior_data?: { stat_time: number; new_apply_cnt?: number; new_contact_cnt?: number; chat_cnt?: number; message_cnt?: number; reply_percentage?: number; avg_reply_time?: number; negative_feedback_cnt?: number }[] }>(
    http, urls.behavior(token), { userid: userids, start_time: startTime, end_time: endTime },
  );
  return (r.behavior_data ?? []).map((d) => ({
    statTime: d.stat_time, newApply: d.new_apply_cnt ?? 0, newContact: d.new_contact_cnt ?? 0, chat: d.chat_cnt ?? 0, message: d.message_cnt ?? 0,
    replyPercentage: d.reply_percentage, avgReplyTime: d.avg_reply_time, negativeFeedback: d.negative_feedback_cnt ?? 0,
  }));
}

/** 逐个发请求时的间隔，避免触发频率限制（企业每分钟 1 万次的上限远高于这里） */
export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(new Error('已停止')); }, { once: true });
});
