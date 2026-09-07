/* Геометрия игрового поля: шестиугольник с треугольной сеткой (4 треугольника на сторону, 96 ячеек).
   Координаты — в пикселях картинки assets/board.webp (2000 x 1736). */
window.GEO = (function () {
  const IMG_W = 2000, IMG_H = 1736;
  const CX = 1000.34, CY = 867.26;      // центр сетки
  const A = 224.55;                     // сторона треугольника
  const H = A * Math.sqrt(3) / 2;       // высота ряда
  const N = 4;                          // треугольников на сторону шестиугольника

  const vx = (i, j) => CX + (i + j / 2) * A;
  const vy = (j) => CY + j * H;
  const vkey = (i, j) => i + ',' + j;

  function inside(x, y) {
    const dy = Math.abs(y - CY);
    if (dy > N * H + 1) return false;
    const w = N * A - (dy / H) * (A / 2);
    return Math.abs(x - CX) <= w + 1;
  }

  const cells = [];
  for (let j = -N; j < N; j++) {
    for (let i = -8; i <= 8; i++) {
      const variants = [
        { up: false, verts: [[i, j], [i + 1, j], [i, j + 1]] },        // вершиной вниз
        { up: true,  verts: [[i, j + 1], [i + 1, j + 1], [i + 1, j]] } // вершиной вверх
      ];
      for (const v of variants) {
        const pts = v.verts.map(([a, b]) => [vx(a, b), vy(b)]);
        const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
        const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
        if (inside(cx, cy)) cells.push({ id: cells.length, verts: v.verts, pts, cx, cy, up: v.up, edges: [] });
      }
    }
  }

  // Рёбра: для каждой ячейки 3 ребра; общее ребро => соседи
  const edgeMap = new Map();
  for (const c of cells) {
    for (let e = 0; e < 3; e++) {
      const a = c.verts[e], b = c.verts[(e + 1) % 3];
      const key = [vkey(a[0], a[1]), vkey(b[0], b[1])].sort().join('|');
      const p = c.pts[e], q = c.pts[(e + 1) % 3];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const normal = Math.atan2(mid[1] - c.cy, mid[0] - c.cx) * 180 / Math.PI; // наружу от центра ячейки (градусы, экранные координаты)
      c.edges.push({ key, mid, normal, neighbor: null });
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ cell: c.id, edge: e });
    }
  }
  for (const c of cells) {
    for (const ed of c.edges) {
      const list = edgeMap.get(ed.key);
      const other = list.find(x => x.cell !== c.id);
      ed.neighbor = other ? other.cell : null; // null = граница поля
    }
  }

  function cellsWithVertex(i, j) {
    return cells.filter(c => c.verts.some(v => v[0] === i && v[1] === j)).map(c => c.id);
  }

  // Углы поля (по картинке): верх-лево — Воздух, верх-право — Вода, право — Выход, низ-право — Огонь, низ-лево — Земля, лево — Выход
  const CORNERS = {
    air:   { v: [0, -4] },
    water: { v: [4, -4] },
    exitR: { v: [4, 0] },
    fire:  { v: [0, 4] },
    earth: { v: [-4, 4] },
    exitL: { v: [-4, 0] }
  };
  for (const k in CORNERS) CORNERS[k].cells = cellsWithVertex(CORNERS[k].v[0], CORNERS[k].v[1]);
  const EYE_CELLS = cellsWithVertex(0, 0);
  const EXIT_CELLS = [...CORNERS.exitL.cells, ...CORNERS.exitR.cells];

  // Стартовая ячейка стихии: угловая ячейка, у которой граничное ребро горизонтальное (лежит на верхней/нижней стороне поля)
  function startCell(element) {
    const ids = CORNERS[element].cells;
    for (const id of ids) {
      const c = cells[id];
      const bEdge = c.edges.findIndex(e => e.neighbor === null);
      const a = c.verts[bEdge], b = c.verts[(bEdge + 1) % 3];
      if (a[1] === b[1]) return { cell: id, entryEdge: bEdge };
    }
    const c = cells[ids[0]];
    return { cell: ids[0], entryEdge: c.edges.findIndex(e => e.neighbor === null) };
  }

  // Правое/левое ребро относительно входа: направление движения d = центр - середина входа
  function sideEdges(cellId, entryEdge) {
    const c = cells[cellId];
    const m = c.edges[entryEdge].mid;
    const d = [c.cx - m[0], c.cy - m[1]];
    let right = null, left = null;
    for (let e = 0; e < 3; e++) {
      if (e === entryEdge) continue;
      const v = [c.edges[e].mid[0] - c.cx, c.edges[e].mid[1] - c.cy];
      const cross = d[0] * v[1] - d[1] * v[0];
      if (cross > 0) right = e; else left = e;
    }
    return { right, left };
  }

  // Ребро ячейки B, общее с ячейкой A
  function sharedEdge(cellB, cellA) {
    const c = cells[cellB];
    return c.edges.findIndex(e => e.neighbor === cellA);
  }

  return { IMG_W, IMG_H, CX, CY, A, H, cells, CORNERS, EYE_CELLS, EXIT_CELLS, startCell, sideEdges, sharedEdge };
})();
