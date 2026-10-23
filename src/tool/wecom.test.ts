// 企业微信接口层：地址拼接、错误码翻译、token 缓存与失效重取、分页拉取客户。用模拟企业应答，不访问网络。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WxError, addCorpTags, addWayName, clearTokenCache, getCorpTags, getToken, ipFromErrmsg, markTag, parseWx, pullRelations, urls, withToken, type Http,
} from './wecom';
import { MOCK_CORP, createMockWecom } from './mock';

const NOW = Date.UTC(2026, 9, 23, 2, 0);
beforeEach(() => clearTokenCache());

describe('请求构造与错误码', () => {
  it('接口地址与官方文档一致', () => {
    expect(urls.token('ww1', 'a&b')).toBe('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww1&corpsecret=a%26b');
    expect(urls.batchGet('T')).toBe('https://qyapi.weixin.qq.com/cgi-bin/externalcontact/batch/get_by_user?access_token=T');
    expect(urls.markTag('T')).toBe('https://qyapi.weixin.qq.com/cgi-bin/externalcontact/mark_tag?access_token=T');
    expect(urls.list('T', 'zhang san')).toBe('https://qyapi.weixin.qq.com/cgi-bin/externalcontact/list?access_token=T&userid=zhang%20san');
  });
  it('errcode 非 0 抛出中文提示', () => {
    expect(() => parseWx(200, '{"errcode":48002,"errmsg":"api forbidden"}')).toThrow(/客户联系 → 可调用接口的应用/);
    expect(() => parseWx(200, '{"errcode":99999,"errmsg":"something, hint: [x], more info at https://open.work.weixin.qq.com"}')).toThrow('企业微信接口返回错误 99999：something');
    expect(() => parseWx(502, '<html>')).toThrow('无法识别');
    expect(parseWx<{ a: number }>(200, '{"errcode":0,"errmsg":"ok","a":1}').a).toBe(1);
  });
  it('60020 提示配置企业可信IP，能取到 IP 时一并写出', () => {
    try { parseWx(200, '{"errcode":60020,"errmsg":"not allow to access from your ip, from ip: 1.2.3.4, more info at x"}'); } catch (e) {
      expect(e).toBeInstanceOf(WxError);
      expect((e as Error).message).toContain('企业可信IP');
      expect((e as Error).message).toContain('1.2.3.4');
    }
    expect(ipFromErrmsg('no ip here')).toBeNull();
  });
  it('add_way 中文名', () => {
    expect(addWayName(1)).toBe('扫描二维码');
    expect(addWayName(202)).toBe('管理员/负责人分配');
    expect(addWayName(99)).toBe('其他（99）');
  });
});

describe('token', () => {
  it('企业 ID 错误给出提示；正确时缓存，不重复请求', async () => {
    const m = createMockWecom(NOW);
    await expect(getToken(m.http, { corpId: 'wwbad', secret: 'x' })).rejects.toThrow(/企业 ID（corpid）不对/);
    await expect(getToken(m.http, { corpId: MOCK_CORP.corpId, secret: 'x' })).rejects.toThrow(/Secret 不对/);
    expect(await getToken(m.http, MOCK_CORP, NOW)).toBe('MOCK_TOKEN');
    await getToken(m.http, MOCK_CORP, NOW + 3600_000);
    expect(m.calls.filter((c) => c.url.includes('/gettoken'))).toHaveLength(3);
    await getToken(m.http, MOCK_CORP, NOW + 7000_000);
    expect(m.calls.filter((c) => c.url.includes('/gettoken'))).toHaveLength(4);
  });
  it('token 被提前作废（42001）时自动换新重试一次', async () => {
    const m = createMockWecom(NOW);
    let first = true;
    const http: Http = async (url, init) => {
      if (!url.includes('/gettoken') && first) { first = false; return { status: 200, text: async () => '{"errcode":42001,"errmsg":"access_token expired"}' }; }
      return m.http(url, init);
    };
    const tags = await withToken(http, MOCK_CORP, (t) => getCorpTags(http, t));
    expect(tags.length).toBe(10);
  });
});

describe('客户与标签', () => {
  it('按 100 个成员一组、按 next_cursor 翻页拉全', async () => {
    const m = createMockWecom(NOW, { count: 64, pageSize: 20 });
    const steps: string[] = [];
    const r = await pullRelations(m.http, 'MOCK_TOKEN', (s) => steps.push(s));
    expect(r.users).toEqual(['xiaoli', 'xiaozhou', 'xiaowang', 'laochen']);
    expect(r.relations).toHaveLength(65);
    const batchCalls = m.calls.filter((c) => c.url.includes('batch/get_by_user'));
    expect(batchCalls).toHaveLength(4);
    expect(batchCalls[0].body).toEqual({ userid_list: r.users, cursor: '', limit: 100 });
    expect(batchCalls[1].body).toMatchObject({ cursor: '20' });
    const one = r.relations[0];
    expect(one.externalUserid).toMatch(/^wmDEMO/);
    expect(typeof one.createtime).toBe('number');
    expect(steps.at(-1)).toContain('65');
  });
  it('标签库、新建标签、打标签', async () => {
    const m = createMockWecom(NOW);
    const lib = await getCorpTags(m.http, 'T');
    expect(lib.find((t) => t.name === '会员意向')).toMatchObject({ id: 'tag_member', groupName: '意向' });
    const made = await addCorpTags(m.http, 'T', '活动', ['双十一']);
    expect(made[0]).toMatchObject({ name: '双十一', groupName: '活动' });
    const rel = m.rels[0];
    await markTag(m.http, 'T', rel.userid, rel.external_userid, [made[0].id, 'tag_vip']);
    expect(rel.tag_id).toEqual(expect.arrayContaining([made[0].id, 'tag_vip']));
    expect(m.calls.at(-1)!.body).toEqual({ userid: rel.userid, external_userid: rel.external_userid, add_tag: [made[0].id, 'tag_vip'] });
    await expect(markTag(m.http, 'T', 'nobody', rel.external_userid, ['tag_vip'])).rejects.toThrow(/不存在外部联系人关系/);
    await expect(markTag(m.http, 'T', rel.userid, rel.external_userid, [])).rejects.toThrow('不能同时为空');
  });
});
