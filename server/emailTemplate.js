import { ZONES } from './content/topics.js';

/** Renders the "your rebuilt lesson is ready" email preview (inline-CSS HTML). */
export function rebuildEmailHtml({ userName, topicTitle, zone, depth, supportNote }) {
  const z = ZONES[zone];
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#04121f;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;padding-bottom:28px;">
      <div style="font-size:26px;font-weight:700;color:#7fd8e8;letter-spacing:0.5px;">OceanMind</div>
      <div style="font-size:12px;color:#5d8296;letter-spacing:0.25em;text-transform:uppercase;margin-top:4px;">Depth-based AI learning</div>
    </div>
    <div style="background:linear-gradient(180deg,#0a2237,#071627);border:1px solid rgba(127,216,232,0.25);border-radius:20px;padding:32px 28px;color:#d7ecf3;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#ffffff;">Your new dive is ready, ${userName} 🌊</h1>
      <p style="margin:0 0 18px;line-height:1.6;color:#a9c6d4;">
        Our support team reviewed your feedback on <strong style="color:#ffffff;">${topicTitle}</strong>
        and rebuilt the experience just for you.
      </p>
      <div style="background:rgba(127,216,232,0.08);border:1px solid rgba(127,216,232,0.2);border-radius:14px;padding:16px 18px;margin-bottom:18px;">
        <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#7fd8e8;margin-bottom:6px;">New calibration</div>
        <div style="font-size:16px;color:#ffffff;">${z.label} · ${z.range} · diving at ${depth.toLocaleString()} m</div>
      </div>
      ${supportNote ? `<p style="margin:0 0 18px;line-height:1.6;color:#a9c6d4;"><em>“${supportNote}”</em><br><span style="font-size:12px;color:#5d8296;">— the OceanMind support team</span></p>` : ''}
      <div style="text-align:center;padding-top:6px;">
        <span style="display:inline-block;background:#16b8d8;color:#04121f;font-weight:700;padding:12px 28px;border-radius:999px;">Open your new lesson →</span>
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#3f6070;margin-top:24px;">
      The new experience is also waiting in your OceanMind account.
    </p>
  </div>
</body>
</html>`;
}
