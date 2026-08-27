# 无极助手云端授权系统 TODO

## 1. 后端与数据库 (Phase 1)
- [ ] 在 `drizzle/schema.ts` 中定义 `activation_codes` 表 (激活码, 状态, 机器码绑定, 时间戳)
- [ ] 生成并执行数据库迁移 SQL
- [ ] 在 `server/db.ts` 中添加激活码查询、创建和绑定的辅助函数

## 2. 管理后台 UI (Phase 2)
- [ ] 设计梦幻渐变风格的全局 CSS 主题 (`client/src/index.css`)
- [ ] 实现后台管理页面 (`client/src/pages/Admin.tsx`)：生成激活码、搜索、列表展示
- [ ] 实现激活码状态切换 (启用/禁用) 和复制功能
- [ ] 限制管理后台仅管理员 (Owner) 可进入

## 3. 联网验证 API (Phase 3)
- [ ] 在 `server/routers.ts` 中实现 `publicProcedure.auth.verify` 接口
- [ ] 逻辑：检查码是否存在 -> 检查是否禁用 -> 检查是否已绑定 -> 首次绑定机器码 -> 返回结果
- [ ] 编写 Vitest 测试确保验证逻辑安全可靠

## 4. 桌面端联调 (Phase 4)
- [ ] 修改桌面端 `electron/main.cjs`，将本地验证改为请求云端 API
- [ ] 更新桌面端激活 UI，显示联网验证状态
- [ ] 交付最终后台链接与桌面端更新包
