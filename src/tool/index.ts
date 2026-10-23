// 工具声明：企微客户标签批量整理（自定义界面；请求只发往企业微信官方接口 qyapi.weixin.qq.com）。
import { Tags } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'w06',
  name: '企微客户标签批量整理',
  tagline: '官方接口拉客户，按规则或 AI 批量打标签',
  icon: Tags,
  category: '微信私域',
  type: 'data',
  mode: 'custom',
  mainLabel: '客户标签',
  needsLLM: false,
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
