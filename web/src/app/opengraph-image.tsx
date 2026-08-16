import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "玩玩可物 AI Media Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * ⚠️ 改下面这三行文字，必须同时重新生成字体子集，否则新字会变成豆腐块。
 *
 * 字体是「按这几行字裁出来的子集」，只含实际用到的 34 个字符（三个字重共 23KB）。
 * 不裁的话得带整套 Noto Sans SC，好几 MB 进仓库，不值。
 * 重新生成的命令见 src/app/fonts/README.md。
 */
const LOGO = "W";
const TITLE = "WANWAN KEWU";
const TAGLINE = "想得出，就玩得出";
const SUBTITLE = "Images · Video · Audio · 3D — say it, play it, make it";

const FONT = "Noto Sans SC";

/*
 * 字体必须显式传进来。
 *
 * 不传时 @vercel/og 会在渲染期去 fonts.googleapis.com 现拉中文回退字体，
 * 而 Railway 的构建容器连不上 Google——它 catch 住错误只打一行日志，
 * 构建照样成功，但标语会渲染成一排豆腐块，而这张图正是分享到微信/X 时的门面。
 *
 * 放 public/ 而不是 src/：运行镜像只拷 .next / public / node_modules / prisma / scripts，
 * src/ 不在里面。这张图现在是构建期预渲染的，可一旦哪天变成动态渲染，
 * 从 src/ 读就会在线上 ENOENT。
 */
async function loadFonts() {
  const dir = join(process.cwd(), "public", "fonts", "og");
  const weights = [400, 700, 900] as const;
  const files = await Promise.all(
    weights.map((w) => readFile(join(dir, `NotoSansSC-og-${w}.ttf`)))
  );
  return weights.map((weight, i) => ({
    name: FONT,
    data: files[i],
    weight,
    style: "normal" as const,
  }));
}

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          color: "white",
          background: "#09090b",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 720,
            height: 720,
            left: -180,
            top: -260,
            borderRadius: 999,
            background: "rgba(249,115,22,.32)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 620,
            height: 620,
            right: -180,
            bottom: -300,
            borderRadius: 999,
            background: "rgba(251,191,36,.18)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 54, padding: "84px 94px", zIndex: 1 }}>
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 54,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg,#fb923c,#f97316 55%,#ea580c)",
              boxShadow: "0 30px 90px rgba(249,115,22,.35)",
            }}
          >
            <div style={{ fontSize: 142, lineHeight: 1, fontWeight: 900 }}>{LOGO}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 710 }}>
            <div style={{ fontSize: 66, fontWeight: 900, letterSpacing: -2 }}>{TITLE}</div>
            <div style={{ marginTop: 14, fontSize: 42, fontWeight: 700, color: "#fed7aa" }}>
              {TAGLINE}
            </div>
            <div style={{ marginTop: 28, fontSize: 27, lineHeight: 1.45, color: "#a1a1aa" }}>
              {SUBTITLE}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await loadFonts() }
  );
}
