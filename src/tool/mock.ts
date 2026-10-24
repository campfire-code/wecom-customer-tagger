// 模拟的企业微信：没有企业账号时用来体验和测试。按官方文档的返回字段格式应答，数据全部是虚构的示例。
// 同一个 seed + now 生成的数据完全相同；打标签、新建活码会改动内存里的数据，就像真的接口一样。
import { API, type Http } from './wecom';

export const MOCK_CORP = { corpId: 'ww_demo_corp', secret: 'demo-secret' };

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const REMARKS: [string, string][] = [
  ['老客户 复购三次', '喜欢新品，每月都来'], ['咨询会员卡', '问了储值优惠'], ['团购 公司下午茶', '行政采购，量大'], ['投诉过一次配送慢', '已道歉并补券'],
  ['朋友推荐', ''], ['只买特价', '对价格敏感'], ['问加盟', '想在本地开店，留了电话'], ['宝妈 周末带娃', '关注亲子活动'],
  ['', ''], ['', '展会扫码加的'], ['贵宾 生日 6 月', '生日送过蛋糕'], ['价格太贵 再看看', ''], ['已下单 待回访', '首单 199 元'], ['', ''],
];
const STATES = ['xhs_note', 'store_poster', 'expo_2026', 'live_room', '', '', ''];
const ADD_WAYS = [1, 1, 1, 2, 3, 4, 6, 16, 201];

export const MOCK_USERS = ['xiaoli', 'xiaozhou', 'xiaowang', 'laochen'];
export const MOCK_TAG_GROUPS: { id: string; name: string; tags: [string, string][] }[] = [
  { id: 'grp_level', name: '客户等级', tags: [['tag_vip', '重要客户'], ['tag_normal', '普通客户'], ['tag_new', '新客户']] },
  { id: 'grp_intent', name: '意向', tags: [['tag_member', '会员意向'], ['tag_group', '团购'], ['tag_join', '加盟咨询'], ['tag_price', '价格敏感']] },
  { id: 'grp_source', name: '来源', tags: [['tag_xhs', '小红书'], ['tag_store', '门店'], ['tag_expo', '展会']] },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface MockRel {
  userid: string; external_userid: string; name: string; type: number; corp_name: string;
  remark: string; description: string; createtime: number; tag_id: string[]; state: string; add_way: number; oper_userid: string;
}
interface MockWay { config_id: string; type: number; scene: number; remark: string; state: string; skip_verify: boolean; user: string[]; qr_code: string }

export interface MockWecom {
  http: Http;
  rels: MockRel[];
  ways: MockWay[];
  calls: { url: string; body?: unknown }[];
}

/** 生成一个模拟企业：4 个成员、约 count 条客户关系、3 组标签、4 个渠道活码 */
export function createMockWecom(now: number, opts: { seed?: number; count?: number; pageSize?: number } = {}): MockWecom {
  const rand = rng(opts.seed ?? 7);
  const count = opts.count ?? 64;
  const nowSec = Math.floor(now / 1000);
  const rels: MockRel[] = [];
  for (let i = 0; i < count; i++) {
    const userid = MOCK_USERS[i % MOCK_USERS.length];
    const [remark, description] = REMARKS[Math.floor(rand() * REMARKS.length)];
    const state = STATES[Math.floor(rand() * STATES.length)];
    const ageDays = Math.floor(rand() ** 1.6 * 120);
    const surname = SURNAMES[Math.floor(rand() * SURNAMES.length)];
    const ext = `wmDEMO${String(i + 1).padStart(4, '0')}`;
    rels.push({
      userid, external_userid: ext,
      name: `${surname}${rand() < 0.55 ? '女士' : '先生'}`,
      type: rand() < 0.85 ? 1 : 2,
      corp_name: rand() < 0.15 ? '示例商贸有限公司' : '',
      remark, description,
      createtime: nowSec - ageDays * 86400 - Math.floor(rand() * 36000),
      tag_id: rand() < 0.3 ? ['tag_normal'] : [],
      state: state ? state : '',
      add_way: state ? 1 : ADD_WAYS[Math.floor(rand() * ADD_WAYS.length)],
      oper_userid: rand() < 0.6 ? ext : userid,
    });
  }
  // 同一个客户也加了第二个成员（真实企业里常见）
  if (rels.length > 5) rels.push({ ...rels[2], userid: MOCK_USERS[(MOCK_USERS.indexOf(rels[2].userid) + 1) % MOCK_USERS.length], remark: '', description: '', tag_id: [], createtime: rels[2].createtime + 86400 });
  rels.sort((a, b) => a.createtime - b.createtime);

  const ways: MockWay[] = [
    { config_id: 'cfg_demo_xhs', type: 2, scene: 2, remark: '小红书笔记', state: 'xhs_note', skip_verify: true, user: ['xiaoli', 'xiaozhou'], qr_code: '' },
    { config_id: 'cfg_demo_store', type: 1, scene: 2, remark: '门店海报', state: 'store_poster', skip_verify: true, user: ['xiaowang'], qr_code: '' },
    { config_id: 'cfg_demo_expo', type: 2, scene: 2, remark: '展会易拉宝', state: 'expo_2026', skip_verify: false, user: ['laochen', 'xiaoli'], qr_code: '' },
    { config_id: 'cfg_demo_live', type: 1, scene: 2, remark: '直播间', state: 'live_room', skip_verify: true, user: ['xiaozhou'], qr_code: '' },
  ];
  const groups = MOCK_TAG_GROUPS.map((g) => ({ ...g, tags: [...g.tags] }));
  const calls: MockWecom['calls'] = [];
  let seq = 0;
  const ok = (data: object) => ({ status: 200, text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok', ...data }) });
  const err = (errcode: number, errmsg: string) => ({ status: 200, text: async () => JSON.stringify({ errcode, errmsg }) });
  const pageSize = opts.pageSize ?? 100;

  const http: Http = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const path = url.slice(API.length).split('?')[0];
    const q = new URL(url).searchParams;
    switch (path) {
      case '/gettoken':
        if (q.get('corpid') !== MOCK_CORP.corpId) return err(40013, 'invalid corpid');
        if (q.get('corpsecret') !== MOCK_CORP.secret) return err(40001, 'invalid credential');
        return ok({ access_token: 'MOCK_TOKEN', expires_in: 7200 });
      case '/externalcontact/get_follow_user_list':
        return ok({ follow_user: MOCK_USERS });
      case '/externalcontact/batch/get_by_user': {
        const list = rels.filter((r) => body.userid_list.includes(r.userid));
        const start = Number(body.cursor || 0);
        const limit = Math.min(body.limit ?? 50, 100, pageSize);
        const page = list.slice(start, start + limit);
        return ok({
          external_contact_list: page.map((r) => ({
            external_contact: { external_userid: r.external_userid, name: r.name, type: r.type, avatar: '', gender: 0, ...(r.corp_name ? { corp_name: r.corp_name } : {}) },
            follow_info: { userid: r.userid, remark: r.remark, description: r.description, createtime: r.createtime, tag_id: [...r.tag_id], remark_corp_name: '', remark_mobiles: [], oper_userid: r.oper_userid, add_way: r.add_way, ...(r.state ? { state: r.state } : {}) },
          })),
          next_cursor: start + limit < list.length ? String(start + limit) : '',
        });
      }
      case '/externalcontact/get_corp_tag_list':
        return ok({ tag_group: groups.map((g, gi) => ({ group_id: g.id, group_name: g.name, create_time: 1700000000, order: gi, tag: g.tags.map(([id, name], ti) => ({ id, name, create_time: 1700000000, order: ti })) })) });
      case '/externalcontact/add_corp_tag': {
        let g = groups.find((x) => x.name === body.group_name);
        if (!g) { g = { id: `grp_new_${++seq}`, name: body.group_name, tags: [] }; groups.push(g); }
        const added: [string, string][] = [];
        for (const t of body.tag as { name: string }[]) {
          const hit = g.tags.find(([, n]) => n === t.name);
          if (hit) { added.push(hit); continue; }
          const tag: [string, string] = [`tag_new_${++seq}`, t.name];
          g.tags.push(tag);
          added.push(tag);
        }
        return ok({ tag_group: { group_id: g.id, group_name: g.name, create_time: Math.floor(now / 1000), tag: added.map(([id, name]) => ({ id, name, create_time: Math.floor(now / 1000), order: 0 })) } });
      }
      case '/externalcontact/mark_tag': {
        const r = rels.find((x) => x.userid === body.userid && x.external_userid === body.external_userid);
        if (!r) return err(84061, 'not external contact');
        const all = new Set(groups.flatMap((g) => g.tags.map(([id]) => id)));
        if ([...(body.add_tag ?? []), ...(body.remove_tag ?? [])].some((t: string) => !all.has(t))) return err(40068, 'invalid tagid');
        r.tag_id = [...new Set([...r.tag_id.filter((t) => !(body.remove_tag ?? []).includes(t)), ...(body.add_tag ?? [])])];
        return ok({});
      }
      case '/externalcontact/add_contact_way': {
        const w: MockWay = { config_id: `cfg_new_${++seq}`, type: body.type, scene: body.scene, remark: body.remark ?? '', state: body.state ?? '', skip_verify: body.skip_verify ?? true, user: body.user ?? [], qr_code: '' };
        ways.push(w);
        return ok({ config_id: w.config_id, ...(w.scene === 2 ? { qr_code: w.qr_code } : {}) });
      }
      case '/externalcontact/get_contact_way': {
        const w = ways.find((x) => x.config_id === body.config_id);
        if (!w) return { status: 404, text: async () => 'not found' };
        return ok({ contact_way: { ...w, is_temp: false } });
      }
      case '/externalcontact/list_contact_way':
        return ok({ contact_way: ways.map((w) => ({ config_id: w.config_id })), next_cursor: '' });
      case '/externalcontact/get_user_behavior_data': {
        const days: object[] = [];
        const start = Math.floor(body.start_time / 86400) * 86400;
        const end = Math.floor(body.end_time / 86400) * 86400;
        const r2 = rng((body.userid ?? []).join('').length * 31 + start / 86400);
        for (let t = start; t <= end; t += 86400) {
          const chat = Math.floor(r2() * 14);
          days.push({
            stat_time: t, new_apply_cnt: Math.floor(r2() * 3), new_contact_cnt: Math.floor(r2() * 4), chat_cnt: chat, message_cnt: chat * (2 + Math.floor(r2() * 4)),
            ...(chat ? { reply_percentage: Math.round((60 + r2() * 40) * 100) / 100, avg_reply_time: Math.floor(r2() * 40) } : {}),
            negative_feedback_cnt: r2() < 0.18 ? 1 : 0,
          });
        }
        return ok({ behavior_data: days });
      }
      default:
        return { status: 404, text: async () => 'not found' };
    }
  };
  return { http, rels, ways, calls };
}
