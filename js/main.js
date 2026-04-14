// ==========================================
// js/main.js - NUCLEO DEL SIMULADOR
// ==========================================

// ---- GLOBALS ----
var renderer, scene, camera, cameraControls;
var reloj = new THREE.Clock();
var colisionables = [];
var diana_obj     = null;
var estadoJuego   = "MENU";
var p_tiro        = new THREE.Vector3(0, 6.6, 80);
var rondaRoot     = null;

// Estadisticas de sesion
var stats = crearStatsBase();
var fpsStats = null;

// Estado de partida
var modoJuego = null; // CAMPANA | DAILY
var enVistaCenital = false;
var objetivoActual = null;
var avancePendiente = null;
var dailySeed = 0;
var dailyKey = "";
var nombreJugador = "";
var partidaPausada = null;
var solicitudCambioNivel = null;
var vistaAntesCenital = null;
var retornoCenitalAnimando = false;

const TOTAL_NIVELES_CAMPANA = 5;
const DAILY_INTENTOS_MAX = 3;

function crearStatsBase() {
    return {
        ronda: 0,
        lanzamientos: 0,
        puntos: 0,
        maxNivel: 0,
        mejorPuntajeSesion: 0,
    };
}

// ---- APUNTADO FPS (Pointer Lock) ----
var apuntandoFPS = false;
var yaw          = Math.PI;
var pitch        = -0.08;
const PITCH_MIN  = -Math.PI / 2 + 0.05;
const PITCH_MAX  =  Math.PI / 4;
const SENS       = 0.0018;
const CARGA_MEDIA_CICLO_SEG = 0.75;
const POTENCIA_BASE = 0.5;

var cargandoLanzamiento = false;
var potenciaLanzamiento = POTENCIA_BASE;
var direccionPotencia = 1;

// ---- SEGUIMIENTO DE CAMARA ----
var camaraObjetivo = new THREE.Vector3();
var camaraTarget   = new THREE.Vector3();
const CAM_OFFSET   = new THREE.Vector3(0, 4, 8);
const CAM_LERP     = 0.06;
const CAM_UP       = new THREE.Vector3(0, 1, 0);
const CAM_LOOK_TIRO = new THREE.Vector3(0, 5, 0);
const TMP_DIR_VEL   = new THREE.Vector3();
const TMP_OFFSET    = new THREE.Vector3();
const TMP_LOOK_MAT  = new THREE.Matrix4();
const TMP_QUAT      = new THREE.Quaternion();

// ---- CONFIG OBJETIVOS CAMPANA ----
const OBJETIVOS_CAMPANA = [
    {
        id: "camp1",
        nombre: "Nivel 1 - Control Del Site",
        regla: "Detona dentro del site. Los rebotes suman puntuacion sin limite maximo.",
        evaluar: (d) => {
            const inSite = Math.abs(d.posicion.x) <= 30 && Math.abs(d.posicion.z) <= 30;
            const dist = d.posicion.length();
            return {
                ok: inSite,
                detalle: inSite ? "Control limpio" : "Fuera del site",
                precision: clamp01(1 - dist / 80),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.35),
            };
        },
    },
    {
        id: "camp2",
        nombre: "Nivel 2 - Bloqueo De Pasillo",
        regla: "Detona en el pasillo principal (z 34-94) con al menos 1 rebote.",
        evaluar: (d) => {
            const inZona = d.posicion.z >= 34 && d.posicion.z <= 94 && Math.abs(d.posicion.x) <= 14;
            const rebotesOk = d.rebotes >= 1;
            const centro = new THREE.Vector3(0, 1, 64);
            return {
                ok: inZona && rebotesOk,
                detalle: inZona ? (rebotesOk ? "Pasillo bloqueado" : "Necesitas al menos 1 rebote") : "No cayo en pasillo principal",
                precision: clamp01(1 - d.posicion.distanceTo(centro) / 45),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.32),
            };
        },
    },
    {
        id: "camp3",
        nombre: "Nivel 3 - Conector Izquierdo",
        regla: "Detona en conector izquierdo (x -72 a -34, z -2 a 20) con 1 o mas rebotes.",
        evaluar: (d) => {
            const inZona = d.posicion.x >= -72 && d.posicion.x <= -34 && d.posicion.z >= -2 && d.posicion.z <= 20;
            const rebotesOk = d.rebotes >= 1;
            const centro = new THREE.Vector3(-53, 1, 9);
            return {
                ok: inZona && rebotesOk,
                detalle: inZona ? (rebotesOk ? "Conector cubierto" : "Rebotes fuera de rango") : "No cayo en el conector izquierdo",
                precision: clamp01(1 - d.posicion.distanceTo(centro) / 35),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.4),
            };
        },
    },
    {
        id: "camp4",
        nombre: "Nivel 4 - Callejon Derecho",
        regla: "Detona en callejon derecho (x 34-60, z 6-24) con 2 o mas rebotes.",
        evaluar: (d) => {
            const inZona = d.posicion.x >= 34 && d.posicion.x <= 60 && d.posicion.z >= 6 && d.posicion.z <= 24;
            const rebotesOk = d.rebotes >= 2;
            const centro = new THREE.Vector3(47, 1, 14);
            return {
                ok: inZona && rebotesOk,
                detalle: inZona ? (rebotesOk ? "Callejon neutralizado" : "Necesitas mas rebotes") : "No cayo en callejon derecho",
                precision: clamp01(1 - d.posicion.distanceTo(centro) / 28),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 3, 0.35),
            };
        },
    },
    {
        id: "camp5",
        nombre: "Nivel 5 - Plantado De Precision",
        regla: "Detona a 8m de la diana, con 2 o mas rebotes y antes de 5s.",
        evaluar: (d) => {
            const dist = d.posicion.distanceTo(obtenerPosicionDiana());
            const distanciaOk = dist <= 8;
            const rebotesOk = d.rebotes >= 2;
            const tiempoOk = d.vueloMs <= 5000;
            return {
                ok: distanciaOk && rebotesOk && tiempoOk,
                detalle: distanciaOk ? (rebotesOk ? (tiempoOk ? "Lineup perfecto" : "Lento: supera 5s") : "Rebotes fuera de rango") : "Lejos de la diana",
                precision: clamp01(1 - dist / 16),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 3, 0.45),
            };
        },
    },
];

const OBJETIVOS_DAILY = [
    {
        id: "daily1",
        nombre: "Daily - Precision Absoluta",
        regla: "Detona a 6m de la diana. Los rebotes puntuan sin maximo.",
        evaluar: (d) => {
            const dist = d.posicion.distanceTo(obtenerPosicionDiana());
            const ok = dist <= 6;
            return {
                ok,
                detalle: ok ? "Precision diaria cumplida" : "No cumpliste precision",
                precision: clamp01(1 - dist / 12),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.35),
            };
        },
    },
    {
        id: "daily2",
        nombre: "Daily - Timing De Entrada",
        regla: "Detona en pasillo principal en menos de 4.5s y con 1+ rebote.",
        evaluar: (d) => {
            const inZona = d.posicion.z >= 34 && d.posicion.z <= 94 && Math.abs(d.posicion.x) <= 14;
            const ok = inZona && d.vueloMs <= 4500 && d.rebotes >= 1;
            return {
                ok,
                detalle: ok ? "Entrada bloqueada a tiempo" : "Fallo de zona, tiempo o rebotes",
                precision: clamp01(1 - d.posicion.distanceTo(new THREE.Vector3(0, 1, 64)) / 50),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.32),
            };
        },
    },
    {
        id: "daily3",
        nombre: "Daily - Doble Zona",
        regla: "Detona en conector izquierdo o callejon derecho con 1+ rebote.",
        evaluar: (d) => {
            const left = d.posicion.x >= -72 && d.posicion.x <= -34 && d.posicion.z >= -2 && d.posicion.z <= 20;
            const right = d.posicion.x >= 34 && d.posicion.x <= 60 && d.posicion.z >= 6 && d.posicion.z <= 24;
            const ok = (left || right) && d.rebotes >= 1;
            const target = left ? new THREE.Vector3(-53, 1, 9) : new THREE.Vector3(47, 1, 14);
            return {
                ok,
                detalle: ok ? "Zona tactica cubierta" : "No impactaste una zona valida",
                precision: clamp01(1 - d.posicion.distanceTo(target) / 40),
                reboteScore: scoreRebotesSinLimite(d.rebotes, 2, 0.32),
            };
        },
    },
];

// ---- ARRANQUE ----
init();
render();

// ==========================================
// INIT
// ==========================================
function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x87CEEB);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    document.getElementById('container').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 150, 400);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 120, 80);

    scene.add(new THREE.AmbientLight(0xfff5e0, 0.5));

    const sun = new THREE.DirectionalLight(0xfffbe8, 1.1);
    sun.position.set(80, 150, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 1, far: 400, left: -130, right: 130, top: 130, bottom: -130 });
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.3);
    fill.position.set(-40, 20, 80);
    scene.add(fill);

    cameraControls = new THREE.OrbitControls(camera, renderer.domElement);
    cameraControls.target.set(0, 5, 0);
    cameraControls.enableDamping = true;
    cameraControls.dampingFactor = 0.08;
    cameraControls.minPolarAngle = 0;
    cameraControls.maxPolarAngle = Math.PI / 2 - 0.05;
    cameraControls.enabled       = false;

    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('blur', cancelarCargaLanzamiento);

    document.getElementById('btn-lanzar').addEventListener('click', intentarLanzamiento);
    document.getElementById('btn-nuevo-mapa').addEventListener('click', () => {
        if (modoJuego === "DAILY") return;
        nuevaRonda();
    });
    document.getElementById('aim-overlay').addEventListener('click', () => {
        if (estadoJuego === "APUNTANDO" && !apuntandoFPS) entrarModoApuntado();
    });

    document.getElementById('btn-campana').addEventListener('click', iniciarCampana);
    document.getElementById('btn-daily').addEventListener('click', iniciarDaily);
    document.getElementById('btn-nivel-si').addEventListener('click', () => resolverCambioNivel(true));
    document.getElementById('btn-nivel-no').addEventListener('click', () => resolverCambioNivel(false));

    inicializarFpsMeter();

    const inputNombre = document.getElementById('input-player-name');
    const guardado = (localStorage.getItem('lineup_player_name') || '').trim();
    if (guardado) {
        inputNombre.value = guardado;
        nombreJugador = guardado;
    }
    inputNombre.addEventListener('change', () => {
        inputNombre.value = sanitizarNombre(inputNombre.value);
    });

    mostrarHUDJuego(false);
    actualizarRankingMenuDaily();
}

// ==========================================
// MODO JUEGO
// ==========================================
function iniciarCampana() {
    if (!asegurarNombreJugador()) return;

    partidaPausada = null;
    solicitudCambioNivel = null;
    ocultarModalCambioNivel();
    modoJuego = "CAMPANA";
    stats = crearStatsBase();
    stats.ronda = 1;
    avancePendiente = null;
    objetivoActual = OBJETIVOS_CAMPANA[0];
    setTextoMenu("Modo Libre iniciado. Supera 5 niveles incrementales.");
    ocultarMenu();
    nuevaRonda();
}

function iniciarDaily() {
    if (!asegurarNombreJugador()) return;

    sincronizarClaveDailyHoy();

    const progresoDaily = leerProgresoDaily();
    if (progresoDaily.bloqueado || progresoDaily.intentosUsados >= DAILY_INTENTOS_MAX) {
        setTextoMenu(`Daily ${dailyKey} ya completado (${DAILY_INTENTOS_MAX}/${DAILY_INTENTOS_MAX} intentos usados). Vuelve manana.`);
        actualizarRankingMenuDaily();
        return;
    }

    partidaPausada = null;
    modoJuego = "DAILY";
    stats = crearStatsBase();
    stats.ronda = 1;
    stats.lanzamientos = progresoDaily.intentosUsados;
    avancePendiente = null;

    objetivoActual = OBJETIVOS_DAILY[dailySeed % OBJETIVOS_DAILY.length];

    const restantes = intentosDailyRestantes();
    setTextoMenu(`Daily ${dailyKey} listo. Intentos disponibles: ${restantes}/${DAILY_INTENTOS_MAX}.`);
    ocultarMenu();
    nuevaRonda();
}

function intentosDailyRestantes() {
    if (modoJuego !== "DAILY") return Infinity;
    return Math.max(0, DAILY_INTENTOS_MAX - stats.lanzamientos);
}

function puedeLanzarEnModoActual() {
    if (modoJuego !== "DAILY") return true;
    if (intentosDailyRestantes() > 0) return true;

    mostrarBoton('btn-lanzar', false);
    setUI("DAILY COMPLETADO", "Sin intentos restantes. Pulsa Esc para volver al menu");
    return false;
}

function intentarLanzamiento() {
    let potencia = arguments.length > 0 ? arguments[0] : POTENCIA_BASE;
    if (estadoJuego !== "APUNTANDO" || !apuntandoFPS) return;
    if (solicitudCambioNivel) return;
    if (!puedeLanzarEnModoActual()) return;
    lanzarGranada(clamp01(potencia));
}

function iniciarCargaLanzamiento() {
    if (estadoJuego !== "APUNTANDO" || !apuntandoFPS) return;
    if (solicitudCambioNivel || !puedeLanzarEnModoActual()) return;
    if (cargandoLanzamiento) return;

    cargandoLanzamiento = true;
    potenciaLanzamiento = POTENCIA_BASE;
    direccionPotencia = 1;
    actualizarIndicadorPotencia(potenciaLanzamiento, true);
    setUI("CARGANDO LANZAMIENTO", "Suelta ESPACIO para lanzar");
}

function actualizarCargaLanzamiento(deltaSec) {
    if (!cargandoLanzamiento) return;

    const dt = Math.max(0.0001, Number(deltaSec) || (1 / 60));
    const paso = dt / CARGA_MEDIA_CICLO_SEG;

    potenciaLanzamiento += paso * direccionPotencia;

    if (potenciaLanzamiento >= 1) {
        potenciaLanzamiento = 1;
        direccionPotencia = -1;
    } else if (potenciaLanzamiento <= 0) {
        potenciaLanzamiento = 0;
        direccionPotencia = 1;
    }

    actualizarIndicadorPotencia(potenciaLanzamiento, true);
}

function soltarCargaYLanzar() {
    if (!cargandoLanzamiento) return;

    const potencia = clamp01(potenciaLanzamiento);
    cargandoLanzamiento = false;
    potenciaLanzamiento = POTENCIA_BASE;
    actualizarIndicadorPotencia(potencia, false);
    intentarLanzamiento(potencia);
}

function cancelarCargaLanzamiento() {
    if (!cargandoLanzamiento) {
        actualizarIndicadorPotencia(POTENCIA_BASE, false);
        return;
    }

    cargandoLanzamiento = false;
    potenciaLanzamiento = POTENCIA_BASE;
    direccionPotencia = 1;
    actualizarIndicadorPotencia(POTENCIA_BASE, false);
}

function obtenerColorPotencia(n) {
    if (n < 0.34) return '#67d46f';
    if (n < 0.67) return '#f0d24a';
    return '#ef5b5b';
}

function etiquetaPotencia(n) {
    if (n < 0.34) return 'FLOJO';
    if (n < 0.67) return 'MEDIO';
    return 'FUERTE';
}

function actualizarIndicadorPotencia(valorNorm, visible) {
    const panel = document.getElementById('power-indicator');
    const label = document.getElementById('power-label');
    const fill = document.getElementById('power-fill');
    if (!panel || !label || !fill) return;

    const n = clamp01(Number(valorNorm) || 0);
    const pct = Math.round(n * 100);
    const color = obtenerColorPotencia(n);

    fill.style.width = `${pct}%`;
    fill.style.background = color;
    label.style.color = color;
    label.innerText = `POTENCIA ${pct}% - ${etiquetaPotencia(n)}`;

    const mostrar = !!visible && estadoJuego === "APUNTANDO" && apuntandoFPS && !enVistaCenital;
    panel.style.display = mostrar ? 'block' : 'none';
}

function ocultarMenu() {
    document.getElementById('menu-principal').style.display = 'none';
    mostrarHUDJuego(true);
}

function mostrarMenu(mensaje, conservarPausa) {
    estadoJuego = "MENU";
    if (!conservarPausa) partidaPausada = null;
    if (!conservarPausa) solicitudCambioNivel = null;
    ocultarModalCambioNivel();
    modoJuego = null;
    mostrarHUDJuego(false);
    setOverlay(false);
    mostrarCrosshair(false);
    mostrarBoton('btn-lanzar', false);
    mostrarBoton('btn-nuevo-mapa', false);
    document.getElementById('resultado-panel').style.display = 'none';
    document.getElementById('menu-principal').style.display = 'flex';
    setTextoMenu(mensaje || "Elige un modo para empezar");
    actualizarRankingMenuDaily();
}

function setTextoMenu(texto) {
    document.getElementById('menu-info').innerText = texto;
}

function mostrarHUDJuego(visible) {
    const val = visible ? 'block' : 'none';
    document.getElementById('ui-top').style.display = val;
    document.getElementById('stats-panel').style.display = val;
    document.getElementById('controles-panel').style.display = val;
    document.getElementById('objetivo-panel').style.display = visible ? 'block' : 'none';
    if (visible) actualizarHUDModo();
}

function actualizarHUDModo() {
    const isDaily = modoJuego === "DAILY";

    const rowRonda = document.getElementById('stat-row-ronda');
    const rowBestNivel = document.getElementById('stat-row-best-nivel');
    if (rowRonda) rowRonda.style.display = isDaily ? 'none' : 'flex';
    if (rowBestNivel) rowBestNivel.style.display = isDaily ? 'none' : 'flex';

    const panelControles = document.getElementById('controles-panel');
    if (!panelControles) return;

    if (isDaily) {
        panelControles.innerHTML = [
            '<div class="ctrl-hint"><kbd>ESPACIO</kbd> Mantener y soltar (potencia)</div>',
            '<div class="ctrl-hint"><kbd>V</kbd> Vista cenital</div>',
            '<div class="ctrl-hint"><kbd>ESC</kbd> Menu / reanudar</div>'
        ].join('');
        return;
    }

    panelControles.innerHTML = [
        '<div class="ctrl-hint"><kbd>ESPACIO</kbd> Mantener y soltar (potencia)</div>',
        '<div class="ctrl-hint"><kbd>R</kbd> Nuevo mapa</div>',
        '<div class="ctrl-hint"><kbd>V</kbd> Vista cenital</div>',
        '<div class="ctrl-hint"><kbd>ESC</kbd> Soltar raton / menu</div>'
    ].join('');
}

function textoApuntadoHUD() {
    if (modoJuego === "DAILY") {
        return "V = Vista cenital | Esc = Menu principal";
    }
    return "R = Reiniciar ronda | V = Vista cenital | Esc = Menu principal";
}

function textoEnPosicionHUD() {
    if (modoJuego === "DAILY") {
        return "Mantener Espacio = Cargar | Soltar = Lanzar | Esc = Soltar raton / Menu";
    }
    return "Mantener Espacio = Cargar | Soltar = Lanzar | Esc = Soltar raton | R = Reiniciar";
}

function pausarPartidaEnMenu() {
    if (!modoJuego) return;
    partidaPausada = {
        modoJuego,
        estadoAnterior: estadoJuego,
    };
    mostrarMenu("Partida en pausa. Pulsa Esc para reanudar.", true);
}

function reanudarPartidaPausada() {
    if (!partidaPausada || !partidaPausada.modoJuego) return;

    modoJuego = partidaPausada.modoJuego;
    const estadoPrevio = partidaPausada.estadoAnterior;
    partidaPausada = null;

    ocultarMenu();
    actualizarHUD();
    actualizarObjetivoUI();

    if (estadoPrevio === "VOLANDO" || estadoPrevio === "DETONANDO") {
        estadoJuego = estadoPrevio;
        mostrarBoton('btn-lanzar', false);
        mostrarBoton('btn-nuevo-mapa', false);
        setOverlay(false);
        mostrarCrosshair(false);
        setUI("PARTIDA REANUDADA", "Continuando lanzamiento...");
        return;
    }

    estadoJuego = "APUNTANDO";
    cameraControls.enabled = false;
    enVistaCenital = false;

    if (apuntandoFPS) {
        setOverlay(false);
        mostrarCrosshair(true);
        setUI("EN POSICION", textoEnPosicionHUD());
    } else {
        setOverlay(true);
        mostrarCrosshair(false);
        setUI("PULSA ESPACIO PARA APUNTAR", textoApuntadoHUD());
    }

    mostrarBoton('btn-lanzar', puedeLanzarEnModoActual());
    mostrarBoton('btn-nuevo-mapa', modoJuego !== "DAILY");
}

// ==========================================
// LOAD SCENE
// ==========================================
function loadScene() {
    if (rondaRoot && rondaRoot.parent) rondaRoot.parent.remove(rondaRoot);
    rondaRoot = new THREE.Group();
    scene.add(rondaRoot);

    crearSuelo(rondaRoot);

    if (typeof generarMapaAleatorio === "function") {
        if (modoJuego === "DAILY") {
            stats.ronda = 1;
            generarMapaAleatorio(dailySeed, { modo: "DAILY", dianaSeed: dailySeed, rootGroup: rondaRoot });
        } else {
            const seedCampana = Math.random() * 9999;
            stats.ronda = OBJETIVOS_CAMPANA.indexOf(objetivoActual) + 1;
            generarMapaAleatorio(seedCampana, { modo: "CAMPANA", rootGroup: rondaRoot, nivelCampana: stats.ronda });
        }

        actualizarHUD();
        actualizarObjetivoUI();
    } else {
        console.error("generador.js no cargado");
    }

    setTimeout(iniciarCinematica, 1200);
}

function crearSuelo(rootGroup) {
    const host = rootGroup || scene;

    const suelo = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshLambertMaterial({ color: 0x6e6e60 })
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.receiveShadow = true;
    host.add(suelo);

    const site = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshLambertMaterial({ color: 0x857a6e })
    );
    site.rotation.x = -Math.PI / 2;
    site.position.y = 0.01;
    site.receiveShadow = true;
    host.add(site);
}

// ==========================================
// LOOP
// ==========================================
function render() {
    requestAnimationFrame(render);
    const deltaSec = Math.min(0.05, reloj.getDelta());
    if (fpsStats) fpsStats.begin();
    TWEEN.update();

    if (cameraControls.enabled) cameraControls.update();

    if (apuntandoFPS && estadoJuego === "APUNTANDO" && !retornoCenitalAnimando) {
        camera.position.copy(p_tiro);
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
    }

    if (estadoJuego === "APUNTANDO") {
        actualizarCargaLanzamiento(deltaSec);
    } else if (cargandoLanzamiento) {
        cancelarCargaLanzamiento();
    }

    if (estadoJuego === "VOLANDO" || estadoJuego === "DETONANDO") {
        actualizarCamaraSeguimiento();
    }

    switch (estadoJuego) {
        case "VOLANDO":   actualizarFisicasGranada(deltaSec); break;
        case "DETONANDO": expandirHumo(deltaSec);             break;
    }

    renderer.render(scene, camera);
    if (fpsStats) fpsStats.end();
}

function inicializarFpsMeter() {
    const host = document.getElementById('fps-meter');
    if (!host || typeof Stats !== 'function') return;

    fpsStats = new Stats();
    fpsStats.showPanel(0);

    const dom = fpsStats.dom || fpsStats.domElement;
    if (!dom) {
        fpsStats = null;
        return;
    }

    dom.style.position = 'static';
    dom.style.left = 'auto';
    dom.style.top = 'auto';
    dom.style.opacity = '1';
    dom.style.cursor = 'default';

    host.innerHTML = '';
    host.appendChild(dom);
}

// ==========================================
// CAMARA SEGUIMIENTO
// ==========================================
function actualizarCamaraSeguimiento() {
    if (!granada_obj || (!granada_obj.visible && estadoJuego === "VOLANDO")) return;

    const objetivo = (estadoJuego === "DETONANDO" && humo_obj)
        ? humo_obj.position
        : granada_obj.position;

    if (typeof vel !== "undefined" && vel.length() > 0.01) {
        TMP_DIR_VEL.copy(vel).normalize();
    } else {
        TMP_DIR_VEL.set(0, -0.3, 1).normalize();
    }

    TMP_OFFSET.set(0, CAM_OFFSET.y, 0).addScaledVector(TMP_DIR_VEL, -CAM_OFFSET.z);
    camaraObjetivo.copy(objetivo).add(TMP_OFFSET);
    camaraTarget.copy(objetivo).addScaledVector(TMP_DIR_VEL, 3);

    camera.position.lerp(camaraObjetivo, CAM_LERP);

    TMP_LOOK_MAT.lookAt(camera.position, camaraTarget, CAM_UP);
    TMP_QUAT.setFromRotationMatrix(TMP_LOOK_MAT);
    camera.quaternion.slerp(TMP_QUAT, CAM_LERP * 1.5);
}

// ==========================================
// CINEMATICAS
// ==========================================
function iniciarCinematica() {
    estadoJuego = "CINEMATICA";
    setUI("RECONOCIMIENTO...", "Observa el escenario");
    cameraControls.enabled = true;

    new TWEEN.Tween(camera.position)
        .to({ x: 30, y: 140, z: 60 }, 2200)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();

    new TWEEN.Tween(cameraControls.target)
        .to({ x: 0, y: 0, z: 10 }, 2200)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onComplete(cinematicaFase2)
        .start();
}

function cinematicaFase2() {
    setUI("TOMANDO POSICION...", "");

    new TWEEN.Tween(camera.position)
        .to({ x: p_tiro.x, y: p_tiro.y, z: p_tiro.z }, 2400)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();

    new TWEEN.Tween(cameraControls.target)
        .to({ x: 0, y: 5, z: 0 }, 2400)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onComplete(iniciarFaseApuntado)
        .start();
}

function iniciarFaseApuntado() {
    cameraControls.enabled = false;
    estadoJuego = "APUNTANDO";
    cancelarCargaLanzamiento();
    mostrarBoton('btn-lanzar', puedeLanzarEnModoActual());
    mostrarBoton('btn-nuevo-mapa', modoJuego !== "DAILY");
    setUI("PULSA ESPACIO PARA APUNTAR", textoApuntadoHUD());
    mostrarCrosshair(false);
    setOverlay(true);
}

// ==========================================
// POINTER LOCK
// ==========================================
function entrarModoApuntado() {
    renderer.domElement.requestPointerLock();
}

function onPointerLockChange() {
    apuntandoFPS = (document.pointerLockElement === renderer.domElement);

    if (enVistaCenital) {
        cancelarCargaLanzamiento();
        setOverlay(false);
        mostrarCrosshair(false);
        return;
    }

    if (apuntandoFPS) {
        yaw   = camera.rotation.y;
        pitch = camera.rotation.x;
        setOverlay(false);
        mostrarCrosshair(true);
        setUI("EN POSICION", textoEnPosicionHUD());
    } else {
        cancelarCargaLanzamiento();
        mostrarCrosshair(false);
        if (estadoJuego === "APUNTANDO") {
            setOverlay(true);
            setUI("PULSA ESPACIO PARA APUNTAR", textoApuntadoHUD());
        }
    }
}

function onMouseMove(e) {
    if (!apuntandoFPS || estadoJuego !== "APUNTANDO") return;
    yaw   -= e.movementX * SENS;
    pitch -= e.movementY * SENS;
    pitch  = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
}

// ==========================================
// TECLADO
// ==========================================
function onKeyDown(e) {
    if (e.code === 'Space' && e.repeat) return;

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (estadoJuego === "APUNTANDO") {
                if (!apuntandoFPS) entrarModoApuntado();
                else iniciarCargaLanzamiento();
            }
            break;

        case 'KeyR':
            if (estadoJuego === "APUNTANDO" || estadoJuego === "DETONANDO") {
                if (solicitudCambioNivel) {
                    setUI("CONFIRMA CAMBIO DE NIVEL", "Elige Si o No en la ventana de confirmacion");
                    return;
                }
                if (modoJuego === "DAILY") {
                    setUI("DAILY FIJO", "En daily no se puede cambiar el mapa");
                    return;
                }
                cancelarCargaLanzamiento();
                salirPointerLock();
                nuevaRonda();
            }
            break;

        case 'KeyV':
            if (estadoJuego === "APUNTANDO") {
                cancelarCargaLanzamiento();
                toggleVistaCenital();
            }
            break;

        case 'Escape':
            if (estadoJuego === "MENU") {
                if (partidaPausada) reanudarPartidaPausada();
                break;
            }

            if (solicitudCambioNivel) {
                setUI("CONFIRMA CAMBIO DE NIVEL", "Elige Si o No en la ventana de confirmacion");
                break;
            }

            if (estadoJuego === "APUNTANDO" && apuntandoFPS) {
                cancelarCargaLanzamiento();
                salirPointerLock();
                setUI("APUNTADO EN PAUSA", textoApuntadoHUD());
                break;
            }

            if (modoJuego) {
                cancelarCargaLanzamiento();
                salirPointerLock();
                pausarPartidaEnMenu();
            }
            break;
    }
}

function onKeyUp(e) {
    if (e.code !== 'Space') return;
    e.preventDefault();

    if (estadoJuego === "APUNTANDO" && apuntandoFPS) {
        soltarCargaYLanzar();
    } else {
        cancelarCargaLanzamiento();
    }
}

// ==========================================
// RESULTADOS Y PUNTUACION
// ==========================================
function procesarResultadoLanzamiento(data) {
    registrarLanzamiento(data.rebotes);

    const evalObj = objetivoActual.evaluar(data);
    const score = calcularPuntuacion(data, evalObj);
    stats.puntos += score.total;
    if (score.total > stats.mejorPuntajeSesion) stats.mejorPuntajeSesion = score.total;
    actualizarMaxPuntajeNivel(score.total);
    actualizarHUD();
    actualizarObjetivoUI();
    mostrarResultado(score, evalObj, data);

    if (modoJuego === "DAILY") {
        guardarEnRankingDaily(score.total, score.estrellas);

        if (intentosDailyRestantes() <= 0) {
            mostrarBoton('btn-lanzar', false);
            setUI("DAILY FINALIZADO", `Intentos usados: ${DAILY_INTENTOS_MAX}/${DAILY_INTENTOS_MAX}. Esc para menu`);
        }
    }

    if (modoJuego === "CAMPANA") {
        if (score.impactoDiana.acierto) {
            prepararCambioNivelPorAcierto(score.estrellas);
        } else if (evalObj.ok) {
            setUI("OBJETIVO CUMPLIDO", "Acierta la diana para cambiar de nivel");
        }
    }
}

function calcularPuntuacion(data, evalObj) {
    const precisionNorm = clamp01(evalObj.precision);
    const rebotesNorm = clamp01(evalObj.reboteScore);
    const impactoDiana = evaluarImpactoDiana(data.posicion);

    const baseObjetivo = evalObj.ok ? 650 : 180;
    const precision = Math.round(Math.pow(precisionNorm, 1.15) * 420);
    const precisionDiana = Math.round(Math.pow(impactoDiana.precision, 1.08) * 520);
    const rebotes = Math.round(Math.pow(rebotesNorm, 1.08) * 260);
    const tiempo = Math.round(clamp01(1 - data.vueloMs / 9000) * 170);
    const dificultad = Math.round((typeof dificultad_calculada === "number" ? dificultad_calculada : 5) * 48);

    const bonusZonaDiana = impactoDiana.zona === "BULLSEYE" ? 260 : (impactoDiana.zona === "CENTRO" ? 160 : (impactoDiana.zona === "BORDE" ? 90 : 0));
    const bonusCombo = (evalObj.ok && impactoDiana.acierto) ? 170 : 0;
    const bonusControl = (data.vueloMs >= 1100 && data.vueloMs <= 5200) ? 60 : 0;

    let total = baseObjetivo + precision + precisionDiana + rebotes + tiempo + dificultad + bonusZonaDiana + bonusCombo + bonusControl;
    if (!impactoDiana.acierto) {
        // Si cae fuera de la diana, el score no debe competir con impactos reales.
        total = Math.round(total * (evalObj.ok ? 0.45 : 0.30));
    }

    const estrellas = calcularEstrellas(data.posicion, impactoDiana);
    return {
        total,
        estrellas,
        impactoDiana,
        desglose: { baseObjetivo, precision, precisionDiana, rebotes, tiempo, dificultad, bonusZonaDiana, bonusCombo, bonusControl },
    };
}

function calcularEstrellas(posicionDetonacion, impactoDiana) {
    const impacto = impactoDiana || (posicionDetonacion ? evaluarImpactoDiana(posicionDetonacion) : null);
    if (!impacto || !impacto.acierto) return 0;

    // Regla solicitada: 1* borde, 2* centro, 3* bullseye o muy cerca del centro.
    if (impacto.zona === "BULLSEYE") return 3;
    if (impacto.zona === "CENTRO") return 2;
    return 1;
}

function mostrarResultado(score, evalObj, data) {
    const panel = document.getElementById('resultado-panel');
    panel.style.display = 'block';

    const distDiana = (data && data.posicion)
        ? data.posicion.distanceTo(obtenerPosicionDiana()).toFixed(1)
        : "-";

    document.getElementById('res-puntaje').innerText = `${score.total} pts`;
    document.getElementById('res-estrellas').innerText = "★".repeat(score.estrellas) + "☆".repeat(3 - score.estrellas);
    const zona = score.impactoDiana ? score.impactoDiana.zona : "FUERA";
    document.getElementById('res-detalle').innerText =
        `${evalObj.detalle} | Dist:${distDiana}m (${zona}) | B:${score.desglose.baseObjetivo} P:${score.desglose.precision} D:${score.desglose.precisionDiana} R:${score.desglose.rebotes} T:${score.desglose.tiempo} X:${score.desglose.bonusZonaDiana + score.desglose.bonusCombo + score.desglose.bonusControl}`;
}

function prepararCambioNivelPorAcierto(estrellas) {
    const idx = OBJETIVOS_CAMPANA.indexOf(objetivoActual);
    const haySiguiente = idx >= 0 && idx < TOTAL_NIVELES_CAMPANA - 1;

    solicitudCambioNivel = { idx, haySiguiente, estrellas: Math.max(1, estrellas || 1) };
    mostrarModalCambioNivel(estrellas, haySiguiente);
    setUI("DIANA ACERTADA", haySiguiente ? "Elige si quieres cambiar de nivel" : "Elige si quieres finalizar Modo Libre");
}

function mostrarModalCambioNivel(estrellas, haySiguiente) {
    // Libera el cursor para poder interactuar con el modal aunque vengamos de apuntado FPS.
    salirPointerLock();
    setOverlay(false);
    mostrarCrosshair(false);

    const modal = document.getElementById('nivel-up-modal');
    const stars = document.getElementById('nivel-stars-big');
    const sub = document.getElementById('nivel-up-sub');

    if (stars) stars.innerText = "★".repeat(Math.max(1, estrellas || 1));
    if (sub) sub.innerText = haySiguiente ? "¿Cambiar de nivel?" : "¿Finalizar Modo Libre?";
    if (modal) modal.style.display = 'flex';
    generarConfettiCambioNivel();
}

function ocultarModalCambioNivel() {
    const modal = document.getElementById('nivel-up-modal');
    const layer = document.getElementById('nivel-confetti-layer');
    if (layer) layer.innerHTML = '';
    if (modal) modal.style.display = 'none';
}

function generarConfettiCambioNivel() {
    const layer = document.getElementById('nivel-confetti-layer');
    if (!layer) return;

    layer.innerHTML = '';
    const colores = ['#ffd54f', '#73d0ff', '#f87979', '#8de39f', '#d4a3ff', '#ffb36b'];

    for (let i = 0; i < 42; i++) {
        const p = document.createElement('span');
        p.className = 'confetti-piece';
        p.style.left = `${Math.random() * 100}%`;
        p.style.background = colores[Math.floor(Math.random() * colores.length)];
        p.style.animationDelay = `${Math.random() * 0.28}s`;
        p.style.setProperty('--drift', `${(Math.random() - 0.5) * 180}px`);
        p.style.setProperty('--rot-end', `${Math.random() * 720 + 360}deg`);
        layer.appendChild(p);
    }
}

function resolverCambioNivel(cambiar) {
    if (!solicitudCambioNivel) return;

    const info = solicitudCambioNivel;
    solicitudCambioNivel = null;
    ocultarModalCambioNivel();

    if (!cambiar) {
        avancePendiente = null;
        if (estadoJuego === "APUNTANDO") {
            if (apuntandoFPS) {
                setOverlay(false);
                mostrarCrosshair(true);
            } else {
                setOverlay(true);
                mostrarCrosshair(false);
            }
            mostrarBoton('btn-lanzar', true);
            mostrarBoton('btn-nuevo-mapa', modoJuego !== "DAILY");
            setUI("CONTINUAS EN EL NIVEL", apuntandoFPS ? textoEnPosicionHUD() : textoApuntadoHUD());
        } else {
            setUI("CONTINUAS EN EL NIVEL", "Pulsa espacio para intentar otra vez");
        }
        return;
    }

    avancePendiente = info.haySiguiente ? "SIGUIENTE_NIVEL" : "FIN_CAMPANA";
    setUI("CAMBIANDO NIVEL", info.haySiguiente ? "Generando nuevo mapa..." : "Finalizando Modo Libre...");

    // No esperes a que termine la animacion de humo: avanza de nivel al instante.
    if (estadoJuego === "DETONANDO" || estadoJuego === "VOLVIENDO" || estadoJuego === "APUNTANDO") {
        ejecutarAvancePendiente();
    }
}

function ejecutarAvancePendiente() {
    if (avancePendiente === "SIGUIENTE_NIVEL") {
        const idx = OBJETIVOS_CAMPANA.indexOf(objetivoActual);
        objetivoActual = OBJETIVOS_CAMPANA[idx + 1];
        avancePendiente = null;
        nuevaRonda();
        return true;
    }

    if (avancePendiente === "FIN_CAMPANA") {
        avancePendiente = null;
        setTimeout(() => {
            mostrarMenu(`Modo Libre completado. Puntaje final: ${stats.puntos}`);
        }, 400);
        return true;
    }

    return false;
}

function actualizarMaxPuntajeNivel(puntajeLanzamiento) {
    if (puntajeLanzamiento > stats.maxNivel) {
        stats.maxNivel = puntajeLanzamiento;
    }
}

function actualizarObjetivoUI() {
    document.getElementById('obj-nombre').innerText = objetivoActual ? objetivoActual.nombre : '-';
    if (modoJuego === "DAILY" && objetivoActual) {
        const posDiana = obtenerPosicionDiana();
        const distOrigen = p_tiro.distanceTo(posDiana);
        document.getElementById('obj-regla').innerText = [
            objetivoActual.regla,
            `Posicion diana: X ${posDiana.x.toFixed(1)} | Z ${posDiana.z.toFixed(1)}`,
            `Dist. origen -> diana: ${distOrigen.toFixed(1)}m`,
            `Intentos restantes: ${intentosDailyRestantes()}/${DAILY_INTENTOS_MAX}`
        ].join('\n');
    } else {
        document.getElementById('obj-regla').innerText = objetivoActual ? objetivoActual.regla : '-';
    }
    document.getElementById('resultado-panel').style.display = 'none';
}

// ==========================================
// RANKING DAILY (LOCAL STORAGE)
// ==========================================
function rankingKey() {
    return `lineup_daily_${dailyKey || obtenerClaveFechaHoy()}`;
}

function rankingKeyByDate(fecha) {
    return `lineup_daily_${fecha}`;
}

function obtenerClaveFechaHoy() {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = String(hoy.getMonth() + 1).padStart(2, '0');
    const d = String(hoy.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function sincronizarClaveDailyHoy() {
    const keyHoy = obtenerClaveFechaHoy();
    if (dailyKey === keyHoy) return;

    dailyKey = keyHoy;
    dailySeed = Number(keyHoy.replace(/-/g, ''));
}

function limpiarRankingsDailyAntiguos(maxDias) {
    const dias = Math.max(1, Number(maxDias) || 14);
    const ahora = new Date();
    const corte = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - dias);

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('lineup_daily_')) continue;

        const m = key.match(/^lineup_daily_(\d{4}-\d{2}-\d{2})$/);
        if (!m) continue;

        const fecha = new Date(`${m[1]}T00:00:00`);
        if (!isNaN(fecha.getTime()) && fecha < corte) {
            localStorage.removeItem(key);
            i--;
        }
    }
}

function progresoDailyKey() {
    const jugador = sanitizarNombre(nombreJugador || 'ANON').toUpperCase();
    return `lineup_daily_progress_${dailyKey || 'sin_fecha'}_${jugador}`;
}

function leerProgresoDaily() {
    if (!dailyKey) return { intentosUsados: 0, bloqueado: false, actualizado: '' };
    try {
        const raw = localStorage.getItem(progresoDailyKey());
        if (!raw) return { intentosUsados: 0, bloqueado: false, actualizado: '' };
        const p = JSON.parse(raw) || {};
        const intentosUsados = Math.max(0, Math.min(DAILY_INTENTOS_MAX, Number(p.intentosUsados) || 0));
        const bloqueado = !!p.bloqueado || intentosUsados >= DAILY_INTENTOS_MAX;
        return {
            intentosUsados,
            bloqueado,
            actualizado: String(p.actualizado || ''),
        };
    } catch (e) {
        return { intentosUsados: 0, bloqueado: false, actualizado: '' };
    }
}

function guardarProgresoDaily() {
    if (modoJuego !== "DAILY" || !dailyKey) return;
    const intentosUsados = Math.max(0, Math.min(DAILY_INTENTOS_MAX, stats.lanzamientos || 0));
    const payload = {
        intentosUsados,
        bloqueado: intentosUsados >= DAILY_INTENTOS_MAX,
        actualizado: new Date().toISOString(),
    };
    localStorage.setItem(progresoDailyKey(), JSON.stringify(payload));
}

function leerRankingDaily() {
    try {
        const raw = localStorage.getItem(rankingKey());
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function guardarEnRankingDaily(puntaje, estrellas) {
    sincronizarClaveDailyHoy();

    const arr = leerRankingDaily();
    arr.push({
        name: nombreJugador || "ANON",
        score: puntaje,
        stars: Math.max(0, Math.min(3, Number(estrellas) || 0)),
        launches: stats.lanzamientos,
        at: new Date().toLocaleTimeString(),
    });

    arr.sort((a, b) => b.score - a.score);
    const top = arr.slice(0, 10);
    localStorage.setItem(rankingKey(), JSON.stringify(top));
    actualizarRankingMenuDaily();
}

function actualizarRankingMenuDaily() {
    const box = document.getElementById('ranking-daily-menu');
    if (!box) return;

    sincronizarClaveDailyHoy();
    limpiarRankingsDailyAntiguos(21);
    const keyFecha = dailyKey;
    let arr = [];
    try {
        const raw = localStorage.getItem(rankingKeyByDate(keyFecha));
        const parsed = raw ? JSON.parse(raw) : [];
        arr = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        arr = [];
    }

    box.style.display = 'block';
    if (arr.length === 0) {
        box.innerHTML = `<div class="rank-title">RANKING DAILY ${keyFecha}</div><div class="rank-row"><span>Sin registros</span><span>-</span></div>`;
        return;
    }

    let html = `<div class="rank-title">RANKING DAILY ${keyFecha}</div>`;
    for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        const starsN = Math.max(0, Math.min(3, Number(e.stars) || 0));
        const tag = "★".repeat(starsN) + "☆".repeat(3 - starsN);
        const nombre = sanitizarNombre(e.name || 'ANON');
        html += `<div class="rank-row"><span>#${i + 1} <span class="rank-player">${nombre}</span> ${tag} ${e.at}</span><span>${e.score}</span></div>`;
    }

    box.innerHTML = html;
}

// ==========================================
// VUELTA A APUNTADO TRAS DETONACION
// ==========================================
function volverAPosicionTiro() {
    cameraControls.enabled = false;

    new TWEEN.Tween(camera.position)
        .to({ x: p_tiro.x, y: p_tiro.y, z: p_tiro.z }, 1400)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onUpdate(() => {
            TMP_LOOK_MAT.lookAt(camera.position, CAM_LOOK_TIRO, CAM_UP);
            camera.quaternion.setFromRotationMatrix(TMP_LOOK_MAT);
        })
        .onComplete(() => {
            if (ejecutarAvancePendiente()) return;

            estadoJuego = "APUNTANDO";
            camera.rotation.order = 'YXZ';
            yaw   = camera.rotation.y;
            pitch = camera.rotation.x;

            if (solicitudCambioNivel) {
                setOverlay(false);
                mostrarCrosshair(false);
                const txt = solicitudCambioNivel.haySiguiente ? "Elige si quieres cambiar de nivel" : "Elige si quieres finalizar Modo Libre";
                setUI("DIANA ACERTADA", txt);
                mostrarBoton('btn-lanzar', false);
                mostrarBoton('btn-nuevo-mapa', false);
                mostrarModalCambioNivel(solicitudCambioNivel.estrellas || 1, solicitudCambioNivel.haySiguiente);
                return;
            }

            if (apuntandoFPS) {
                setOverlay(false);
                mostrarCrosshair(true);
                setUI("EN POSICION", textoEnPosicionHUD());
            } else {
                setOverlay(true);
                setUI("PULSA ESPACIO PARA APUNTAR", textoApuntadoHUD());
            }
            mostrarBoton('btn-lanzar', true);
            mostrarBoton('btn-nuevo-mapa', modoJuego !== "DAILY");
        })
        .start();
}

// ==========================================
// NUEVA RONDA
// ==========================================
function nuevaRonda() {
    solicitudCambioNivel = null;
    ocultarModalCambioNivel();
    cancelarCargaLanzamiento();

    // Al generar un mapa nuevo, la mejor puntuacion de nivel debe reiniciarse.
    stats.maxNivel = 0;

    if (!modoJuego) {
        mostrarMenu();
        return;
    }

    salirPointerLock();
    if (typeof limpiarTrail === "function") limpiarTrail();

    if (timer_det) { clearTimeout(timer_det); timer_det = null; }

    if (rondaRoot && rondaRoot.parent) rondaRoot.parent.remove(rondaRoot);
    rondaRoot = null;

    if (granada_obj && granada_obj.parent) granada_obj.parent.remove(granada_obj);
    if (humo_obj && humo_obj.parent) humo_obj.parent.remove(humo_obj);

    granada_obj = null;
    humo_obj    = null;
    humo_activo = false;

    colisionables = [];
    estadoJuego   = "GENERANDO";

    mostrarBoton('btn-lanzar', false);
    mostrarBoton('btn-nuevo-mapa', false);
    mostrarCrosshair(false);
    setOverlay(false);

    cameraControls.enabled = false;
    camera.position.set(0, 120, 80);
    cameraControls.target.set(0, 5, 0);

    loadScene();
}

// ==========================================
// VISTA CENITAL (V)
// ==========================================
function toggleVistaCenital() {
    if (!enVistaCenital) {
        retornoCenitalAnimando = false;
        camera.rotation.order = 'YXZ';
        vistaAntesCenital = {
            estabaApuntandoFPS: !!apuntandoFPS,
            yaw: apuntandoFPS ? yaw : camera.rotation.y,
            pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, apuntandoFPS ? pitch : camera.rotation.x)),
        };

        enVistaCenital = true;
        salirPointerLock();
        cameraControls.enabled = true;
        cameraControls.maxDistance = 220;
        cameraControls.target.set(0, 0, 10);

        new TWEEN.Tween(camera.position)
            .to({ x: 0, y: 160, z: 60 }, 900)
            .easing(TWEEN.Easing.Cubic.Out)
            .start();

        setOverlay(false);
        setUI("VISTA CENITAL", "V = Volver al punto de tiro");
    } else {
        enVistaCenital = false;
        cameraControls.enabled = false;
        retornoCenitalAnimando = true;
        const volverEnModoApuntado = !!(vistaAntesCenital && vistaAntesCenital.estabaApuntandoFPS);
        const yawObjetivo = vistaAntesCenital ? vistaAntesCenital.yaw : camera.rotation.y;
        const pitchObjetivo = vistaAntesCenital
            ? vistaAntesCenital.pitch
            : Math.max(PITCH_MIN, Math.min(PITCH_MAX, camera.rotation.x));
        const posInicio = camera.position.clone();
        const posObjetivo = p_tiro.clone();
        const yawInicio = camera.rotation.y;
        const pitchInicio = camera.rotation.x;
        const transicion = { t: 0 };

        // Intentar recuperar pointer lock al salir de cenital si venias en modo apuntado real.
        if (volverEnModoApuntado) entrarModoApuntado();

        new TWEEN.Tween(transicion)
            .to({ t: 1 }, 900)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(() => {
                camera.position.lerpVectors(posInicio, posObjetivo, transicion.t);
                camera.rotation.order = 'YXZ';
                camera.rotation.y = lerpAngulo(yawInicio, yawObjetivo, transicion.t);
                camera.rotation.x = pitchInicio + (pitchObjetivo - pitchInicio) * transicion.t;
                camera.rotation.z = 0;
            })
            .onComplete(() => {
                retornoCenitalAnimando = false;
                camera.rotation.order = 'YXZ';
                yaw = yawObjetivo;
                pitch = pitchObjetivo;
                vistaAntesCenital = null;
                camera.rotation.y = yaw;
                camera.rotation.x = pitch;
                camera.rotation.z = 0;

                const lockActivo = (document.pointerLockElement === renderer.domElement);
                if (volverEnModoApuntado && lockActivo) {
                    // Si antes de cenital estabas moviendo camara, vuelve directo solo si lock esta activo.
                    setOverlay(false);
                    mostrarCrosshair(true);
                    setUI("EN POSICION", textoEnPosicionHUD());
                } else {
                    apuntandoFPS = false;
                    setOverlay(true);
                    mostrarCrosshair(false);
                    setUI("PULSA ESPACIO PARA APUNTAR", textoApuntadoHUD());
                }
            })
            .start();
    }
}

// ==========================================
// UTILIDADES
// ==========================================
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function lerpAngulo(a, b, t) {
    let delta = b - a;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return a + delta * clamp01(t);
}

function obtenerPosicionDiana() {
    if (diana_obj && diana_obj.position) return diana_obj.position.clone();
    return new THREE.Vector3(0, 1, 0);
}

function sanitizarNombre(raw) {
    return String(raw || '')
        .replace(/\s+/g, ' ')
        .replace(/[^a-zA-Z0-9 _.-]/g, '')
        .trim()
        .slice(0, 18);
}

function asegurarNombreJugador() {
    const input = document.getElementById('input-player-name');
    const limpio = sanitizarNombre(input ? input.value : '');
    if (input) input.value = limpio;

    if (!limpio) {
        setTextoMenu('Escribe tu nombre para jugar y salir en el ranking');
        if (input) input.focus();
        return false;
    }

    nombreJugador = limpio;
    localStorage.setItem('lineup_player_name', nombreJugador);
    return true;
}

function scoreRebotesSinLimite(rebotes, ideal, factorPenalizacion) {
    const f = factorPenalizacion || 0.35;
    const diff = Math.abs(rebotes - ideal);
    return clamp01(1 / (1 + diff * f));
}

function evaluarImpactoDiana(posicionDetonacion) {
    const diana = obtenerPosicionDiana();
    const dist = Math.hypot(posicionDetonacion.x - diana.x, posicionDetonacion.z - diana.z);

    const RADIO_BULLSEYE = 1.2;
    const RADIO_CENTRO = 3.0;
    const RADIO_BORDE = 5.8;

    let zona = "FUERA";
    let precision = 0;

    if (dist <= RADIO_BULLSEYE) {
        zona = "BULLSEYE";
        precision = 1;
    } else if (dist <= RADIO_CENTRO) {
        zona = "CENTRO";
        const t = (dist - RADIO_BULLSEYE) / (RADIO_CENTRO - RADIO_BULLSEYE);
        precision = 0.92 - t * 0.22;
    } else if (dist <= RADIO_BORDE) {
        zona = "BORDE";
        const t = (dist - RADIO_CENTRO) / (RADIO_BORDE - RADIO_CENTRO);
        precision = 0.65 - t * 0.35;
    } else {
        precision = clamp01(1 - (dist - RADIO_BORDE) / 20) * 0.25;
    }

    return {
        dist,
        zona,
        acierto: dist <= RADIO_BORDE,
        precision: clamp01(precision),
    };
}

function salirPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    apuntandoFPS = false;
    cancelarCargaLanzamiento();
}

function setUI(titulo, instruccion, color) {
    document.getElementById('titulo-estado').innerText = titulo;
    document.getElementById('titulo-estado').style.color = color || '#ffffff';
    document.getElementById('instrucciones').innerText = instruccion;
}

function mostrarBoton(id, visible) {
    document.getElementById(id).style.display = visible ? 'inline-block' : 'none';
}

function mostrarCrosshair(visible) {
    document.getElementById('crosshair').style.display = visible ? 'block' : 'none';
}

function setOverlay(visible) {
    document.getElementById('aim-overlay').style.display = visible ? 'flex' : 'none';
}

function actualizarHUD() {
    document.getElementById('stat-ronda').innerText  = stats.ronda;
    document.getElementById('stat-lanzam').innerText = stats.lanzamientos;
    document.getElementById('stat-best-nivel').innerText = stats.maxNivel || 0;
    document.getElementById('stat-best-total').innerText = stats.mejorPuntajeSesion || 0;
}

function registrarLanzamiento(rebotes) {
    stats.lanzamientos++;
    if (modoJuego === "DAILY") guardarProgresoDaily();
    actualizarHUD();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
