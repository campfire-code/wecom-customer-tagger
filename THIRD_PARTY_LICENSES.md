# 第三方开源组件

本工具使用了以下开源组件，许可证原文见各项目仓库。

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) 及官方插件 | 桌面应用框架 | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react) | 界面 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 图标 | ISC |
| [Vite](https://github.com/vitejs/vite) | 构建 | MIT |
| [ExcelJS](https://github.com/exceljs/exceljs) | 模板自带依赖（本工具未使用，导出结果为 CSV） | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 单元测试（仅开发时） | MIT |

## 接口与数据

- 本工具只调用企业微信官方服务端 API（`qyapi.weixin.qq.com`），接口说明见 [企业微信开发者中心](https://developer.work.weixin.qq.com/)。没有复制任何第三方工具的代码。
- 「示例数据」里的企业、成员和客户全部是虚构内容。
