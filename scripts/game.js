/* ============================================================
   DOOM WEB — clon jugable estilo Doom (1993), nivel 1
   Motor de renderizado: raycasting 2.5D sobre <canvas>, con
   paredes, piso y techo texturizados de verdad (no color plano).
   Todo encapsulado en un IIFE para poder incrustarse en otra página
   sin pisar variables globales del sitio host.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- Configuración general ---------------- */
  const W = 640, H = 400;           // resolución interna de render
  const FOV_PLANE = 0.66;           // ~66° de campo de visión
  const MOVE_SPEED = 3.2;           // celdas/seg
  const ROT_SPEED = 2.6;            // rad/seg (teclado)
  const MOUSE_SENS = 0.0022;
  const PLAYER_RADIUS = 0.22;
  const ENEMY_RADIUS = 0.25;
  const PICKUP_RADIUS = 0.55;
  const INTERACT_RADIUS = 1.4;
  const WEAPON_RANGE = 14;
  const DOOR_ANIM_TIME = 0.5;       // segundos que tarda una puerta en deslizarse hacia arriba
  const LB_KEY = "dwLeaderboard_e1m1_v1";

  /* ---------------- Mapa: recorrido casi lineal con giros + cuarto secreto ---------------- */
  const MAP_W = 36, MAP_H = 80;
  let map = [];
  function resetMap() {
    map = [];
    for (let y = 0; y < MAP_H; y++) map.push(new Array(MAP_W).fill(1));
  }
  function carve(x0, y0, x1, y1, tile) {
    tile = tile === undefined ? 0 : tile;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[y][x] = tile;
  }
  const SECRET_DOORS = [
    { x: 18, y: 12 },  // puerta secreta 1: cuarto con el secret_item
    { x: 25, y: 75 },  // puerta secreta 2: pared paralela a la del botón final, cuarto del ítem fabri
  ];
  const DOORS = [
    { x: 31, y: 25 }, // puerta normal: un solo tile en el pasillo a la derecha de la sala de la escopeta (giro hacia el sur)
  ];
    function buildLevel() {
    resetMap();
    carve(3, 3, 9, 9);      // sala inicial
    carve(9, 5, 16, 7);     // corredor 1 (recto, hacia el este)
    carve(16, 2, 24, 9);    // sala B (enemigos + munición)
    carve(19, 9, 21, 17);   // corredor 2 (giro hacia el sur)
    carve(15, 17, 24, 24);  // sala C (enemigo + vida + armadura)
    carve(24, 19, 30, 21);  // corredor 3 (giro hacia el este)
    carve(28, 17, 34, 24);  // sala D (ya no es la final, ahora es una sala intermedia con la escopeta)
    carve(14, 11, 17, 14);  // sala secreta

    // --- Extensión: 3 salas nuevas con enemigos escalantes + salas de paso con ítems ---
    carve(30, 24, 32, 28);  // corredor D -> conector 1
    carve(24, 27, 34, 32);  // conector 1 (sala de paso: ítems + enemigo)
    carve(16, 30, 26, 33);  // corredor conector 1 -> sala E1
    carve(10, 33, 22, 40);  // sala E1 (1 imp + 2 zombis)
    carve(14, 40, 24, 43);  // corredor E1 -> conector 2
    carve(20, 42, 30, 47);  // conector 2 (sala de paso: ítems + enemigos)
    carve(26, 46, 34, 49);  // corredor conector 2 -> sala E2
    carve(28, 49, 34, 56);  // sala E2 (2 imps)
    carve(20, 54, 29, 57);  // corredor E2 -> conector 3
    carve(14, 56, 24, 61);  // conector 3 (sala de paso: ítems + enemigos)
    carve(18, 60, 28, 63);  // corredor conector 3 -> sala E3
    carve(20, 63, 32, 70);  // sala E3 (2 imps + 3 zombis)
    carve(28, 69, 34, 72);  // corredor E3 -> sala final
    carve(26, 72, 34, 78);  // sala final (nueva)
    carve(20, 73, 24, 77);  // sala secreta 2 (ítem fabri), detrás de la pared paralela al botón final
    map[75][35] = 6;        // pared del interruptor de fin de nivel (reubicado acá)

    SECRET_DOORS.forEach((d) => { map[d.y][d.x] = 5; d.opened = false; d.triggered = false; d.animT = 0; }); // puertas secretas, cerradas (tipo 5 = textura secret_wall)
    map[25][30] = 1; map[25][32] = 1; // angostamos el pasillo a un solo tile en la fila de la puerta
    DOORS.forEach((d) => { map[d.y][d.x] = 7; d.opened = false; d.triggered = false; d.animT = 0; });        // puertas normales, cerradas (tipo 7 = textura door)
  }

  // Interruptor de fin de nivel: montado contra la pared este de la sala final
  const FINISH_SWITCH = { x: 34.3, y: 75.5 };
  function nearFinishSwitch(x, y) {
    return Math.hypot(x - FINISH_SWITCH.x, y - FINISH_SWITCH.y) < INTERACT_RADIUS;
  }
  function isFloor(v) { return v === 0 || v === 9; }
  function cellWalkable(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return false;
    return isFloor(map[cy][cx]);
  }
  function walkableWorld(x, y, r) {
    const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
    return pts.every(([px, py]) => cellWalkable(Math.floor(px), Math.floor(py)));
  }

  /* ---------------- Carga de imágenes (assets propios) ---------------- */
  const ASSET_PATHS = {
    pistol: "assets/armas/pistol.png",
    pistol_shot: "assets/armas/pistol_shot.png",
    shotgun: "assets/armas/shotgun.png",
    shotgun_grap: "assets/armas/shotgun_grap.png",
    shotgun_hand: "assets/armas/shotgun_hand.png",
    shotgun_shot: "assets/armas/shotgun_shot.png",
    zombi_walk_stand: "assets/enemigos/zombi_walk_stand.png",
    zombi_walk_izquierda: "assets/enemigos/zombi_walk_izquierda.png",
    zombi_walk_derecha: "assets/enemigos/zombi_walk_derecha.png",
    zombi_attack: "assets/enemigos/zombi_attack.png",
    zombi_hit: "assets/enemigos/zombi_hit.png",
    imp_stand: "assets/enemigos/imp_stand.png",
    imp_walk: "assets/enemigos/imp_walk.png",
    imp_attack: "assets/enemigos/imp_attack.png",
    imp_hit: "assets/enemigos/imp_hit.png",
    peron1: "assets/jugador/peron1.png",
    peron2: "assets/jugador/peron2.png",
    peron3: "assets/jugador/peron3.png",
    peron4: "assets/jugador/peron4.png",
    peron5: "assets/jugador/peron5.png",
    peron6: "assets/jugador/peron6.png",
    peron_death: "assets/jugador/peron_death.png",
    peron_deidad: "assets/jugador/peron_deidad.png",
    ammo: "assets/objetos/ammo.png",
    armor: "assets/objetos/armor.png",
    health: "assets/objetos/health.png",
    secret_item: "assets/objetos/secret_item.png",
    fabri: "assets/objetos/fabri.png",
    // Texturas de paredes/piso/techo (se procesan aparte para sampleo por píxel)
    wall: "assets/escenario/wall.jpeg",
    secret_wall: "assets/escenario/secret_wall.jpeg",
    button_wall: "assets/escenario/button_wall.jpg",
    door: "assets/escenario/door.jpeg",
    floor: "assets/escenario/floor.jpeg",
    techo: "assets/escenario/techo.jpeg",
  };
  const TEXTURE_KEYS = ["wall", "secret_wall", "button_wall", "door", "floor", "techo"];
  const assets = {};
  const textures = {};
  function loadAssets(done) {
    const names = Object.keys(ASSET_PATHS);
    let remaining = names.length;
    function finish() { remaining--; if (remaining <= 0) buildTextures(done); }
    names.forEach((name) => {
      const img = new Image();
      img.ok = false;
      img.onload = () => { img.ok = true; finish(); };
      img.onerror = () => { console.warn("[DOOM WEB] No se pudo cargar el asset:", ASSET_PATHS[name]); img.ok = false; finish(); };
      img.src = ASSET_PATHS[name];
      assets[name] = img;
    });
  }
  function buildTextures(done) {
    const tmp = document.createElement("canvas");
    const tctx = tmp.getContext("2d");
    TEXTURE_KEYS.forEach((key) => {
      const img = assets[key];
      if (!img || !img.ok) { textures[key] = null; return; }
      const w = img.naturalWidth || 64, h = img.naturalHeight || 64;
      tmp.width = w; tmp.height = h;
      tctx.drawImage(img, 0, 0, w, h);
      try {
        const data = tctx.getImageData(0, 0, w, h).data;
        textures[key] = { data, width: w, height: h };
      } catch (e) {
        console.warn("[DOOM WEB] No se pudo leer la textura:", key, e);
        textures[key] = null;
      }
    });
    done();
  }
  function drawImageSafe(img, x, y, w, h, fallbackColor) {
    if (img && img.ok) { ctx.drawImage(img, x, y, w, h); }
    else { ctx.fillStyle = fallbackColor || "#7a2b12"; ctx.fillRect(x, y, w, h); }
  }

  /* ---------------- Estado del jugador ---------------- */
  const player = {
    x: 0, y: 0, angle: 0,
    dirX: 0, dirY: 0, planeX: 0, planeY: 0,
    health: 100, armor: 0, ammo: 40,
    hasShotgun: false, weapon: "pistol",
  };
  function updateDirVectors() {
    player.dirX = Math.cos(player.angle);
    player.dirY = Math.sin(player.angle);
    player.planeX = -player.dirY * FOV_PLANE;
    player.planeY = player.dirX * FOV_PLANE;
  }

  /* ---------------- Cara del jugador (HUD) ---------------- */
  let faceOverrideImgKey = null;
  let faceOverrideTimer = 0;
  let painAlternateToggle = false;
  function currentFaceKey() {
    if (faceOverrideTimer > 0) return faceOverrideImgKey;
    if (player.health > 75) return "peron1";
    if (player.health > 50) return "peron2";
    if (player.health > 25) return "peron3";
    return "peron4";
  }

  /* ---------------- Entidades ---------------- */
  let enemies = [];
  let items = [];
    function buildEntities() {
    enemies = [
      mkEnemy(18.5, 4.5, "zombie"),  // sala B
      mkEnemy(22.5, 6.5, "zombie"),  // sala B
      mkEnemy(20.5, 20.5, "imp"),    // sala C
      // --- extensión ---
      mkEnemy(29.5, 29.5, "zombie"), // conector 1
      mkEnemy(16.5, 36.5, "imp"),    // sala E1
      mkEnemy(13.5, 35.5, "zombie"), // sala E1
      mkEnemy(19.5, 38.5, "zombie"), // sala E1
      mkEnemy(23.5, 44.5, "zombie"), // conector 2
      mkEnemy(27.5, 45.5, "imp"),    // conector 2
      mkEnemy(30.5, 51.5, "imp"),    // sala E2
      mkEnemy(32.5, 54.5, "imp"),    // sala E2
      mkEnemy(17.5, 58.5, "zombie"), // conector 3
      mkEnemy(21.5, 59.5, "zombie"), // conector 3
      mkEnemy(22.5, 65.5, "imp"),    // sala E3
      mkEnemy(30.5, 66.5, "imp"),    // sala E3
      mkEnemy(24.5, 68.5, "zombie"), // sala E3
      mkEnemy(28.5, 64.5, "zombie"), // sala E3
      mkEnemy(26.5, 69.5, "zombie"), // sala E3
    ];
    items = [
      mkItem(20.5, 7.5, "ammo", 15),        // sala B
      mkItem(17.5, 22.5, "health", 30),     // sala C
      mkItem(22.5, 21.5, "armor", 50),      // sala C
      mkItem(31.5, 20.5, "shotgun", 15),    // sala D
      mkItem(15.5, 12.5, "secret", 0),      // dentro del cuarto secreto
      mkItem(22.5, 75.5, "fabri", 0),       // dentro del cuarto secreto 2 (fabri, 5000 puntos)
      // --- extensión ---
      mkItem(26.5, 29.5, "ammo", 15),       // conector 1
      mkItem(32.5, 29.5, "health", 25),     // conector 1
      mkItem(12.5, 39.5, "ammo", 15),       // sala E1
      mkItem(20.5, 35.5, "armor", 30),      // sala E1
      mkItem(22.5, 45.5, "ammo", 15),       // conector 2
      mkItem(28.5, 44.5, "health", 25),     // conector 2
      mkItem(29.5, 53.5, "health", 30),     // sala E2
      mkItem(33.5, 51.5, "ammo", 20),       // sala E2
      mkItem(16.5, 60.5, "armor", 30),      // conector 3
      mkItem(22.5, 57.5, "ammo", 15),       // conector 3
      mkItem(21.5, 69.5, "health", 30),     // sala E3
      mkItem(31.5, 64.5, "armor", 40),      // sala E3
      mkItem(29.5, 74.5, "health", 30),     // sala final, de regalo
    ];
  }
  function mkEnemy(x, y, kind) {
    const isImp = kind === "imp";
    return {
      x, y, kind, alive: true,
      hp: isImp ? 55 : 30,
      maxHp: isImp ? 55 : 30,
      speed: isImp ? 1.6 : 1.3,
      dmg: isImp ? 14 : 8,
      sightRange: isImp ? 9 : 7,
      attackRange: isImp ? 5.5 : 1.15,
      attackInterval: isImp ? 1.6 : 1.1,
      attackCooldown: Math.random(),
      chasing: false,
      hitTimer: 0,
      attackTimer: 0,
      walkClock: 0,
      walkToggle: false,
    };
  }
  function mkItem(x, y, type, amount) {
    return { x, y, type, amount, taken: false };
  }

  /* ---------------- Puntaje ---------------- */
  let score = 0;
  let kills = 0;
  let totalRoundsFired = 0;
  let levelStartTime = 0;

  /* ---------------- Estado del juego / pantallas ---------------- */
  let state = "menu"; // menu | playing | dead | won
  const keys = {};
  let muzzleFlashTimer = 0;
  let weaponGrabTimer = 0;
  let walkCycle = 0;
  let isMoving = false;
  let zBuffer = new Array(W).fill(1e9);
  let nearFinish = false;

  /* ---------------- DOM ---------------- */
  let root, canvas, ctx, elHealth, elArmor, elAmmo, elScoreLive, elFaceImg, elWeaponIcon, elInteractHint;
  let overlayMenu, overlayEnd, overlayLeaderboard, hitFlash;

  function buildDOM(container) {
    container.innerHTML = `
      <div id="dw-root" tabindex="0">
        <canvas id="dw-canvas" width="${W}" height="${H}"></canvas>
        <div id="dw-crosshair"></div>
        <div id="dw-hit-flash"></div>
        <div id="dw-interact-hint" class="dw-hidden">Presioná <b>E</b> para terminar el nivel</div>

                  <div id="dw-hud">
          <div class="dw-hud-side dw-hud-left">
            <div class="dw-hud-group">
              <img class="dw-hud-icon" src="${ASSET_PATHS.ammo}" alt="">
              <span class="dw-hud-num" id="dw-ammo">0</span>
            </div>
            <div class="dw-hud-group">
              <img class="dw-hud-icon" src="${ASSET_PATHS.armor}" alt="">
              <span class="dw-hud-num" id="dw-armor">0</span>
            </div>
          </div>

          <img class="dw-hud-face" id="dw-face-img" src="${ASSET_PATHS.peron1}" alt="">

          <div class="dw-hud-side dw-hud-right">
            <div class="dw-hud-group dw-hud-score-group">
              <span class="dw-hud-score-label">PUNTAJE</span>
              <span class="dw-hud-num" id="dw-score">0</span>
            </div>
            <div class="dw-hud-group">
              <img class="dw-hud-icon dw-hud-weapon-icon" id="dw-weapon-icon" src="${ASSET_PATHS.pistol}" alt="">
            </div>
            <div class="dw-hud-group">
              <img class="dw-hud-icon" src="${ASSET_PATHS.health}" alt="">
              <span class="dw-hud-num" id="dw-health">100</span>
            </div>
          </div>
        </div>

        <div class="dw-overlay" id="dw-overlay-menu">
          <h1 class="dw-title">WOOM-TANI</h1>
          <p class="dw-subtitle">Nivel 1. Movete con W A S D (o flechas), mirá con el mouse (click para capturarlo) o con Izquierda/Derecha, disparás con click o espacio. Cambiá de arma con 1 (pistola) y 2 (escopeta). Presioná E para interactuar con lo que tengas cerca (interruptores, puertas).</p>
          <button class="dw-btn" id="dw-btn-start">Empezar</button>
          <div class="dw-subtitle dw-pointerlock-hint">Consejo: si el juego está incrustado en un iframe, agregá el atributo allow="pointer-lock" para poder mirar con el mouse.</div>
          <button class="dw-btn dw-secondary" id="dw-btn-view-scores">Ver tabla de puntajes</button>
        </div>

        <div class="dw-overlay dw-hidden" id="dw-overlay-end">
          <h1 class="dw-title" id="dw-end-title">NIVEL COMPLETADO</h1>
          <div class="dw-score-breakdown" id="dw-breakdown"></div>
          <div id="dw-save-row">
            <input id="dw-name-input" maxlength="16" placeholder="TU NOMBRE" autocomplete="off">
            <button class="dw-btn" id="dw-btn-save">Guardar puntaje</button>
          </div>
          <button class="dw-btn dw-secondary dw-hidden" id="dw-btn-retry">Reintentar</button>
        </div>

        <div class="dw-overlay dw-hidden" id="dw-overlay-leaderboard">
          <h1 class="dw-title" id="dw-lb-title">TABLA DE PUNTAJES</h1>
          <table id="dw-leaderboard-table"><thead><tr><th>#</th><th>Nombre</th><th>Puntaje</th></tr></thead><tbody id="dw-lb-body"></tbody></table>
          <button class="dw-btn" id="dw-btn-restart">Jugar de nuevo</button>
        </div>
      </div>
    `;
    root = container.querySelector("#dw-root");
    canvas = container.querySelector("#dw-canvas");
    ctx = canvas.getContext("2d");
    hitFlash = container.querySelector("#dw-hit-flash");
    elHealth = container.querySelector("#dw-health");
    elArmor = container.querySelector("#dw-armor");
    elAmmo = container.querySelector("#dw-ammo");
    elScoreLive = container.querySelector("#dw-score");
    elWeaponIcon = container.querySelector("#dw-weapon-icon");
    elFaceImg = container.querySelector("#dw-face-img");
    elInteractHint = container.querySelector("#dw-interact-hint");
    overlayMenu = container.querySelector("#dw-overlay-menu");
    overlayEnd = container.querySelector("#dw-overlay-end");
    overlayLeaderboard = container.querySelector("#dw-overlay-leaderboard");

    container.querySelector("#dw-btn-start").addEventListener("click", startLevel);
    container.querySelector("#dw-btn-view-scores").addEventListener("click", () => showLeaderboard(null));
    container.querySelector("#dw-btn-restart").addEventListener("click", () => {
      overlayLeaderboard.classList.add("dw-hidden");
      overlayMenu.classList.remove("dw-hidden");
      state = "menu";
    });
    container.querySelector("#dw-btn-save").addEventListener("click", onSaveScore);
    container.querySelector("#dw-btn-retry").addEventListener("click", startLevel);

    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("keydown", (e) => {
      if (state === "playing") {
        keys[e.code] = true;
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        if (e.code === "Space") tryShoot();
        if (e.code === "KeyE") tryInteract();
        if (e.code === "Digit1") player.weapon = "pistol";
        if (e.code === "Digit2" && player.hasShotgun) player.weapon = "shotgun";
      }
    });
    document.addEventListener("keyup", (e) => { keys[e.code] = false; });
    document.addEventListener("mousemove", (e) => {
      if (state === "playing" && document.pointerLockElement === canvas) {
        player.angle += e.movementX * MOUSE_SENS;
        updateDirVectors();
      }
    });
  }

  function onCanvasClick() {
    if (state === "menu") { startLevel(); return; }
    if (state === "playing") {
      if (canvas.requestPointerLock && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
      tryShoot();
    }
  }

  function tryInteract() {
    if (nearFinish) { state = "won"; showEndScreen(true); return; }
    for (const d of SECRET_DOORS) {
      if (d.triggered) continue;
      const dx = player.x - (d.x + 0.5), dy = player.y - (d.y + 0.5);
      if (Math.hypot(dx, dy) < INTERACT_RADIUS) {
        d.triggered = true;
        d.animT = 0;
        playSound("door");
        faceOverrideImgKey = "peron_deidad";
        faceOverrideTimer = 2.2;
        return;
      }
    }
    for (const d of DOORS) {
      if (d.triggered) continue;
      const dx = player.x - (d.x + 0.5), dy = player.y - (d.y + 0.5);
      if (Math.hypot(dx, dy) < INTERACT_RADIUS) {
        d.triggered = true;
        d.animT = 0;
        playSound("door");
        return;
      }
    }
  }

  function updateDoors(dt) {
    for (const d of SECRET_DOORS) {
      if (d.triggered && !d.opened) {
        d.animT += dt;
        if (d.animT >= DOOR_ANIM_TIME) { d.animT = DOOR_ANIM_TIME; d.opened = true; map[d.y][d.x] = 0; }
      }
    }
    for (const d of DOORS) {
      if (d.triggered && !d.opened) {
        d.animT += dt;
        if (d.animT >= DOOR_ANIM_TIME) { d.animT = DOOR_ANIM_TIME; d.opened = true; map[d.y][d.x] = 0; }
      }
    }
  }

  /* ---------------- Ciclo de vida del nivel ---------------- */
  function startLevel() {
    buildLevel();
    buildEntities();
    player.x = 6.5; player.y = 6.5; player.angle = 0;
    updateDirVectors();
    player.health = 100; player.armor = 0; player.ammo = 40;
    player.hasShotgun = false; player.weapon = "pistol";
    score = 0; kills = 0; totalRoundsFired = 0;
    nearFinish = false;
    faceOverrideTimer = 0;
    weaponGrabTimer = 0;
    elInteractHint.classList.add("dw-hidden");
    levelStartTime = performance.now();
    overlayMenu.classList.add("dw-hidden");
    overlayEnd.classList.add("dw-hidden");
    overlayLeaderboard.classList.add("dw-hidden");
    state = "playing";
    stopDesesperado();
    ensureMusicPlaying();
  }

  function damagePlayer(amount) {
    const absorb = player.armor > 0 ? Math.min(player.armor, amount * 0.6) : 0;
    player.armor -= absorb;
    player.health -= (amount - absorb);
    flashHit();
    if (player.health <= 0) {
      player.health = 0;
      faceOverrideImgKey = "peron_death";
      faceOverrideTimer = 999;
      state = "dead";
      showEndScreen(false);
    } else {
      faceOverrideImgKey = painAlternateToggle ? "peron6" : "peron5";
      painAlternateToggle = !painAlternateToggle;
      faceOverrideTimer = 0.35;
    }
  }
  function flashHit() {
    hitFlash.style.opacity = "0.45";
    setTimeout(() => { hitFlash.style.opacity = "0"; }, 120);
  }

  function damageEnemy(en, dmg) {
    en.hp -= dmg;
    if (en.hp <= 0 && en.alive) {
      en.alive = false;
      kills++;
      score += 10;
    } else if (en.alive) {
      en.hitTimer = 0.25;
    }
  }

  function hasLineOfSight(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (!cellWalkable(Math.floor(x), Math.floor(y))) return false;
    }
    return true;
  }

  /* ---------------- Sonido ---------------- */
      const SOUND_PATHS = {
    pistol: "assets/sonidos/pistolEffect.mp3",
    shotgun: "assets/sonidos/shotgunEffect.mp3",
    item: "assets/sonidos/objectEffect.mp3",
    door: "assets/sonidos/doorEffect.mp3",
    soundtrack: "assets/sonidos/soundtrack.mp3",
    desesperado: "assets/sonidos/desesperado.mp3",
    cobra: "assets/sonidos/cobra.mp3",
  };
  const SOUND_VOLUME = { pistol: 0.4, shotgun: 0.5, item: 1, door: 0.8 };
  function playSound(key) {
    const src = SOUND_PATHS[key];
    if (!src) return;
    try {
      const a = new Audio(src);
      a.volume = SOUND_VOLUME[key] !== undefined ? SOUND_VOLUME[key] : 0.6;
      a.play().catch(() => { /* el navegador puede bloquear el audio hasta el primer gesto del usuario */ });
    } catch (e) { /* audio no disponible, seguimos sin romper el juego */ }
  }

  let musicAudio = null;
  function ensureMusicPlaying() {
    try {
      if (!musicAudio) {
        musicAudio = new Audio(SOUND_PATHS.soundtrack);
        musicAudio.loop = true;
        musicAudio.volume = 0.12;
      }
      if (musicAudio.paused) musicAudio.play().catch(() => { /* se desbloquea con el primer click del usuario */ });
    } catch (e) { /* audio no disponible, seguimos sin romper el juego */ }
  }

  let desesperadoAudio = null;
  function switchToDesesperado() {
    try {
      if (musicAudio && !musicAudio.paused) musicAudio.pause();
      if (!desesperadoAudio) {
        desesperadoAudio = new Audio(SOUND_PATHS.desesperado);
        desesperadoAudio.loop = true;
        desesperadoAudio.volume = 0.3;
      }
      if (desesperadoAudio.paused) desesperadoAudio.play().catch(() => {});
    } catch (e) { /* audio no disponible, seguimos sin romper el juego */ }
  }
  function stopDesesperado() {
    if (desesperadoAudio && !desesperadoAudio.paused) {
      desesperadoAudio.pause();
      desesperadoAudio.currentTime = 0;
    }
  }
  let cobraAudio = null;
function switchToCobra() {
  try {
    if (musicAudio && !musicAudio.paused) musicAudio.pause();
    if (desesperadoAudio && !desesperadoAudio.paused) desesperadoAudio.pause();
    if (!cobraAudio) {
      cobraAudio = new Audio(SOUND_PATHS.cobra);
      cobraAudio.loop = true;
      cobraAudio.volume = 0.3;
    }
    if (cobraAudio.paused) cobraAudio.play().catch(() => {});
  } catch (e) { /* audio no disponible, seguimos sin romper el juego */ }
}

  function tryShoot() {
    if (state !== "playing" || player.ammo <= 0) return;
    const cost = player.weapon === "shotgun" ? 2 : 1;
    player.ammo -= cost;
    totalRoundsFired += cost;
    muzzleFlashTimer = 0.14;
    playSound(player.weapon === "shotgun" ? "shotgun" : "pistol");
    const spread = player.weapon === "shotgun" ? 0.24 : 0.045;
    const dmg = player.weapon === "shotgun" ? rand(30, 48) : rand(9, 17);
    enemies.forEach((en) => {
      if (!en.alive) return;
      const dx = en.x - player.x, dy = en.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > WEAPON_RANGE) return;
      let ang = Math.atan2(dy, dx) - player.angle;
      ang = ((ang + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      if (Math.abs(ang) < spread && hasLineOfSight(player.x, player.y, en.x, en.y)) {
        damageEnemy(en, dmg);
      }
    });
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- Actualización por frame ---------------- */
  function update(dt) {
    walkCycle += dt * (isMoving ? 9 : 0);
    if (muzzleFlashTimer > 0) muzzleFlashTimer = Math.max(0, muzzleFlashTimer - dt);
    if (weaponGrabTimer > 0) weaponGrabTimer = Math.max(0, weaponGrabTimer - dt);
    if (faceOverrideTimer > 0) faceOverrideTimer = Math.max(0, faceOverrideTimer - dt);

    if (keys["ArrowLeft"]) { player.angle -= ROT_SPEED * dt; updateDirVectors(); }
    if (keys["ArrowRight"]) { player.angle += ROT_SPEED * dt; updateDirVectors(); }

    let mx = 0, my = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) { mx += player.dirX; my += player.dirY; }
    if (keys["KeyS"] || keys["ArrowDown"]) { mx -= player.dirX; my -= player.dirY; }
    const rightX = -player.dirY, rightY = player.dirX;
    if (keys["KeyD"]) { mx += rightX; my += rightY; }
    if (keys["KeyA"]) { mx -= rightX; my -= rightY; }
    const mlen = Math.hypot(mx, my);
    isMoving = mlen > 0.01;
    if (isMoving) {
      mx = (mx / mlen) * MOVE_SPEED * dt;
      my = (my / mlen) * MOVE_SPEED * dt;
      if (walkableWorld(player.x + mx, player.y, PLAYER_RADIUS)) player.x += mx;
      if (walkableWorld(player.x, player.y + my, PLAYER_RADIUS)) player.y += my;
    }

    updateEnemies(dt);
    updateItems();
    updateDoors(dt);
    checkNearFinish();
  }

  function updateEnemies(dt) {
    enemies.forEach((en) => {
      if (!en.alive) return;
      if (en.hitTimer > 0) en.hitTimer = Math.max(0, en.hitTimer - dt);
      if (en.attackTimer > 0) en.attackTimer = Math.max(0, en.attackTimer - dt);
      en.attackCooldown = Math.max(0, en.attackCooldown - dt);
      const dx = player.x - en.x, dy = player.y - en.y;
      const dist = Math.hypot(dx, dy);
      if (dist < en.sightRange && hasLineOfSight(en.x, en.y, player.x, player.y)) {
        if (dist > en.attackRange) {
          en.chasing = true;
          en.walkClock += dt;
          if (en.walkClock > 0.28) { en.walkClock = 0; en.walkToggle = !en.walkToggle; }
          const nx = en.x + (dx / dist) * en.speed * dt;
          const ny = en.y + (dy / dist) * en.speed * dt;
          if (walkableWorld(nx, en.y, ENEMY_RADIUS)) en.x = nx;
          if (walkableWorld(en.x, ny, ENEMY_RADIUS)) en.y = ny;
        } else {
          en.chasing = false;
          if (en.attackCooldown <= 0) {
            en.attackCooldown = en.attackInterval;
            en.attackTimer = 0.35;
            damagePlayer(en.dmg);
          }
        }
      } else {
        en.chasing = false;
      }
    });
  }

  function updateItems() {
    items.forEach((it) => {
      if (it.taken) return;
      const dist = Math.hypot(it.x - player.x, it.y - player.y);
      if (dist < PICKUP_RADIUS) {
        it.taken = true;
        playSound("item");
        if (it.type === "health") { player.health = Math.min(200, player.health + it.amount); score += 25; }
        else if (it.type === "armor") { player.armor = Math.min(200, player.armor + it.amount); score += 25; }
        else if (it.type === "ammo") { player.ammo += it.amount; score += 25; }
        else if (it.type === "secret") { score += 25; switchToDesesperado(); }
        else if (it.type === "fabri") { score += 5000; switchToCobra(); }
        else if (it.type === "shotgun") {
          player.hasShotgun = true; player.weapon = "shotgun"; player.ammo += it.amount; score += 200;
          weaponGrabTimer = 0.5;
        }
      }
    });
  }

  function checkNearFinish() {
    nearFinish = nearFinishSwitch(player.x, player.y);
    elInteractHint.classList.toggle("dw-hidden", !nearFinish);
  }

  /* ---------------- Fin de nivel y puntaje ---------------- */
  function showEndScreen(won) {
    document.exitPointerLock && document.exitPointerLock();
    const elapsedSec = (performance.now() - levelStartTime) / 1000;
    const bulletPenalty = Math.floor(totalRoundsFired / 10) * 5;
    const healthAdj = Math.round(won ? player.health - 100 : 0);
    const armorAdj = Math.round(won ? player.armor : 0);
    const timeBonus = won ? Math.max(0, Math.round(3000 - elapsedSec * 8)) : 0;
    const completeBonus = won ? 1000 : 0;
    let finalScore = score - bulletPenalty + completeBonus + healthAdj + armorAdj + timeBonus;
    finalScore = Math.max(0, Math.round(finalScore));

    container_lastFinalScore = finalScore;

    document.getElementById("dw-end-title").textContent = won ? "NIVEL COMPLETADO" : "HAS MUERTO";
    const rows = [["Enemigos + ítems + escopeta", score, null],
      ["Penalización por balas disparadas", -bulletPenalty, "neg"]];
    if (won) {
      rows.push(
        ["Bonus por completar el nivel", completeBonus, "pos"],
        ["Ajuste por vida final (" + Math.round(player.health) + "/100)", healthAdj, healthAdj >= 0 ? "pos" : "neg"],
        ["Ajuste por armadura final", armorAdj, "pos"],
        ["Bonus por tiempo (" + elapsedSec.toFixed(1) + "s)", timeBonus, "pos"]
      );
    }
    let html = "";
    rows.forEach(([label, val, cls]) => {
      const sign = val > 0 ? "+" : "";
      html += `<div class="dw-row"><span>${label}</span><span class="${cls === "pos" ? "dw-pos" : cls === "neg" ? "dw-neg" : ""}">${sign}${val}</span></div>`;
    });
    html += `<div class="dw-row dw-total"><span>PUNTAJE FINAL</span><span>${finalScore}</span></div>`;
    document.getElementById("dw-breakdown").innerHTML = html;

    document.getElementById("dw-save-row").classList.toggle("dw-hidden", !won);
    document.getElementById("dw-btn-retry").classList.toggle("dw-hidden", won);

    overlayEnd.classList.remove("dw-hidden");
    document.getElementById("dw-name-input").value = "";
  }

  let container_lastFinalScore = 0;

  function onSaveScore() {
    const nameInput = document.getElementById("dw-name-input");
    let name = (nameInput.value || "").trim().toUpperCase().slice(0, 16);
    if (!name) name = "DOOMGUY";
    const lb = saveToLeaderboard(name, container_lastFinalScore);
    overlayEnd.classList.add("dw-hidden");
    showLeaderboard(name, lb);
  }

  function loadLeaderboard() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; }
  }
  function saveToLeaderboard(name, scoreVal) {
    let lb = loadLeaderboard();
    const idx = lb.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) { if (scoreVal > lb[idx].score) lb[idx].score = scoreVal; }
    else lb.push({ name, score: scoreVal });
    lb.sort((a, b) => b.score - a.score);
    lb = lb.slice(0, 50);
    try { localStorage.setItem(LB_KEY, JSON.stringify(lb)); } catch (e) { /* almacenamiento no disponible */ }
    return lb;
  }
  function showLeaderboard(highlightName, lbData) {
    const lb = lbData || loadLeaderboard();
    const body = document.getElementById("dw-lb-body");
    body.innerHTML = lb.length
      ? lb.map((e, i) => `<tr class="${highlightName && e.name.toLowerCase() === highlightName.toLowerCase() ? "dw-you" : ""}"><td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td></tr>`).join("")
      : `<tr><td colspan="3">Todavía no hay puntajes guardados.</td></tr>`;
    overlayMenu.classList.add("dw-hidden");
    overlayEnd.classList.add("dw-hidden");
    overlayLeaderboard.classList.remove("dw-hidden");
    state = "menu";
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ---------------- Renderizado (raycasting) ---------------- */
  function render() {
    const imgData = ctx.getImageData(0, 0, W, H);
    castFloorCeiling(imgData);
    castWalls(imgData);
    ctx.putImageData(imgData, 0, 0);

    renderSprites();
    renderWeapon();
  }

  function castFloorCeiling(imgData) {
    const data = imgData.data;
    const floorTex = textures.floor, ceilTex = textures.techo;
    if (!floorTex || !ceilTex) {
      for (let y = 0; y < H; y++) {
        const c = y < H / 2 ? 42 : 36;
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
        }
      }
      return;
    }
    const rayDirX0 = player.dirX - player.planeX, rayDirY0 = player.dirY - player.planeY;
    const rayDirX1 = player.dirX + player.planeX, rayDirY1 = player.dirY + player.planeY;
    const halfH = H / 2;
    for (let y = Math.floor(halfH) + 1; y < H; y++) {
      const p = y - halfH;
      const rowDistance = halfH / p;
      const floorStepX = (rowDistance * (rayDirX1 - rayDirX0)) / W;
      const floorStepY = (rowDistance * (rayDirY1 - rayDirY0)) / W;
      let floorX = player.x + rowDistance * rayDirX0;
      let floorY = player.y + rowDistance * rayDirY0;
      const shade = Math.max(0.3, 1 - rowDistance / 18);
      const yMirror = H - 1 - y;
      const rowIdxFloor = y * W;
      const rowIdxCeil = yMirror * W;
      for (let x = 0; x < W; x++) {
        const cellX = Math.floor(floorX), cellY = Math.floor(floorY);
        const fracX = floorX - cellX, fracY = floorY - cellY;
        floorX += floorStepX; floorY += floorStepY;

        let tx = Math.floor(fracX * floorTex.width) % floorTex.width; if (tx < 0) tx += floorTex.width;
        let ty = Math.floor(fracY * floorTex.height) % floorTex.height; if (ty < 0) ty += floorTex.height;
        const fIdx = (ty * floorTex.width + tx) * 4;
        const pIdx = (rowIdxFloor + x) * 4;
        data[pIdx] = floorTex.data[fIdx] * shade;
        data[pIdx + 1] = floorTex.data[fIdx + 1] * shade;
        data[pIdx + 2] = floorTex.data[fIdx + 2] * shade;
        data[pIdx + 3] = 255;

        let txc = Math.floor(fracX * ceilTex.width) % ceilTex.width; if (txc < 0) txc += ceilTex.width;
        let tyc = Math.floor(fracY * ceilTex.height) % ceilTex.height; if (tyc < 0) tyc += ceilTex.height;
        const cIdx = (tyc * ceilTex.width + txc) * 4;
        const qIdx = (rowIdxCeil + x) * 4;
        data[qIdx] = ceilTex.data[cIdx] * shade;
        data[qIdx + 1] = ceilTex.data[cIdx + 1] * shade;
        data[qIdx + 2] = ceilTex.data[cIdx + 2] * shade;
        data[qIdx + 3] = 255;
      }
    }
  }

  function castWalls(imgData) {
    const data = imgData.data;
    for (let x = 0; x < W; x++) {
      const cameraX = (2 * x) / W - 1;
      const rayDirX = player.dirX + player.planeX * cameraX;
      const rayDirY = player.dirY + player.planeY * cameraX;
      let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
      const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
      const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
      let stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) { stepX = -1; sideDistX = (player.x - mapX) * deltaDistX; }
      else { stepX = 1; sideDistX = (mapX + 1 - player.x) * deltaDistX; }
      if (rayDirY < 0) { stepY = -1; sideDistY = (player.y - mapY) * deltaDistY; }
      else { stepY = 1; sideDistY = (mapY + 1 - player.y) * deltaDistY; }

      let hit = 0, side = 0, wallType = 1, safety = 0;
      while (hit === 0 && safety < 200) {
        safety++;
        if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
        else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapX >= MAP_W || mapY < 0 || mapY >= MAP_H) { hit = 1; wallType = 1; break; }
        if (map[mapY][mapX] > 0) { hit = 1; wallType = map[mapY][mapX]; }
      }
      const perpDist = Math.max(0.0001, side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY);
      zBuffer[x] = perpDist;
      const lineHeight = Math.max(1, Math.floor(H / perpDist));
      let drawStart = Math.floor(-lineHeight / 2 + H / 2);
      let drawEnd = Math.floor(lineHeight / 2 + H / 2);
      const clipStart = Math.max(0, drawStart);
      const clipEnd = Math.min(H - 1, drawEnd);

      const tex = (wallType === 5 && textures.secret_wall) ? textures.secret_wall
        : (wallType === 6 && textures.button_wall) ? textures.button_wall
        : (wallType === 7 && textures.door) ? textures.door
        : textures.wall;

      // Si la celda es una puerta (secreta o normal) que se está abriendo, calculamos
      // cuánto se deslizó hacia arriba para desplazar el sampleo de la textura.
      let doorProgress = 0;
      if (wallType === 5) {
        const dObj = SECRET_DOORS.find((dd) => dd.x === mapX && dd.y === mapY);
        if (dObj && dObj.triggered && !dObj.opened) doorProgress = Math.min(1, dObj.animT / DOOR_ANIM_TIME);
      } else if (wallType === 7) {
        const dObj = DOORS.find((dd) => dd.x === mapX && dd.y === mapY);
        if (dObj && dObj.triggered && !dObj.opened) doorProgress = Math.min(1, dObj.animT / DOOR_ANIM_TIME);
      }
      if (!tex) {
        const shade = Math.max(0.25, 1 - perpDist / 16);
        const c = 100 * shade;
        for (let y = clipStart; y <= clipEnd; y++) {
          const idx = (y * W + x) * 4;
          data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
        }
        continue;
      }

      let wallX = side === 0 ? player.y + perpDist * rayDirY : player.x + perpDist * rayDirX;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * tex.width);
      // Corrección de orientación (con el signo correcto para la convención de cámara de
      // este motor: dirX=cos(a), dirY=sin(a), planeX=-dirY, planeY=dirX). Sin esto, la mitad
      // de las paredes de un mismo tipo (según desde qué lado/dirección se las mire) quedan
      // espejadas; con el signo correcto, el texto se ve igual y correcto se lo mire desde
      // donde se lo mire, incluidas las puertas y la pared secreta que se recorren en ambos sentidos.
      if (side === 0 && rayDirX < 0) texX = tex.width - texX - 1;
      if (side === 1 && rayDirY > 0) texX = tex.width - texX - 1;
      texX = ((texX % tex.width) + tex.width) % tex.width;

      const shade = Math.max(0.3, 1 - perpDist / 16) * (side === 1 ? 0.7 : 1);
      for (let y = clipStart; y <= clipEnd; y++) {
        const d = y * 256 - H * 128 + lineHeight * 128;
        let texY = Math.floor((d * tex.height) / lineHeight / 256);
        if (doorProgress > 0) texY += Math.floor(doorProgress * tex.height);
        texY = ((texY % tex.height) + tex.height) % tex.height;
        const tIdx = (texY * tex.width + texX) * 4;
        const idx = (y * W + x) * 4;
        data[idx] = tex.data[tIdx] * shade;
        data[idx + 1] = tex.data[tIdx + 1] * shade;
        data[idx + 2] = tex.data[tIdx + 2] * shade;
        data[idx + 3] = 255;
      }
    }
  }

  function getEnemyAssetKey(en) {
    const isImp = en.kind === "imp";
    if (en.hitTimer > 0) return isImp ? "imp_hit" : "zombi_hit";
    if (en.attackTimer > 0) return isImp ? "imp_attack" : "zombi_attack";
    if (en.chasing) return isImp ? "imp_walk" : (en.walkToggle ? "zombi_walk_derecha" : "zombi_walk_izquierda");
    return isImp ? "imp_stand" : "zombi_walk_stand";
  }

  function renderSprites() {
    const drawables = [];
    enemies.forEach((e) => {
      if (e.alive) drawables.push({ x: e.x, y: e.y, img: assets[getEnemyAssetKey(e)], scale: 1, vOffset: 0, fallback: e.kind === "imp" ? "#8f371a" : "#4a5a2f" });
    });
    items.forEach((it) => {
      if (!it.taken) drawables.push({ x: it.x, y: it.y, img: assets[it.type === "secret" ? "secret_item" : it.type], scale: it.type === "secret" ? 0.4 : 0.5, vOffset: 0.28, fallback: "#d4b23c" });
    });
    drawables.forEach((o) => { o._d = (player.x - o.x) ** 2 + (player.y - o.y) ** 2; });
    drawables.sort((a, b) => b._d - a._d);

    const invDet = 1 / (player.planeX * player.dirY - player.dirX * player.planeY);
    drawables.forEach((sp) => {
      const spriteX = sp.x - player.x, spriteY = sp.y - player.y;
      const transformX = invDet * (player.dirY * spriteX - player.dirX * spriteY);
      const transformY = invDet * (-player.planeY * spriteX + player.planeX * spriteY);
      if (transformY <= 0.2) return;
      const spriteScreenX = Math.floor((W / 2) * (1 + transformX / transformY));
      const spriteHeight = Math.abs(Math.floor((H / transformY) * sp.scale));
      const spriteWidth = spriteHeight;
      if (spriteHeight <= 0 || spriteHeight > 3000) return;
      const drawStartY = Math.floor(-spriteHeight / 2 + H / 2 + sp.vOffset * (H / transformY));
      const drawStartX = Math.floor(spriteScreenX - spriteWidth / 2);

      const sampleCols = [drawStartX + spriteWidth * 0.2, spriteScreenX, drawStartX + spriteWidth * 0.8];
      const visible = sampleCols.some((cx) => {
        const ci = Math.floor(cx);
        return ci >= 0 && ci < W && transformY < zBuffer[ci];
      });
      if (!visible) return;
      drawImageSafe(sp.img, drawStartX, drawStartY, spriteWidth, spriteHeight, sp.fallback);
    });
  }

  function currentWeaponAssetKey() {
    if (player.weapon === "shotgun") {
      if (weaponGrabTimer > 0) return "shotgun_grap";
      if (muzzleFlashTimer > 0) return "shotgun_shot";
      return "shotgun_hand";
    }
    if (muzzleFlashTimer > 0) return "pistol_shot";
    return "pistol";
  }

  const HUD_HEIGHT_RATIO = 0.15; // debe coincidir con la altura del #dw-hud en el CSS
function renderWeapon() {
  const bobX = isMoving ? Math.sin(walkCycle) * 10 : 0;
  const bobY = isMoving ? Math.abs(Math.sin(walkCycle)) * 12 : 0;
  const recoil = muzzleFlashTimer > 0 ? 16 : 0;
  const img = assets[currentWeaponAssetKey()];
  const w = W * 0.4, h = w * 0.64;
  const x = W / 2 - w / 2 + bobX;
  const hudTop = H * (1 - HUD_HEIGHT_RATIO);
  const y = hudTop - h * 0.6 + bobY - recoil;
  drawImageSafe(img, x, y, w, h, "#3a3a3a");
}

  /* ---------------- HUD ---------------- */
  function updateHUD() {
    elHealth.textContent = Math.max(0, Math.round(player.health));
    elHealth.classList.toggle("dw-good", player.health > 100);
    elArmor.textContent = Math.round(player.armor);
    elAmmo.textContent = player.ammo;
    elScoreLive.textContent = score;
    elWeaponIcon.src = ASSET_PATHS[player.weapon === "shotgun" ? "shotgun_hand" : "pistol"];
    const faceKey = currentFaceKey();
    if (faceKey) elFaceImg.src = ASSET_PATHS[faceKey];
  }

  /* ---------------- Bucle principal ---------------- */
  let lastTime = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    try {
      if (state === "playing") {
        update(dt);
        render();
        updateHUD();
      }
    } catch (err) {
      console.error("[DOOM WEB] Error en el loop principal:", err);
    }
    requestAnimationFrame(loop);
  }

  /* ---------------- Arranque ---------------- */
  function init() {
    const container = document.getElementById("doom-web-container") || document.body;
    loadAssets(() => {
      buildDOM(container);
      requestAnimationFrame(loop);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();