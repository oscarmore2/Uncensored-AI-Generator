# Google 收录与 SEO 上线清单

本项目已内置页面 Metadata、canonical、`robots.txt`、动态 `sitemap.xml`、网站图标、Web App Manifest、Open Graph 分享图、结构化数据和私有路由 `noindex`。

## 上线前必须配置

1. `APP_URL` 必须是最终、可公开访问的 HTTPS 主域名，且不带末尾 `/`。它会用于 canonical、sitemap 和结构化数据，域名错误会向搜索引擎发送错误信号。
2. 在 Google Search Console 新增该域名。推荐使用 Domain Property 的 DNS 验证；若使用 HTML meta tag 验证，将 `content="..."` 中的内容填入 `GOOGLE_SITE_VERIFICATION`，不要粘贴整段标签。
3. 部署后确认以下地址返回 `200`：
   - `/robots.txt`
   - `/sitemap.xml`
   - `/manifest.webmanifest`
   - `/icon.svg`
   - `/opengraph-image`
4. 在 Search Console 提交 `https://你的域名/sitemap.xml`，再使用 URL Inspection 请求抓取首页、探索页和价格页。

## 当前索引边界

- sitemap 只包含公开静态页和已发布、非 18+ 的社区作品。
- 登录、创作中心、历史、个人中心、后台、审核台和 API 同时使用 robots 规则、页面 meta 与 `X-Robots-Tag` 降低误收录风险。
- 18+ 作品详情明确返回 `noindex`，且不会进入 sitemap。
- 搜索筛选参数统一 canonical 到 `/explore`，避免重复的筛选结果页稀释权重。

## 内容与关键词运营

- 关键词要自然出现在可见标题、正文、图片替代文本和站内链接中；不要堆砌或隐藏关键词。
- 每个长期公开的作品应使用准确标题、完整但自然的提示词说明，并尽量提供稳定缩略图。
- 重点专题应建立独立、可链接的落地页，例如 AI 文字生图、AI 文字生视频、AI 图片转视频。每页需要独立标题、描述、正文和示例，不能只复制首页。
- 定期从 Search Console 的 Performance 报告查看真实查询词、曝光、点击和索引问题，再更新内容。
- 不创建虚假评分或评论数据。结构化数据必须与页面实际可见内容一致。

## 多语言限制

第一阶段语言通过 Cookie 切换，中文和英文共用同一个 URL，因此搜索引擎通常只会把它当作一个 canonical 页面。若希望中英文分别获得稳定排名，第二阶段应改成 `/zh-CN/...` 与 `/en/...` 独立 URL，并输出双向 `hreflang`。

## 合规上线仍需人工补充

技术功能无法单独保证任何司法辖区的法律合规。正式运营前应由运营方与法律顾问确认并在条款中补充：

- 运营主体法定名称、注册地址、客服与隐私联系渠道；
- 适用法律、管辖地、消费者退款与订阅续费规则；
- 支付、年龄验证、AI 推理、对象存储等处理方清单与跨境依据；
- Cookie 分类、实际分析服务、同意记录和撤回方式；
- 著作权、肖像权、隐私投诉与申诉流程。

没有真实资料时，不应在页面中虚构公司名称、地址、许可证、评分或认证。
