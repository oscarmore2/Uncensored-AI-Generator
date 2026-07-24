# 自动媒体清理

## 默认策略

- 所有上传物：创建 7 天后清理。
- 非 VIP 创建的生成媒体：创建 7 天后清理。
- VIP 创建的生成媒体：永久保留。
- 审核员精选的基础创作：永久保留。
- 作品创建超过 7 天后不能再设为精选。

策略以“创建时的 VIP 状态”为准，避免用户会员到期后突然删除此前承诺永久保留的媒体。管理员可在 `/admin/media-cleanup` 修改各类保留天数或设为永不过期。保存会重算现有未精选媒体的到期时间。

清理会先删除本站当前对象存储中可识别的对象，再清空生成记录中的媒体 URL；业务记录、提示词、扣点和审计信息仍保留。外部生成服务的临时 URL 无法由本站删除，但到期后也会从本站记录中移除。

## Railway Cron 部署

清理器应作为独立 Railway Cron Service 运行，不放在 Next.js 进程内做 `setInterval`：

1. 在同一 Railway Project 中新增一个 Service，连接相同仓库。
2. Root Directory 使用 `web`。
3. Config-as-code 文件设为 `/railway.cleanup.toml`。
4. 为 Web Service 和 Cron Service 配置相同的 `MEDIA_CLEANUP_SECRET`。
5. Cron Service 配置：
   - `APP_URL`：Web Service 的稳定公网地址。
   - `MEDIA_CLEANUP_BATCH_SIZE`：默认 `100`，最大 `500`。
6. 默认表达式 `0 * * * *` 为每小时整点（UTC）执行一次。

Cron 容器只调用受 Bearer Secret 保护的 `/api/internal/media-cleanup`，完成后立即退出。Railway 在上一次执行尚未结束时会跳过下一次，避免定时任务自然重叠。

## 运维顺序

首次启用建议先打开 `/admin/media-cleanup`，执行“试运行”核对预计清理数量，再启动 Cron Service。正式清理是永久操作；对象存储应同时配置生命周期规则作为兜底，但生命周期规则不应早于应用显示的到期时间。
