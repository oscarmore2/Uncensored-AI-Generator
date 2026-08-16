# 自托管字体

这两个 woff2 直接进仓库，不在构建期下载。

原因：用 `next/font/google` 时，字体文件由构建过程去 `fonts.gstatic.com` 取，
于是构建机的出网能力成了部署的硬依赖。Railway 的构建容器连不上 gstatic，
`next build` 直接失败（内建的三次重试也全败）。运行期正确性不该被构建机的
网络状况决定，所以文件入库。

## 文件

| 文件 | 来源 | 许可 |
| --- | --- | --- |
| `Inter-latin-var.woff2` | Google Fonts, Inter v20 | SIL OFL 1.1 |
| `NotoSansSC-latin-var.woff2` | Google Fonts, Noto Sans SC v40 | SIL OFL 1.1 |

两个都是**可变字体**，`wght` 轴 100–900，一个文件覆盖全部字重。
两个都只含 **latin 子集**（`U+0000-00FF` 那一段），不含任何汉字——
中文走 `globals.css` 里 `system-ui` 的兜底，一直如此。

真要让中文也用 Noto Sans SC，得再拉约 100 个分片、数 MB，那是产品取舍，
不是这里能顺手加的。

## 怎么更新

Google Fonts 给 CJK 分片的 URL 带会话级哈希，**每次请求都变**，
所以必须在同一轮里取 URL 并立刻下载，隔一次请求再下就是 404：

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# Inter：非分片，URL 稳定，从 CSS 里挑 latin 那段即可
curl -sSf -A "$UA" 'https://fonts.googleapis.com/css2?family=Inter:wght@300..900&display=swap' \
  | awk '/@font-face/{b=""} {b=b $0 "\n"} /^}/{ if (b ~ /U\+0000-00FF/) print b }' \
  | grep -o 'https://fonts.gstatic.com[^)]*'

# Noto Sans SC：取 URL 与下载必须连在一起
url=$(curl -sSf -A "$UA" 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300..700&display=swap' \
  | awk '/@font-face/{b=""} {b=b $0 "\n"} /^}/{ if (b ~ /U\+0000-00FF/) print b }' \
  | grep -o 'https://fonts.gstatic.com[^)]*')
curl -sSf -A "$UA" "$url" -o NotoSansSC-latin-var.woff2
```

换完确认一下头四个字节是 `wOF2`——404 页面也会被 `-o` 老老实实存成文件。

## OG 图的字体（`public/fonts/og/`）

分享卡片 `src/app/opengraph-image.tsx` 另有一套，和上面两个无关：

- satori **不支持 woff2**，必须是 TTF/OTF；
- `ImageResponse` 的 `fonts` 选项是**替换**默认字体（源码 `fonts: options.fonts || defaultFonts`），
  所以传了就得连拉丁一起覆盖，不能只补中文；
- 放在 `public/` 而不是 `src/`，因为运行镜像不拷 `src/`。

字体按图上实际出现的字符裁成子集，三个字重共约 23KB。
**改了图上的文字就得重新生成**，否则新字是豆腐块：

```bash
cd web && python3 - <<'PY'
import urllib.request, urllib.parse, re
# 与 opengraph-image.tsx 里的 LOGO/TITLE/TAGLINE/SUBTITLE 保持一致
TEXT = "W" + "WANWAN KEWU" + "想得出，就玩得出" + "Images · Video · Audio · 3D — say it, play it, make it"
chars = "".join(sorted(set(TEXT)))
# 旧 UA 才会返回 truetype，新 UA 给的是 woff2
UA = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1"
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=30).read()
for w in (400, 700, 900):
    css = get("https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@%d&text=%s" % (w, urllib.parse.quote(chars))).decode()
    url = re.search(r"src: url\((.+?)\) format\('(?:opentype|truetype)'\)", css).group(1)
    open("public/fonts/og/NotoSansSC-og-%d.ttf" % w, "wb").write(get(url))
    print(w, "ok")
PY
```

生成完跑一次 `npm run build`，把 `.next/server/app/opengraph-image.body` 当 PNG 打开看一眼——
缺字不会报错，只会安静地变成 □。
