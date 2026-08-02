import { ImageResponse } from "next/og";

export const alt = "玩玩可物 AI Media Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
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
          fontFamily: "sans-serif",
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
            <div style={{ fontSize: 142, lineHeight: 1, fontWeight: 900 }}>W</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 710 }}>
            <div style={{ fontSize: 66, fontWeight: 900, letterSpacing: -2 }}>WANWAN KEWU</div>
            <div style={{ marginTop: 14, fontSize: 42, fontWeight: 700, color: "#fed7aa" }}>
              想得出，就玩得出
            </div>
            <div style={{ marginTop: 28, fontSize: 27, lineHeight: 1.45, color: "#a1a1aa" }}>
              Images · Video · Audio · 3D — say it, play it, make it
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
