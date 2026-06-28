import {
  listVideos,
  listTagsWithCounts,
  getVideoTags,
  listScreenshots,
  listClips,
  type Video,
  type Tag,
} from '../db';
import { fmtTime } from '../lib/format';

type NodeKind = 'video' | 'tag' | 'clip' | 'screenshot';

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  // simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
  // visual radius
  r: number;
  // domain payload (for click handlers / tooltip)
  videoId?: string;
  tagName?: string;
  rating?: number;
  thumbnail?: string;
  timeSec?: number;
  startSec?: number;
  endSec?: number;
  channel?: string;
}

interface GraphEdge {
  a: GraphNode;
  b: GraphNode;
  // ideal length
  length: number;
}

const canvas = document.getElementById('graph') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const tooltipEl = document.getElementById('tooltip')!;
const emptyEl = document.getElementById('empty')!;
const showTagsEl = document.getElementById('show-tags') as HTMLInputElement;
const showClipsEl = document.getElementById('show-clips') as HTMLInputElement;
const showShotsEl = document.getElementById('show-shots') as HTMLInputElement;
const resetBtn = document.getElementById('reset-view') as HTMLButtonElement;

const COLORS: Record<NodeKind, string> = {
  video: '#818cf8',
  tag: '#fbbf24',
  clip: '#34d399',
  screenshot: '#f472b6',
};

const RADIUS: Record<NodeKind, number> = {
  video: 14,
  tag: 8,
  clip: 5,
  screenshot: 5,
};

const EDGE_LEN: Record<NodeKind, number> = {
  video: 90,
  tag: 70,
  clip: 35,
  screenshot: 35,
};

const view = { scale: 1, tx: 0, ty: 0 };
let nodes: GraphNode[] = [];
let edges: GraphEdge[] = [];
let allNodes: GraphNode[] = [];
let allEdges: GraphEdge[] = [];

let hoverNode: GraphNode | null = null;
let dragNode: GraphNode | null = null;
let panFromX = 0;
let panFromY = 0;
let panStartTx = 0;
let panStartTy = 0;
let panning = false;
let pressMovedDist = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(x: number, y: number): [number, number] {
  return [x * view.scale + view.tx, y * view.scale + view.ty];
}

function screenToWorld(x: number, y: number): [number, number] {
  return [(x - view.tx) / view.scale, (y - view.ty) / view.scale];
}

function makeNode(partial: Omit<GraphNode, 'x' | 'y' | 'vx' | 'vy' | 'r'> & { r?: number }): GraphNode {
  return {
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200,
    vx: 0,
    vy: 0,
    r: partial.r ?? RADIUS[partial.kind],
    ...partial,
  };
}

async function buildGraph() {
  const videos = await listVideos();
  if (videos.length === 0) {
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  const tagsMeta = await listTagsWithCounts();
  const tagsById = new Map<number, Tag & { count: number }>();
  for (const t of tagsMeta) if (t.id != null) tagsById.set(t.id, t);

  const videoNodes = new Map<string, GraphNode>();
  for (const v of videos) {
    const node = makeNode({
      id: `v:${v.videoId}`,
      kind: 'video',
      label: v.title,
      videoId: v.videoId,
      rating: v.rating,
      thumbnail: v.thumbnail,
      channel: v.channel,
    });
    videoNodes.set(v.videoId, node);
  }

  const tagNodes = new Map<string, GraphNode>();
  const builtEdges: GraphEdge[] = [];

  for (const v of videos) {
    const linkedTags = await getVideoTags(v.videoId);
    for (const t of linkedTags) {
      const key = t.name;
      let tNode = tagNodes.get(key);
      if (!tNode) {
        const count = t.id != null ? tagsById.get(t.id)?.count ?? 0 : 0;
        const r = Math.min(18, RADIUS.tag + Math.log2(count + 1) * 1.5);
        tNode = makeNode({
          id: `t:${key}`,
          kind: 'tag',
          label: `#${key}`,
          tagName: key,
          r,
        });
        tagNodes.set(key, tNode);
      }
      const vNode = videoNodes.get(v.videoId)!;
      builtEdges.push({ a: vNode, b: tNode, length: EDGE_LEN.tag });
    }
  }

  const clipNodes: GraphNode[] = [];
  const allClips = await loadAllClips(videos);
  for (const c of allClips) {
    const vNode = videoNodes.get(c.videoId);
    if (!vNode) continue;
    const node = makeNode({
      id: `c:${c.id}`,
      kind: 'clip',
      label: `${fmtTime(c.startSec)}–${fmtTime(c.endSec)}`,
      videoId: c.videoId,
      startSec: c.startSec,
      endSec: c.endSec,
    });
    node.x = vNode.x + (Math.random() - 0.5) * 40;
    node.y = vNode.y + (Math.random() - 0.5) * 40;
    clipNodes.push(node);
    builtEdges.push({ a: vNode, b: node, length: EDGE_LEN.clip });
  }

  const shotNodes: GraphNode[] = [];
  const allShots = await loadAllShots(videos);
  for (const s of allShots) {
    const vNode = videoNodes.get(s.videoId);
    if (!vNode) continue;
    const node = makeNode({
      id: `s:${s.id}`,
      kind: 'screenshot',
      label: fmtTime(s.timeSec),
      videoId: s.videoId,
      timeSec: s.timeSec,
    });
    node.x = vNode.x + (Math.random() - 0.5) * 40;
    node.y = vNode.y + (Math.random() - 0.5) * 40;
    shotNodes.push(node);
    builtEdges.push({ a: vNode, b: node, length: EDGE_LEN.screenshot });
  }

  allNodes = [
    ...videoNodes.values(),
    ...tagNodes.values(),
    ...clipNodes,
    ...shotNodes,
  ];
  allEdges = builtEdges;
  applyFilters();
}

async function loadAllClips(videos: Video[]) {
  const out: { id: number; videoId: string; startSec: number; endSec: number }[] = [];
  for (const v of videos) {
    const clips = await listClips(v.videoId);
    for (const c of clips) {
      if (c.id == null) continue;
      out.push({ id: c.id, videoId: c.videoId, startSec: c.startSec, endSec: c.endSec });
    }
  }
  return out;
}

async function loadAllShots(videos: Video[]) {
  const out: { id: number; videoId: string; timeSec: number }[] = [];
  for (const v of videos) {
    const shots = await listScreenshots(v.videoId);
    for (const s of shots) {
      if (s.id == null) continue;
      out.push({ id: s.id, videoId: v.videoId, timeSec: s.timeSec });
    }
  }
  return out;
}

function applyFilters() {
  const showTags = showTagsEl.checked;
  const showClips = showClipsEl.checked;
  const showShots = showShotsEl.checked;
  const visible = new Set<string>();
  for (const n of allNodes) {
    if (n.kind === 'tag' && !showTags) continue;
    if (n.kind === 'clip' && !showClips) continue;
    if (n.kind === 'screenshot' && !showShots) continue;
    visible.add(n.id);
  }
  nodes = allNodes.filter((n) => visible.has(n.id));
  edges = allEdges.filter((e) => visible.has(e.a.id) && visible.has(e.b.id));
}

// Force simulation. Verlet-ish: repulsion (Coulomb) + spring on edges + center.
const REPULSE_STRENGTH = 1400;
const CENTER_STRENGTH = 0.008;
const DAMPING = 0.82;
const MIN_DIST = 1;

function stepSimulation() {
  // Reset accel: just decay velocities first
  for (const n of nodes) {
    n.vx *= DAMPING;
    n.vy *= DAMPING;
  }

  // Pairwise repulsion (O(n²)). Fine for ≤ ~400 nodes.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < MIN_DIST) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = dx * dx + dy * dy + 0.01;
      }
      const f = REPULSE_STRENGTH / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Spring along edges (toward ideal length).
  for (const e of edges) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const delta = (d - e.length) * 0.05;
    const fx = (dx / d) * delta;
    const fy = (dy / d) * delta;
    e.a.vx += fx;
    e.a.vy += fy;
    e.b.vx -= fx;
    e.b.vy -= fy;
  }

  // Center pull.
  for (const n of nodes) {
    n.vx += -n.x * CENTER_STRENGTH;
    n.vy += -n.y * CENTER_STRENGTH;
  }

  // Integrate.
  for (const n of nodes) {
    if (n === dragNode) continue;
    n.x += n.vx;
    n.y += n.vy;
  }
}

function render() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  // Edges.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const e of edges) {
    const [ax, ay] = worldToScreen(e.a.x, e.a.y);
    const [bx, by] = worldToScreen(e.b.x, e.b.y);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  // Nodes.
  for (const n of nodes) {
    const [x, y] = worldToScreen(n.x, n.y);
    const r = n.r * Math.min(1.4, Math.max(0.6, view.scale));
    ctx.fillStyle = COLORS[n.kind];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n === hoverNode) {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Labels for tags + hovered video.
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const n of nodes) {
    let show = false;
    if (n.kind === 'tag' && view.scale > 0.45) show = true;
    if (n === hoverNode) show = true;
    if (n.kind === 'video' && view.scale > 0.85) show = true;
    if (!show) continue;
    const [x, y] = worldToScreen(n.x, n.y);
    const label = n.kind === 'video' ? truncate(n.label, 28) : n.label;
    ctx.fillText(label, x + n.r * view.scale + 4, y);
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function tick() {
  stepSimulation();
  render();
  requestAnimationFrame(tick);
}

function hitTest(sx: number, sy: number): GraphNode | null {
  // Reverse iteration so the top-rendered node wins.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const [x, y] = worldToScreen(n.x, n.y);
    const dx = sx - x;
    const dy = sy - y;
    const r = n.r * Math.min(1.4, Math.max(0.6, view.scale)) + 2;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

function updateTooltip(sx: number, sy: number, node: GraphNode | null) {
  if (!node) {
    tooltipEl.classList.remove('visible');
    return;
  }
  tooltipEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'tooltip-title';
  const sub = document.createElement('div');
  sub.className = 'tooltip-sub';
  if (node.kind === 'video') {
    title.textContent = node.label;
    sub.textContent = `${node.channel ?? ''}${node.rating != null ? ` · ★ ${node.rating}/10` : ''}`;
  } else if (node.kind === 'tag') {
    title.textContent = node.label;
    sub.textContent = 'tag';
  } else if (node.kind === 'clip') {
    title.textContent = `Clip ${node.label}`;
    sub.textContent = `${((node.endSec ?? 0) - (node.startSec ?? 0)).toFixed(1)} c`;
  } else {
    title.textContent = `Screenshot @ ${node.label}`;
    sub.textContent = '';
  }
  tooltipEl.appendChild(title);
  if (sub.textContent) tooltipEl.appendChild(sub);
  const rect = canvas.getBoundingClientRect();
  tooltipEl.style.left = `${Math.min(sx + 12, rect.width - 290)}px`;
  tooltipEl.style.top = `${Math.min(sy + 12, rect.height - 60)}px`;
  tooltipEl.classList.add('visible');
}

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (panning) {
    pressMovedDist += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (dragNode) {
      const [wx, wy] = screenToWorld(sx, sy);
      dragNode.x = wx;
      dragNode.y = wy;
      dragNode.vx = 0;
      dragNode.vy = 0;
    } else {
      view.tx = panStartTx + (e.clientX - panFromX);
      view.ty = panStartTy + (e.clientY - panFromY);
    }
    return;
  }

  const node = hitTest(sx, sy);
  hoverNode = node;
  canvas.style.cursor = node ? 'pointer' : 'grab';
  updateTooltip(sx, sy, node);
});

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  panFromX = e.clientX;
  panFromY = e.clientY;
  panStartTx = view.tx;
  panStartTy = view.ty;
  panning = true;
  pressMovedDist = 0;
  dragNode = hitTest(sx, sy);
  canvas.classList.add('dragging');
});

window.addEventListener('mouseup', (e) => {
  if (!panning) return;
  panning = false;
  canvas.classList.remove('dragging');
  if (dragNode && pressMovedDist < 4) {
    // Treat as click.
    handleNodeClick(dragNode);
  }
  dragNode = null;
  void e;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = Math.exp(-e.deltaY * 0.001);
  const newScale = Math.min(4, Math.max(0.15, view.scale * factor));
  // Keep point under cursor stable.
  const [wx, wy] = screenToWorld(sx, sy);
  view.scale = newScale;
  const [nx, ny] = worldToScreen(wx, wy);
  view.tx += sx - nx;
  view.ty += sy - ny;
}, { passive: false });

function handleNodeClick(node: GraphNode) {
  if (node.kind === 'video' && node.videoId) {
    const url = browser.runtime.getURL(`library/index.html#video=${encodeURIComponent(node.videoId)}`);
    window.location.href = url;
  } else if (node.kind === 'tag' && node.tagName) {
    const url = browser.runtime.getURL(
      `library/index.html#tag=${encodeURIComponent(node.tagName)}`,
    );
    window.location.href = url;
  } else if ((node.kind === 'clip' || node.kind === 'screenshot') && node.videoId) {
    const url = browser.runtime.getURL(`library/index.html#video=${encodeURIComponent(node.videoId)}`);
    window.location.href = url;
  }
}

function resetView() {
  view.scale = 1;
  const rect = canvas.getBoundingClientRect();
  view.tx = rect.width / 2;
  view.ty = rect.height / 2;
}

resetBtn.addEventListener('click', resetView);
showTagsEl.addEventListener('change', applyFilters);
showClipsEl.addEventListener('change', applyFilters);
showShotsEl.addEventListener('change', applyFilters);
window.addEventListener('resize', () => {
  resizeCanvas();
  resetView();
});

async function init() {
  resizeCanvas();
  resetView();
  await buildGraph();
  requestAnimationFrame(tick);
}

void init();
