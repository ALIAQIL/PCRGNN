const canvas = document.querySelector('#pointCanvas');
const ctx = canvas.getContext('2d');

const palette = {
  canvas: '#f3f5f5',
  grid: '#dbe7e9',
  orange: '#f28e2b',
  cyan: '#4cb6c7',
  navy: '#102a43',
  blue: '#1d6fa5',
  muted: '#8fa9b5',
};

const scenes = {
  sedan: { label: '07 · Sedan crop', scale: 1, confidence: 92.4 },
  van: { label: '12 · Van crop', scale: 1.17, confidence: 89.9 },
  cyclist: { label: '19 · Cyclist crop', scale: .64, confidence: 86.8 },
};

const state = { stage: 0, density: 62, k: 8, attention: true, scene: 'sedan', runTimer: null };

const benchmark = [
  ['MV3D', '71.29', '62.68', '56.56'],
  ['F-PointNet', '83.76', '70.92', '63.65'],
  ['PointPillars', '89.70', '79.80', '79.30'],
  ['3DSSD', '89.47', '79.47', '78.54'],
  ['PointRCNN', '88.88', '78.63', '77.38'],
  ['PC-RGNN', '90.94', '81.43', '80.45'],
];

const stageData = [
  { kicker: 'STAGE A · RAW OBSERVATION', title: 'Sparse input cloud', view: 'Sparse input', next: 'Completion', hint: 'Density controls visibility gaps' },
  { kicker: 'STAGE B · POINT COMPLETION', title: 'Completed object crop', view: 'Completion', next: 'Attention', hint: 'Cyan points are generated geometry' },
  { kicker: 'STAGE C · AMS-GNN', title: 'Attention over neighbors', view: 'Attention', next: 'Regression', hint: 'Blue edges show the local graph' },
  { kicker: 'STAGE D · BOX REGRESSION', title: 'Predicted 3D box', view: 'Regression', next: 'Done', hint: 'The final box aggregates all scales' },
];

function seeded(index, salt = 0) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function project(point, width, height, sceneScale) {
  const perspective = 1 + (point.y + 2.6) * 0.045;
  return {
    x: width * .51 + point.x * 82 * sceneScale * perspective,
    y: height * .58 - point.z * 64 * sceneScale + point.y * 20 * sceneScale,
  };
}

function createPoints() {
  const points = [];
  const scale = scenes[state.scene].scale;
  let index = 0;
  const keepRatio = state.density / 100;

  const add = (x, y, z, kind = 'observed') => {
    const visible = kind === 'added' || seeded(index++, state.scene.length) < keepRatio;
    if (visible) points.push({ x, y, z, kind, id: points.length });
  };

  // Roof, hood, cabin, wheels, and side surfaces form a compact car-like crop.
  for (let i = 0; i < 145; i += 1) {
    const u = seeded(i, 1), v = seeded(i, 2), w = seeded(i, 3);
    const x = (u * 3.5 - 1.75) * scale;
    const y = (v * 1.5 - .75) * scale;
    const z = i % 4 === 0 ? 1.16 + w * .25 : .22 + w * .77;
    add(x, y, z, 'observed');
  }
  for (let i = 0; i < 44; i += 1) {
    const u = seeded(i, 10), v = seeded(i, 11), w = seeded(i, 12);
    const x = (u * 3.35 - 1.68) * scale;
    const y = (v * 1.36 - .68) * scale;
    const z = .25 + w * 1.1;
    add(x, y, z, 'added');
  }
  // A few road returns create scene context without stealing attention.
  for (let i = 0; i < 40; i += 1) {
    const u = seeded(i, 20), v = seeded(i, 21);
    points.push({ x: (u * 8 - 4) * scale, y: (v * 4 - 2) * scale, z: 0, kind: 'ground', id: points.length });
  }
  return points;
}

function drawGrid(width, height) {
  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i += 1) {
    const x = width * .5 + i * 58;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 100, height); ctx.stroke();
  }
  for (let i = 0; i < 8; i += 1) {
    const y = height * .25 + i * 42;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawBox(width, height, sceneScale) {
  const corners = [
    [-1.92, -.82, .1], [1.92, -.82, .1], [1.92, .82, .1], [-1.92, .82, .1],
    [-1.92, -.82, 1.28], [1.92, -.82, 1.28], [1.92, .82, 1.28], [-1.92, .82, 1.28],
  ].map((p) => project({ x: p[0] * scenes[state.scene].scale, y: p[1] * scenes[state.scene].scale, z: p[2] }, width, height, sceneScale));
  const pairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  ctx.save();
  ctx.strokeStyle = state.stage === 3 ? palette.orange : palette.navy;
  ctx.globalAlpha = state.stage === 3 ? .9 : .24;
  ctx.lineWidth = state.stage === 3 ? 2.2 : 1.1;
  pairs.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(corners[a].x,corners[a].y); ctx.lineTo(corners[b].x,corners[b].y); ctx.stroke(); });
  ctx.restore();
}

function drawEdges(points, width, height, sceneScale) {
  if (state.stage < 2) return;
  const observed = points.filter((p) => p.kind !== 'ground');
  const anchor = observed[Math.floor(observed.length * .52)];
  if (!anchor) return;
  const neighbours = observed.filter((p) => p !== anchor).sort((a,b) => {
    const da = (a.x-anchor.x)**2 + (a.y-anchor.y)**2 + (a.z-anchor.z)**2;
    const db = (b.x-anchor.x)**2 + (b.y-anchor.y)**2 + (b.z-anchor.z)**2;
    return da - db;
  }).slice(0, state.k);
  const ap = project(anchor, width, height, sceneScale);
  ctx.save();
  ctx.lineWidth = 1.2;
  neighbours.forEach((p, i) => {
    const pp = project(p, width, height, sceneScale);
    const strength = state.attention ? 1 - i / neighbours.length : .23;
    ctx.globalAlpha = state.attention ? .16 + strength * .5 : .25;
    ctx.strokeStyle = state.attention ? palette.blue : palette.muted;
    ctx.beginPath(); ctx.moveTo(ap.x,ap.y); ctx.lineTo(pp.x,pp.y); ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.blue; ctx.beginPath(); ctx.arc(ap.x, ap.y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function drawCanvas() {
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.canvas; ctx.fillRect(0, 0, width, height);
  drawGrid(width, height);
  const points = createPoints();
  const sceneScale = state.stage === 0 ? .96 : 1;

  points.filter((p) => p.kind === 'ground').forEach((p) => {
    const pp = project(p, width, height, sceneScale);
    ctx.fillStyle = '#c8d8dc'; ctx.globalAlpha = .55; ctx.fillRect(pp.x, pp.y, 2, 2);
  });
  ctx.globalAlpha = 1;
  drawEdges(points, width, height, sceneScale);
  points.filter((p) => p.kind !== 'ground').sort((a,b) => a.z - b.z).forEach((p) => {
    const pp = project(p, width, height, sceneScale);
    const isAdded = p.kind === 'added';
    if (isAdded && state.stage === 0) return;
    ctx.fillStyle = isAdded ? palette.cyan : palette.orange;
    ctx.globalAlpha = isAdded ? .78 : .88;
    const radius = isAdded ? 3.2 : 3.5;
    ctx.beginPath(); ctx.arc(pp.x, pp.y, radius, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  drawBox(width, height, sceneScale);
}

function updateMetrics() {
  const observed = Math.round(148 * (state.density / 62));
  const added = state.stage === 0 ? 0 : 42;
  const visible = observed + added;
  document.querySelector('#metricPoints').textContent = visible;
  document.querySelector('#metricEdges').textContent = (visible * state.k).toLocaleString();
  document.querySelector('#metricK').textContent = state.k;
  document.querySelector('#scaleValue').textContent = state.k;
  const confidenceBase = scenes[state.scene].confidence;
  const confidence = state.stage === 0 ? confidenceBase - 7.2 : state.stage === 1 ? confidenceBase - 3.7 : state.stage === 2 ? confidenceBase - 1.8 : confidenceBase;
  document.querySelector('#metricConfidence').innerHTML = `${confidence.toFixed(1)}<span>%</span>`;
  document.querySelector('#densityValue').textContent = `${state.density}%`;
  const data = stageData[state.stage];
  document.querySelector('#visualKicker').textContent = data.kicker;
  document.querySelector('#visualTitle').textContent = data.title;
  document.querySelector('#currentViewLabel').textContent = data.view;
  document.querySelector('#currentViewNext').textContent = data.next;
  document.querySelector('#canvasHint').textContent = data.hint;
}

function render() { updateMetrics(); drawCanvas(); }

function setStage(stage) {
  state.stage = stage;
  document.querySelectorAll('.stage-item').forEach((item) => item.classList.toggle('active', Number(item.dataset.stage) === stage));
  render();
}

function runPipeline() {
  clearInterval(state.runTimer);
  state.stage = 0; render();
  let stage = 0;
  state.runTimer = setInterval(() => {
    stage += 1;
    setStage(stage);
    if (stage === 3) clearInterval(state.runTimer);
  }, 900);
}

function buildBenchmark() {
  const body = document.querySelector('#benchmarkBody');
  body.innerHTML = benchmark.map((row) => `<tr>${row.map((cell, index) => `<td>${cell}</td>`).join('')}</tr>`).join('');
}

function buildAblation() {
  const rows = [
    ['Base', 81.63, ''],
    ['+ completion', 82.54, 'blue'],
    ['+ AMS-GNN', 83.18, 'blue'],
    ['Full model', 84.27, 'orange'],
  ];
  document.querySelector('#ablationBars').innerHTML = rows.map(([label, value, color]) => `<div class="ablation-row"><span class="ablation-label">${label}</span><div class="bar-track"><div class="bar-fill ${color}" style="width:${((value - 80) / 5) * 100}%"></div></div><span class="ablation-value">${value.toFixed(2)}</span></div>`).join('');
}

document.querySelectorAll('.stage-item').forEach((item) => item.addEventListener('click', () => setStage(Number(item.dataset.stage))));
document.querySelector('#runButton').addEventListener('click', runPipeline);
document.querySelector('#resetButton').addEventListener('click', () => { state.stage = 0; state.density = 62; state.k = 8; state.attention = true; state.scene = 'sedan'; document.querySelector('#densityRange').value = 62; document.querySelector('#scaleSelect').value = 8; document.querySelector('#attentionToggle').checked = true; document.querySelector('#sceneSelect').value = 'sedan'; setStage(0); });
document.querySelector('#densityRange').addEventListener('input', (event) => { state.density = Number(event.target.value); render(); });
document.querySelector('#scaleSelect').addEventListener('change', (event) => { state.k = Number(event.target.value); render(); });
document.querySelector('#attentionToggle').addEventListener('change', (event) => { state.attention = event.target.checked; render(); });
document.querySelector('#sceneSelect').addEventListener('change', (event) => { state.scene = event.target.value; render(); });

buildBenchmark();
buildAblation();
render();
