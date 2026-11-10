const canvas = document.getElementById('worldCanvas');
const ctx = canvas.getContext('2d');

const toolButtons = [...document.querySelectorAll('.tool')];
const brushInput = document.getElementById('brushSize');
const brushLabel = document.getElementById('brushLabel');
const worldStat = document.getElementById('worldStat');
const villageStat = document.getElementById('villageStat');
const animalStat = document.getElementById('animalStat');
const peopleStat = document.getElementById('peopleStat');
const statusText = document.getElementById('statusText');
const randomizeBtn = document.getElementById('randomizeBtn');
const pauseBtn = document.getElementById('pauseBtn');

const WORLD_COLS = 40;
const WORLD_ROWS = 28;
const TILE_SIZE = 20;
const SIMULATION_MS = 200;

let activeTool = 'raise';
let brushSize = Number(brushInput.value);
let world = [];
let animals = [];
let settlers = [];
let villages = [];
let paused = false;
let pointerDown = false;
let lastPaint = 0;
let simulationTimer = 0;

const terrainNameMap = {
  deepWater: 'Deep water',
  water: 'Water',
  sand: 'Sand',
  grass: 'Grass',
  forest: 'Forest',
  mountain: 'Mountain',
  snow: 'Snow'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function tileColor(tile) {
  const h = tile.height;
  if (h < 0.18) return '#0a3d64';
  if (h < 0.26) return '#2d7ab0';
  if (h < 0.38) return '#d7c98b';
  if (h < 0.58) return '#5bbf77';
  if (h < 0.68) return '#3a9d62';
  if (h < 0.8) return '#3a6d3b';
  if (h < 0.9) return '#6a756d';
  if (h >= 0.9) return '#eef5fa';
  return '#4ccf6b';
}

function generateNoise(x, y, frequency) {
  return Math.sin(x * frequency + 12.7) * Math.cos(y * (frequency * 1.3) + 4.6) +
    Math.sin((x + y) * (frequency * 0.75)) * 0.7 +
    Math.cos((x * 0.8 - y * 0.65) * (frequency * 1.5)) * 0.6;
}

function createWorld() {
  const nextWorld = [];
  const cellCount = WORLD_COLS * WORLD_ROWS;

  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const nx = x / WORLD_COLS;
      const ny = y / WORLD_ROWS;
      const terrainNoise = generateNoise(x * 0.9, y * 0.9, 0.9);
      const ridgeNoise = generateNoise(x * 1.4, y * 1.5, 1.7);
      const rolling = 0.5 + terrainNoise * 0.28 + ridgeNoise * 0.22;
      const oceanMask = Math.max(0, 0.7 - Math.hypot(nx - 0.5, ny - 0.5) * 1.1);
      const height = clamp(rolling + oceanMask * 0.25, 0, 1);
      nextWorld.push({
        x,
        y,
        height,
        moisture: (Math.sin((x + 7) * 0.7) + Math.cos((y + 3) * 0.8) + 2) / 4,
        fertility: 0.35 + Math.random() * 0.45,
        forest: 0,
        water: false,
        river: false,
        villageId: null,
        creature: null
      });
    }
  }

  for (let i = 0; i < cellCount; i++) {
    const tile = nextWorld[i];
    if (tile.height < 0.24) {
      tile.water = true;
      tile.fertility = 0.15;
    } else if (tile.height < 0.38) {
      tile.fertility = 0.4 + tile.moisture * 0.2;
    } else {
      tile.fertility = 0.55 + tile.moisture * 0.35;
    }
  }

  return nextWorld;
}

function indexFor(x, y) {
  return y * WORLD_COLS + x;
}

function getTile(x, y) {
  if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) return null;
  return world[indexFor(x, y)];
}

function updateTileAppearance(tile) {
  if (tile.height < 0.18) {
    tile.water = true;
    tile.river = false;
    tile.forest = 0;
    return 'deepWater';
  }
  if (tile.height < 0.26) {
    tile.water = true;
    return 'water';
  }
  if (tile.height < 0.38) {
    tile.water = false;
    return 'sand';
  }
  if (tile.height < 0.58) {
    tile.water = false;
    return tile.forest > 0.2 ? 'forest' : 'grass';
  }
  if (tile.height < 0.8) {
    tile.water = false;
    return tile.forest > 0.15 ? 'forest' : 'grass';
  }
  if (tile.height < 0.92) {
    tile.water = false;
    return 'mountain';
  }
  return 'snow';
}

function worldSummary() {
  let water = 0;
  let forest = 0;
  let mountain = 0;
  for (const tile of world) {
    const type = updateTileAppearance(tile);
    if (type === 'water' || type === 'deepWater') water++;
    if (type === 'forest') forest++;
    if (type === 'mountain' || type === 'snow') mountain++;
  }
  return { water, forest, mountain };
}

function spawnAnimalAt(x, y, color = '#f4d35e') {
  const tile = getTile(x, y);
  if (!tile || tile.height > 0.78 || tile.water) return;
  animals.push({
    x,
    y,
    size: randRange(0.9, 1.5),
    color,
    targetX: x,
    targetY: y,
    hunger: Math.random(),
    mood: randRange(0.2, 1)
  });
}

function spawnSettlerAt(x, y, mood = 'wanderer') {
  const tile = getTile(x, y);
  if (!tile || tile.height > 0.75 || tile.water) return;
  settlers.push({
    x,
    y,
    targetX: x,
    targetY: y,
    mood,
    age: 0,
    homeVillage: null
  });
}

function createVillageAt(x, y, population = 4) {
  const tile = getTile(x, y);
  if (!tile || tile.height > 0.7 || tile.water) return null;
  const existing = villages.find((v) => Math.hypot(v.x - x, v.y - y) < 2.7);
  if (existing) return null;

  const village = {
    x,
    y,
    population,
    name: `Civ ${villages.length + 1}`,
    growth: 0.45,
    color: `hsl(${Math.random() * 70 + 180}, 65%, 62%)`
  };
  villages.push(village);
  tile.villageId = village.name;
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const near = getTile(x + ox, y + oy);
      if (near) near.fertility = Math.min(1, near.fertility + 0.15);
    }
  }
  return village;
}

function resetWorld() {
  world = createWorld();
  animals = [];
  settlers = [];
  villages = [];

  for (let i = 0; i < 24; i++) {
    const x = Math.floor(randRange(4, WORLD_COLS - 4));
    const y = Math.floor(randRange(4, WORLD_ROWS - 4));
    spawnAnimalAt(x, y, i % 2 === 0 ? '#f6d365' : '#c4e86f');
  }

  for (let i = 0; i < 16; i++) {
    const x = Math.floor(randRange(3, WORLD_COLS - 3));
    const y = Math.floor(randRange(3, WORLD_ROWS - 3));
    spawnSettlerAt(x, y, i % 2 === 0 ? 'explorer' : 'wanderer');
  }

  for (let i = 0; i < 4; i++) {
    const x = Math.floor(randRange(6, WORLD_COLS - 6));
    const y = Math.floor(randRange(6, WORLD_ROWS - 6));
    createVillageAt(x, y, 5 + Math.floor(Math.random() * 4));
  }

  statusText.textContent = 'A new world is ready.';
  updateStats();
}

function updateStats() {
  const summary = worldSummary();
  worldStat.textContent = `${WORLD_COLS}×${WORLD_ROWS}`;
  villageStat.textContent = String(villages.length);
  animalStat.textContent = String(animals.length);
  peopleStat.textContent = String(settlers.length + villages.reduce((sum, v) => sum + v.population, 0));
  statusText.textContent = summary.forest > 0 ? `Forest tiles: ${summary.forest} • Water: ${summary.water}` : 'Your world is alive.';
}

function tileToCanvas(x, y) {
  return {
    px: x * TILE_SIZE,
    py: y * TILE_SIZE,
    sx: TILE_SIZE,
    sy: TILE_SIZE
  };
}

function renderTile(tile) {
  const { px, py, sx, sy } = tileToCanvas(tile.x, tile.y);
  let fill = tileColor(tile);

  if (tile.river) fill = '#64cfea';
  if (tile.height > 0.73 && tile.height <= 0.9) fill = '#7f8c8d';
  if (tile.forest > 0.25) fill = '#2b8d4b';

  ctx.fillStyle = fill;
  ctx.fillRect(px, py, sx, sy);

  if (tile.forest > 0.3) {
    ctx.fillStyle = 'rgba(8, 57, 25, 0.58)';
    ctx.fillRect(px + 4, py + 5, 6, 6);
    ctx.fillRect(px + 11, py + 8, 5, 5);
  }

  if (tile.river) {
    ctx.fillStyle = 'rgba(11, 93, 126, 0.8)';
    ctx.fillRect(px + 6, py + 4, sx - 12, sy - 8);
  }
}

function renderVillage(village) {
  const { px, py } = tileToCanvas(village.x, village.y);
  ctx.fillStyle = village.color;
  ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
  ctx.fillStyle = '#f7fbff';
  ctx.fillText(String(village.population), px + 7, py + 13);
}

function renderAnimal(animal) {
  const { px, py } = tileToCanvas(Math.round(animal.x), Math.round(animal.y));
  ctx.fillStyle = animal.color;
  ctx.beginPath();
  ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderSettler(settler) {
  const { px, py } = tileToCanvas(Math.round(settler.x), Math.round(settler.y));
  ctx.fillStyle = '#dff3ff';
  ctx.beginPath();
  ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const tile of world) {
    renderTile(tile);
  }

  for (const village of villages) renderVillage(village);
  for (const animal of animals) renderAnimal(animal);
  for (const settler of settlers) renderSettler(settler);
}

function getCellFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  const cellX = Math.floor(x / TILE_SIZE);
  const cellY = Math.floor(y / TILE_SIZE);
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return null;
  return { x: cellX, y: cellY };
}

function applyBrush(cell, tool) {
  const radius = brushSize - 1;
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const tx = cell.x + ox;
      const ty = cell.y + oy;
      if (Math.hypot(ox, oy) > radius + 0.5) continue;
      const tile = getTile(tx, ty);
      if (!tile) continue;

      if (tool === 'raise') {
        tile.height = clamp(tile.height + 0.09, 0, 1.15);
        tile.river = false;
      } else if (tool === 'lower') {
        tile.height = clamp(tile.height - 0.09, 0, 1.15);
        tile.river = false;
      } else if (tool === 'river') {
        tile.height = clamp(tile.height * 0.78, 0.08, 0.48);
        tile.river = true;
        tile.water = true;
      } else if (tool === 'mountain') {
        tile.height = clamp(tile.height + 0.18, 0, 1.15);
        tile.river = false;
        tile.forest = 0;
      } else if (tool === 'forest') {
        tile.height = clamp(tile.height + 0.03, 0.2, 0.96);
        tile.forest = clamp(tile.forest + 0.6, 0, 1);
        tile.river = false;
      } else if (tool === 'animal') {
        if (Math.random() < 0.9) spawnAnimalAt(tx, ty, '#f4d35e');
      } else if (tool === 'person') {
        if (Math.random() < 0.8) spawnSettlerAt(tx, ty, 'builder');
      } else if (tool === 'village') {
        createVillageAt(tx, ty, 4 + Math.floor(Math.random() * 3));
      } else if (tool === 'erase') {
        tile.height = 0.36;
        tile.river = false;
        tile.forest = 0;
        tile.water = false;
      }

      const resolvedType = updateTileAppearance(tile);
      if (resolvedType === 'deepWater' || resolvedType === 'water') {
        tile.fertility = 0.12;
      } else if (resolvedType === 'forest') {
        tile.fertility = clamp(tile.fertility + 0.2, 0.2, 1);
      } else if (resolvedType === 'mountain' || resolvedType === 'snow') {
        tile.fertility = 0.08;
      }
    }
  }
}

function handlePointer(event) {
  const cell = getCellFromPointer(event);
  if (!cell) return;
  applyBrush(cell, activeTool);
  drawGrid();
  updateStats();
}

canvas.addEventListener('pointerdown', (event) => {
  pointerDown = true;
  handlePointer(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointerDown) return;
  handlePointer(event);
});

canvas.addEventListener('pointerup', () => {
  pointerDown = false;
});

canvas.addEventListener('pointerleave', () => {
  pointerDown = false;
});

function seedSimulation() {
  for (const tile of world) {
    if (tile.height < 0.38 && Math.random() < 0.08) tile.river = true;
  }
}

function advanceSimulation() {
  if (paused) return;

  for (const animal of animals) {
    const nx = Math.round(animal.x + randRange(-1, 1));
    const ny = Math.round(animal.y + randRange(-1, 1));
    const tile = getTile(nx, ny);
    if (tile && !tile.water && tile.height < 0.8) {
      animal.x = clamp(nx, 0, WORLD_COLS - 1);
      animal.y = clamp(ny, 0, WORLD_ROWS - 1);
    }
    animal.hunger += 0.03;
    if (animal.hunger > 1.2 && Math.random() < 0.2) {
      animal.color = '#f4d35e';
    }
  }

  for (const settler of settlers) {
    const dx = randRange(-1, 1);
    const dy = randRange(-1, 1);
    const nx = clamp(Math.round(settler.x + dx), 0, WORLD_COLS - 1);
    const ny = clamp(Math.round(settler.y + dy), 0, WORLD_ROWS - 1);
    const tile = getTile(nx, ny);
    if (tile && !tile.water && tile.height < 0.75) {
      settler.x = nx;
      settler.y = ny;
    }

    if (tile && tile.fertility > 0.52 && Math.random() < 0.1) {
      createVillageAt(nx, ny, 3);
    }
  }

  villages.forEach((village) => {
    village.population += Math.random() < 0.05 ? 1 : 0;
    for (let i = 0; i < 3; i++) {
      const nx = clamp(village.x + Math.floor(randRange(-2, 3)), 0, WORLD_COLS - 1);
      const ny = clamp(village.y + Math.floor(randRange(-2, 3)), 0, WORLD_ROWS - 1);
      const tile = getTile(nx, ny);
      if (tile && !tile.water && tile.height < 0.7) {
        tile.fertility = Math.min(1, tile.fertility + 0.04);
      }
    }
  });

  if (animals.length < 50 && Math.random() < 0.18) {
    const x = Math.floor(randRange(3, WORLD_COLS - 3));
    const y = Math.floor(randRange(3, WORLD_ROWS - 3));
    spawnAnimalAt(x, y, '#9bdc7e');
  }

  if (settlers.length < 28 && Math.random() < 0.12) {
    const x = Math.floor(randRange(2, WORLD_COLS - 2));
    const y = Math.floor(randRange(2, WORLD_ROWS - 2));
    spawnSettlerAt(x, y, 'wanderer');
  }

  if (villages.length < 8 && Math.random() < 0.08 && settlers.length > 3) {
    const chosen = settlers[Math.floor(Math.random() * settlers.length)];
    if (chosen) createVillageAt(Math.round(chosen.x), Math.round(chosen.y), 5);
  }

  updateStats();
  drawGrid();
}

function tick() {
  simulationTimer += 16;
  if (simulationTimer >= SIMULATION_MS) {
    simulationTimer = 0;
    advanceSimulation();
  }
  requestAnimationFrame(tick);
}

function setTool(tool) {
  activeTool = tool;
  toolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  statusText.textContent = `${terrainNameMap[tool] || 'Tool'} selected.`;
}

toolButtons.forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

brushInput.addEventListener('input', () => {
  brushSize = Number(brushInput.value);
  brushLabel.textContent = String(brushSize);
});

randomizeBtn.addEventListener('click', () => {
  resetWorld();
  drawGrid();
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume sim' : 'Pause sim';
  statusText.textContent = paused ? 'Simulation paused.' : 'Your world is alive.';
});

resetWorld();
seedSimulation();
drawGrid();
setTool(activeTool);
requestAnimationFrame(tick);
