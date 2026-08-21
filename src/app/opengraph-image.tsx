import { ImageResponse } from "next/og";

export const alt = "LANDLORD — Naija Edition. Buy Lagos. Own Naija.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0B",
        }}
      >
        <div style={{ display: "flex", fontSize: 104, fontWeight: 800, color: "#F5F5F4", letterSpacing: -2 }}>
          LANDLORD
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#00A859", marginTop: 4 }}>
          Naija Edition
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#8A8A93", marginTop: 40 }}>
          Buy Lagos. Own Naija.
        </div>
      </div>
    ),
    { ...size },
  );
}
