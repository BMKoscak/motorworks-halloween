// Livery artwork drawn on canvases and projected onto the car in its own (rest) space:
// the side canvas maps (z, y) for side-facing surfaces, the top canvas maps (z, x) for
// up-facing surfaces. u = 0 is the rear bumper, u = 1 the front.

function bandY(info, y, H) {
  return H - (y / info.maxY) * H;
}

function flamesPath(g, x0, x1, yMid, spread, n, seed = 1) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const y = yMid + (i - (n - 1) / 2) * spread * 0.55;
    const len = (x1 - x0) * (0.55 + rnd() * 0.45);
    const tip = x1 - len;
    const w = spread * (0.45 + rnd() * 0.3);
    g.beginPath();
    g.moveTo(x1, y - w);
    g.bezierCurveTo(x1 - len * 0.35, y - w * 1.3, tip + len * 0.25, y - w * 0.2, tip, y + w * 0.15 * (rnd() - 0.5));
    g.bezierCurveTo(tip + len * 0.3, y + w * 0.6, x1 - len * 0.4, y + w * 1.2, x1, y + w);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

function flameGradient(g, x0, x1) {
  const grd = g.createLinearGradient(x1, 0, x0, 0);
  grd.addColorStop(0, '#fff36b');
  grd.addColorStop(0.35, '#ffb000');
  grd.addColorStop(0.7, '#ff4a00');
  grd.addColorStop(1, '#b3111a');
  return grd;
}

function bolt(g, x, y, len, ang, width) {
  g.beginPath();
  g.moveTo(x, y);
  let px = x, py = y;
  for (let i = 0; i < 6; i++) {
    px += Math.cos(ang) * len / 6 + (i % 2 ? 1 : -1) * width;
    py += Math.sin(ang) * len / 6 + (i % 2 ? -1 : 1) * width * 0.6;
    g.lineTo(px, py);
  }
  g.stroke();
}

function pumpkinFace(g, cx, cy, r, orange = '#ff7a00') {
  g.fillStyle = orange;
  g.beginPath(); g.ellipse(cx, cy, r * 1.15, r, 0, 0, 7); g.fill();
  g.strokeStyle = '#a84300'; g.lineWidth = Math.max(2, r * 0.06);
  for (const dx of [-0.5, 0, 0.5]) { g.beginPath(); g.ellipse(cx + dx * r, cy, r * 0.35, r * 0.98, 0, 0, 7); g.stroke(); }
  g.fillStyle = '#140805';
  const tri = (x, y, s) => { g.beginPath(); g.moveTo(x - s, y + s * 0.7); g.lineTo(x + s, y + s * 0.7); g.lineTo(x, y - s * 0.8); g.fill(); };
  tri(cx - r * 0.42, cy - r * 0.22, r * 0.22);
  tri(cx + r * 0.42, cy - r * 0.22, r * 0.22);
  tri(cx, cy + r * 0.05, r * 0.12);
  g.beginPath();
  g.moveTo(cx - r * 0.65, cy + r * 0.3);
  for (let i = 0; i <= 8; i++) g.lineTo(cx - r * 0.65 + (i * r * 1.3) / 8, cy + r * (i % 2 ? 0.42 : 0.62));
  g.lineTo(cx + r * 0.65, cy + r * 0.3);
  g.quadraticCurveTo(cx, cy + r * 0.82, cx - r * 0.65, cy + r * 0.3);
  g.fill();
}

export function drawLivery(side, top, id, info, color2) {
  const gs = side.getContext('2d'), gt = top.getContext('2d');
  const SW = side.width, SH = side.height, TW = top.width, TH = top.height;
  gs.clearRect(0, 0, SW, SH);
  gt.clearRect(0, 0, TW, TH);
  const zU = (z) => ((z - info.minZ) / (info.maxZ - info.minZ));
  const yTop = bandY(info, info.belt - 0.04, SH), yBot = bandY(info, info.yb + 0.08, SH);
  const yMid = (yTop + yBot) / 2, band = yBot - yTop;
  const hoodX0 = zU(info.cowlZ) * TW, frontX = TW;
  gs.lineJoin = gt.lineJoin = 'round';
  switch (id) {
    case 'stripes': {
      gt.fillStyle = color2;
      for (const s of [-1, 1]) gt.fillRect(0, TH / 2 + s * TH * 0.085 - TH * 0.035, TW, TH * 0.07);
      gs.fillStyle = color2;
      gs.fillRect(zU(info.minZ + 0.3) * SW, yBot - band * 0.12, SW * 0.88, band * 0.07);
      break;
    }
    case 'flames': {
      gs.strokeStyle = '#5a0a05'; gs.lineWidth = 4;
      gs.fillStyle = flameGradient(gs, SW * 0.35, SW);
      flamesPath(gs, SW * 0.35, SW, yMid, band * 0.55, 5, 7);
      gt.strokeStyle = '#5a0a05'; gt.lineWidth = 4;
      gt.fillStyle = flameGradient(gt, hoodX0 - TW * 0.05, frontX);
      flamesPath(gt, hoodX0 - TW * 0.08, frontX, TH / 2, TH * 0.2, 7, 3);
      break;
    }
    case 'ribcage': {
      const bone = '#f3ead2';
      gs.strokeStyle = bone; gs.lineCap = 'round';
      gs.lineWidth = band * 0.07;
      gs.beginPath(); gs.moveTo(SW * 0.18, yMid); gs.lineTo(SW * 0.78, yMid); gs.stroke();
      gs.lineWidth = band * 0.05;
      for (let x = SW * 0.24; x < SW * 0.74; x += SW * 0.055) {
        for (const s of [-1, 1]) {
          gs.beginPath(); gs.moveTo(x, yMid);
          gs.quadraticCurveTo(x - SW * 0.03, yMid + s * band * 0.45, x + SW * 0.02, yMid + s * band * 0.42); gs.stroke();
        }
      }
      const sx = SW * 0.86, r = band * 0.33;
      gs.fillStyle = bone; gs.beginPath(); gs.arc(sx, yMid - r * 0.1, r, 0, 7); gs.fill();
      gs.fillRect(sx - r * 0.55, yMid + r * 0.6, r * 1.1, r * 0.5);
      gs.fillStyle = '#111';
      for (const dx of [-0.4, 0.4]) { gs.beginPath(); gs.arc(sx + dx * r, yMid - r * 0.15, r * 0.24, 0, 7); gs.fill(); }
      gs.beginPath(); gs.moveTo(sx, yMid + r * 0.15); gs.lineTo(sx - r * 0.12, yMid + r * 0.38); gs.lineTo(sx + r * 0.12, yMid + r * 0.38); gs.fill();
      for (let i = -2; i <= 2; i++) gs.fillRect(sx + i * r * 0.2 - 1.5, yMid + r * 0.62, 3, r * 0.45);
      gt.strokeStyle = bone; gt.lineCap = 'round'; gt.lineWidth = TH * 0.04;
      gt.beginPath(); gt.moveTo(0, TH / 2); gt.lineTo(TW, TH / 2); gt.stroke();
      gt.lineWidth = TH * 0.025;
      for (let x = TW * 0.08; x < TW * 0.95; x += TW * 0.06) {
        gt.beginPath(); gt.moveTo(x, TH * 0.12); gt.quadraticCurveTo(x + TW * 0.03, TH / 2, x, TH * 0.88); gt.stroke();
      }
      break;
    }
    case 'pumpkin': {
      gs.fillStyle = '#111';
      const cx = zU(info.doorZ) * SW;
      for (let i = 0; i < 26; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) gs.fillRect(i * SW / 26, yBot - band * 0.18 + j * band * 0.08, SW / 26, band * 0.08);
      pumpkinFace(gs, cx, yMid - band * 0.05, band * 0.42);
      gs.fillStyle = '#fff'; gs.fillRect(cx + band * 0.6, yMid - band * 0.35, band * 0.55, band * 0.45);
      gs.fillStyle = '#111'; gs.font = `bold ${Math.round(band * 0.38)}px Arial`; gs.textAlign = 'center'; gs.textBaseline = 'middle';
      gs.fillText('13', cx + band * 0.875, yMid - band * 0.12);
      pumpkinFace(gt, (hoodX0 + frontX) / 2, TH / 2, TH * 0.28);
      break;
    }
    case 'police': {
      gs.fillStyle = '#f4f4f4';
      gs.fillRect(zU(info.doorZ - 0.85) * SW, yTop + band * 0.05, SW * 0.36, band * 0.8);
      gs.fillStyle = '#111'; gs.font = `bold ${Math.round(band * 0.3)}px Arial`; gs.textAlign = 'center'; gs.textBaseline = 'middle';
      gs.fillText('POLICE', zU(info.doorZ - 0.85) * SW + SW * 0.18, yMid + band * 0.12);
      gs.fillStyle = '#d4af37';
      const bx = zU(info.doorZ - 0.85) * SW + SW * 0.18, by = yMid - band * 0.22, br = band * 0.13;
      gs.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? br * 0.45 : br; gs.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); }
      gs.fill();
      gt.fillStyle = '#f4f4f4';
      gt.fillRect(zU(info.roofZ0) * TW, TH * 0.15, (zU(info.roofZ1) - zU(info.roofZ0)) * TW, TH * 0.7);
      gt.fillStyle = '#111'; gt.font = 'bold 120px Arial'; gt.textAlign = 'center'; gt.textBaseline = 'middle';
      gt.save(); gt.translate(((zU(info.roofZ0) + zU(info.roofZ1)) / 2) * TW, TH / 2); gt.rotate(Math.PI / 2); gt.fillText('13', 0, 0); gt.restore();
      break;
    }
    case 'monster': {
      gs.strokeStyle = '#39ff14'; gs.lineWidth = band * 0.06; gs.shadowColor = '#39ff14'; gs.shadowBlur = 12;
      for (let i = 0; i < 5; i++) bolt(gs, SW * (0.15 + i * 0.16), yTop + band * 0.1, band * 0.85, Math.PI / 2 + 0.5, band * 0.12);
      gt.strokeStyle = '#39ff14'; gt.lineWidth = TH * 0.03; gt.shadowColor = '#39ff14'; gt.shadowBlur = 14;
      for (let i = 0; i < 6; i++) bolt(gt, TW * (0.1 + i * 0.15), TH * 0.1, TH * 0.8, Math.PI / 2 + 0.3, TH * 0.06);
      gs.shadowBlur = gt.shadowBlur = 0;
      break;
    }
    default:
      break;
  }
}

/** Tire sidewall decoration texture (planar-mapped onto a RingGeometry). */
export function tireLetteringTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const cx = 256, ro = 256, ri = 256 * (0.255 / 0.345);
  g.clearRect(0, 0, 512, 512);
  if (kind === 'whitewall') {
    g.fillStyle = '#f2f0ea';
    g.beginPath(); g.arc(cx, cx, ri + (ro - ri) * 0.75, 0, 7); g.arc(cx, cx, ri + (ro - ri) * 0.12, 0, 7, true); g.fill();
  } else if (kind === 'redline') {
    g.strokeStyle = '#d0121b'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cx, ri + (ro - ri) * 0.55, 0, 7); g.stroke();
  } else if (kind === 'letters') {
    const text = 'MOTORWORKS  ·  HALLOWEEN  ·  MOTORWORKS  ·  HALLOWEEN  ·  ';
    g.fillStyle = '#f2f0ea';
    g.font = 'bold 30px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const r = ri + (ro - ri) * 0.5;
    for (let i = 0; i < text.length; i++) {
      const a = (i / text.length) * Math.PI * 2;
      g.save(); g.translate(cx + Math.cos(a) * r, cx + Math.sin(a) * r); g.rotate(a + Math.PI / 2); g.fillText(text[i], 0, 0); g.restore();
    }
  }
  return c;
}
