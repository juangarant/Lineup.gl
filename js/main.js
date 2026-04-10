// ==========================================
// js/main.js - NUCLEO DEL SIMULADOR
// ==========================================

// ---- GLOBALS ----
var renderer, scene, camera, cameraControls;
var colisionables = [];
var diana_obj     = null;
var estadoJuego   = "MENU";
var p_tiro        = new THREE.Vector3(0, 6.6, 80);

// Estadisticas de sesion
var stats = crearStatsBase();

// Estado de partida
var modoJuego = null; // CAMPANA | DAILY
var enVistaCenital = false;
var objetivoActual = null;
var avancePendiente = null;
var dailySeed = 0;
var dailyKey = "";
var mapSeedActual = 0;
var nombreJugador = "";
var dailyProgresoActual = null;

const TOTAL_NIVELES_CAMPANA = 5;
const DAILY_INTENTOS_MAX = 3;

function crearStatsBase() {
    return {
        ronda: 0,
        lanzamientos: 0,
        mejorRebotes: Infinity,
        puntos: 0,
        maxNivel: 0,
        maxPorNivel: {},
    };
}

// ---- APUNTADO FPS (Pointer Lock) ----
var apuntandoFPS = false;
var yaw          = Math.PI;
var pitch        = -0.08;
const PITCH_MIN  = -Math.PI / 2 + 0.05;
const PITCH_MAX  =  Math.PI / 4;
const SENS       = 0.0018;

// ---- SEGUIMIENTO DE CAMARA ----
var camaraObjetivo = new THREE.Vector3();
var camaraTarget   = new THREE.Vector3();
const CAM_OFFSET   = new THREE.Vector3(0, 4, 8);
const CAM_LERP     = 0.06;

// ---- CONFIG OBJETIVOS CAMPANA ----
const OBJETIVOS_CAMPANA = [
    {
        id: "camp1",
        nombre: "Nivel 1 - Control Del Site",
        regla: "Detona dentro del site. Los rebotes suman puntuacion sin limite maximo.",
        estrellas: [750, 1100, 1500],
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
        estrellas: [900, 1300, 1750],
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
        estrellas: [1050, 1450, 1950],
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
        estrellas: [1200, 1650, 2200],
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
        estrellas: [1400, 1900, 2500],
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
        estrellas: [1000, 1500, 2100],
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
        estrellas: [1050, 1550, 2150],
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
        estrellas: [950, 1450, 2050],
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
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    document.getElementById('btn-lanzar').addEventListener('click', intentarLanzamiento);
    document.getElementById('btn-nuevo-mapa').addEventListener('click', nuevaRonda);
    document.getElementById('aim-overlay').addEventListener('click', () => {
        if (estadoJuego === "APUNTANDO" && !apuntandoFPS) entrarModoApuntado();
    });

    document.getElementById('btn-campana').addEventListener('click', iniciarCampana);
    document.getElementById('btn-daily').addEventListener('click', iniciarDaily);

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

    modoJuego = "CAMPANA";
    stats = crearStatsBase();
    stats.ronda = 1;
    avancePendiente = null;
    objetivoActual = OBJETIVOS_CAMPANA[0];
    actualizarMaxNivelActual();
    setTextoMenu("Campana iniciada. Supera 5 niveles incrementales.");
    ocultarMenu();
    nuevaRonda();
}

function iniciarDaily() {
    if (!asegurarNombreJugador()) return;

    sincronizarClaveDailyHoy();

    dailyProgresoActual = leerProgresoDaily();
    if (dailyProgresoActual.bloqueado || dailyProgresoActual.intentosUsados >= DAILY_INTENTOS_MAX) {
        setTextoMenu(`Daily ${dailyKey} ya completado (${DAILY_INTENTOS_MAX}/${DAILY_INTENTOS_MAX} intentos usados). Vuelve manana.`);
        actualizarRankingMenuDaily();
        return;
    }

    modoJuego = "DAILY";
    stats = crearStatsBase();
    stats.ronda = 1;
    stats.lanzamientos = dailyProgresoActual.intentosUsados;
    avancePendiente = null;

    objetivoActual = OBJETIVOS_DAILY[dailySeed % OBJETIVOS_DAILY.length];
    actualizarMaxNivelActual();

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
    if (estadoJuego !== "APUNTANDO" || !apuntandoFPS) return;
    if (!puedeLanzarEnModoActual()) return;
    lanzarGranada();
}

function ocultarMenu() {
    document.getElementById('menu-principal').style.display = 'none';
    mostrarHUDJuego(true);
}

function mostrarMenu(mensaje) {
    estadoJuego = "MENU";
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
}

// ==========================================
// LOAD SCENE
// ==========================================
function loadScene() {
    crearSuelo();

    if (typeof generarMapaAleatorio === "function") {
        if (modoJuego === "DAILY") {
            mapSeedActual = dailySeed;
            stats.ronda = 1;
            generarMapaAleatorio(mapSeedActual, { modo: "DAILY", dianaSeed: dailySeed });
        } else {
            mapSeedActual = Math.random() * 9999;
            stats.ronda = OBJETIVOS_CAMPANA.indexOf(objetivoActual) + 1;
            generarMapaAleatorio(mapSeedActual, { modo: "CAMPANA" });
        }

        actualizarHUD();
        actualizarObjetivoUI();
    } else {
        console.error("generador.js no cargado");
    }

    setTimeout(iniciarCinematica, 1200);
}

function crearSuelo() {
    const suelo = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshLambertMaterial({ color: 0x6e6e60 })
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.receiveShadow = true;
    scene.add(suelo);

    const site = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshLambertMaterial({ color: 0x857a6e })
    );
    site.rotation.x = -Math.PI / 2;
    site.position.y = 0.01;
    site.receiveShadow = true;
    scene.add(site);
}

// ==========================================
// LOOP
// ==========================================
function render() {
    requestAnimationFrame(render);
    TWEEN.update();

    if (cameraControls.enabled) cameraControls.update();

    if (apuntandoFPS && estadoJuego === "APUNTANDO") {
        camera.position.copy(p_tiro);
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
    }

    if (estadoJuego === "VOLANDO" || estadoJuego === "DETONANDO") {
        actualizarCamaraSeguimiento();
    }

    switch (estadoJuego) {
        case "VOLANDO":   actualizarFisicasGranada(); break;
        case "DETONANDO": expandirHumo();             break;
    }

    renderer.render(scene, camera);
}

// ==========================================
// CAMARA SEGUIMIENTO
// ==========================================
function actualizarCamaraSeguimiento() {
    if (!granada_obj || (!granada_obj.visible && estadoJuego === "VOLANDO")) return;

    const objetivo = (estadoJuego === "DETONANDO" && humo_obj)
        ? humo_obj.position
        : granada_obj.position;

    let dirVel = new THREE.Vector3();
    if (typeof vel !== "undefined" && vel.length() > 0.01) {
        dirVel.copy(vel).normalize();
    } else {
        dirVel.set(0, -0.3, 1).normalize();
    }

    const offsetMundo = dirVel.clone().multiplyScalar(-CAM_OFFSET.z).add(new THREE.Vector3(0, CAM_OFFSET.y, 0));
    camaraObjetivo.copy(objetivo).add(offsetMundo);
    camaraTarget.copy(objetivo).addScaledVector(dirVel, 3);

    camera.position.lerp(camaraObjetivo, CAM_LERP);

    const lookAtMatrix = new THREE.Matrix4();
    lookAtMatrix.lookAt(camera.position, camaraTarget, new THREE.Vector3(0, 1, 0));
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
    camera.quaternion.slerp(targetQuat, CAM_LERP * 1.5);
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
    mostrarBoton('btn-lanzar', puedeLanzarEnModoActual());
    mostrarBoton('btn-nuevo-mapa', true);
    setUI("PULSA ESPACIO PARA APUNTAR", "R = Reiniciar ronda | V = Vista cenital");
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

    if (apuntandoFPS) {
        yaw   = camera.rotation.y;
        pitch = camera.rotation.x;
        setOverlay(false);
        mostrarCrosshair(true);
        setUI("EN POSICION", "Espacio = Lanzar | Esc = Soltar raton | R = Reiniciar");
    } else {
        mostrarCrosshair(false);
        if (estadoJuego === "APUNTANDO") {
            setOverlay(true);
            setUI("PULSA ESPACIO PARA APUNTAR", "R = Reiniciar ronda | V = Vista cenital");
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
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (estadoJuego === "APUNTANDO") {
                if (!apuntandoFPS) entrarModoApuntado();
                else intentarLanzamiento();
            }
            break;

        case 'KeyR':
            if (estadoJuego === "APUNTANDO" || estadoJuego === "DETONANDO") {
                salirPointerLock();
                nuevaRonda();
            }
            break;

        case 'KeyV':
            if (estadoJuego === "APUNTANDO") toggleVistaCenital();
            break;

        case 'Escape':
            if (estadoJuego !== "MENU") {
                salirPointerLock();
                mostrarMenu("Sesion en pausa. Elige un modo para continuar");
            }
            break;
    }
}

// ==========================================
// RESULTADOS Y PUNTUACION
// ==========================================
function procesarResultadoLanzamiento(data) {
    registrarLanzamiento(data.rebotes);

    const evalObj = objetivoActual.evaluar(data);
    const score = calcularPuntuacion(data, evalObj, objetivoActual);
    stats.puntos += score.total;
    actualizarMaxPuntajeNivel(score.total);
    actualizarHUD();
    actualizarObjetivoUI();
    mostrarResultado(score, evalObj, data);

    if (modoJuego === "DAILY") {
        guardarEnRankingDaily(score.total, evalObj.ok);

        if (intentosDailyRestantes() <= 0) {
            mostrarBoton('btn-lanzar', false);
            setUI("DAILY FINALIZADO", `Intentos usados: ${DAILY_INTENTOS_MAX}/${DAILY_INTENTOS_MAX}. Esc para menu`);
        }
    }

    if (modoJuego === "CAMPANA" && evalObj.ok) {
        const idx = OBJETIVOS_CAMPANA.indexOf(objetivoActual);
        if (idx < TOTAL_NIVELES_CAMPANA - 1) {
            avancePendiente = "SIGUIENTE_NIVEL";
            setUI("OBJETIVO CUMPLIDO", "Preparando siguiente nivel...");
        } else {
            avancePendiente = "FIN_CAMPANA";
            setUI("CAMPANA COMPLETADA", "Volveras al menu principal");
        }
    }
}

function calcularPuntuacion(data, evalObj, obj) {
    const precisionNorm = clamp01(evalObj.precision);
    const rebotesNorm = clamp01(evalObj.reboteScore);
    const baseObjetivo = evalObj.ok ? 780 : 140;
    const precision = Math.round(Math.pow(precisionNorm, 1.1) * 560);
    const rebotes = Math.round(rebotesNorm * 320);
    const tiempo = Math.round(clamp01(1 - data.vueloMs / 8500) * 220);
    const dificultad = Math.round((typeof dificultad_calculada === "number" ? dificultad_calculada : 5) * 52);

    const distDiana = data.posicion.distanceTo(obtenerPosicionDiana());
    const bonusCentro = distDiana <= 3.2 ? 200 : (distDiana <= 6 ? 110 : 0);
    const bonusPerfecto = (evalObj.ok && precisionNorm >= 0.9 && data.rebotes >= 1) ? 140 : 0;
    const bonusRitmo = (evalObj.ok && data.vueloMs >= 1200 && data.vueloMs <= 5200) ? 70 : 0;

    let total = baseObjetivo + precision + rebotes + tiempo + dificultad + bonusCentro + bonusPerfecto + bonusRitmo;
    if (!evalObj.ok) total = Math.round(total * 0.52);

    const estrellas = calcularEstrellas(total, obj.estrellas, evalObj.ok, data.posicion);
    return {
        total,
        estrellas,
        desglose: { baseObjetivo, precision, rebotes, tiempo, dificultad, bonusCentro, bonusPerfecto, bonusRitmo },
    };
}

function calcularEstrellas(total, umbrales, objetivoCumplido, posicionDetonacion) {
    // Prioridad: sistema de estrellas por distancia real a la diana.
    // Diana centrada en (0, 0), radio visual ~5 en plano XZ.
    if (posicionDetonacion) {
        const pDiana = obtenerPosicionDiana();
        const distDiana = Math.hypot(posicionDetonacion.x - pDiana.x, posicionDetonacion.z - pDiana.z);

        // 3*: centro o muy cerca del centro.
        if (distDiana <= 4.8) return 3;
        // 2*: toca borde o cae justo alrededor de la diana.
        if (distDiana <= 6.2) return 2;
        // 1*: cae cerca de la diana.
        if (distDiana <= 11.0) return 1;
    }

    let s = 0;
    if (total >= umbrales[0]) s++;
    if (total >= umbrales[1]) s++;
    if (total >= umbrales[2]) s++;

    // Si cumples el objetivo de la ronda, evita resultados demasiado frustrantes.
    if (objetivoCumplido && total >= umbrales[0]) {
        s = Math.max(2, s);
    }

    return s;
}

function mostrarResultado(score, evalObj, data) {
    const panel = document.getElementById('resultado-panel');
    panel.style.display = 'block';

    const distDiana = (data && data.posicion)
        ? data.posicion.distanceTo(obtenerPosicionDiana()).toFixed(1)
        : "-";

    document.getElementById('res-puntaje').innerText = `${score.total} pts`;
    document.getElementById('res-estrellas').innerText = "★".repeat(score.estrellas) + "☆".repeat(3 - score.estrellas);
    document.getElementById('res-detalle').innerText =
        `${evalObj.detalle} | Dist:${distDiana}m | B:${score.desglose.baseObjetivo} P:${score.desglose.precision} R:${score.desglose.rebotes} T:${score.desglose.tiempo} X:${score.desglose.bonusCentro + score.desglose.bonusPerfecto + score.desglose.bonusRitmo}`;
}

function claveNivelActual() {
    if (!objetivoActual || !objetivoActual.id) return "sin_objetivo";
    if (modoJuego === "DAILY") return `DAILY_${dailyKey || "sin_fecha"}_${objetivoActual.id}`;
    if (modoJuego === "CAMPANA") return `CAMPANA_${objetivoActual.id}`;
    return objetivoActual.id;
}

function actualizarMaxNivelActual() {
    const key = claveNivelActual();
    stats.maxNivel = stats.maxPorNivel[key] || 0;
}

function actualizarMaxPuntajeNivel(puntajeLanzamiento) {
    const key = claveNivelActual();
    const actual = stats.maxPorNivel[key] || 0;
    if (puntajeLanzamiento > actual) {
        stats.maxPorNivel[key] = puntajeLanzamiento;
        stats.maxNivel = puntajeLanzamiento;
    } else {
        stats.maxNivel = actual;
    }
}

function actualizarObjetivoUI() {
    document.getElementById('obj-nombre').innerText = objetivoActual ? objetivoActual.nombre : '-';
    const extraDaily = modoJuego === "DAILY"
        ? ` | Intentos restantes: ${intentosDailyRestantes()}/${DAILY_INTENTOS_MAX}`
        : "";
    document.getElementById('obj-regla').innerText = (objetivoActual ? objetivoActual.regla : '-') + extraDaily;
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
    dailyProgresoActual = payload;
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

function guardarEnRankingDaily(puntaje, objetivoCumplido) {
    sincronizarClaveDailyHoy();

    const arr = leerRankingDaily();
    arr.push({
        name: nombreJugador || "ANON",
        score: puntaje,
        ok: !!objetivoCumplido,
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
        const tag = e.ok ? "OK" : "FAIL";
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
            const m = new THREE.Matrix4().lookAt(camera.position, new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 1, 0));
            camera.quaternion.setFromRotationMatrix(m);
        })
        .onComplete(() => {
            if (avancePendiente === "SIGUIENTE_NIVEL") {
                const idx = OBJETIVOS_CAMPANA.indexOf(objetivoActual);
                objetivoActual = OBJETIVOS_CAMPANA[idx + 1];
                actualizarMaxNivelActual();
                avancePendiente = null;
                nuevaRonda();
                return;
            }

            if (avancePendiente === "FIN_CAMPANA") {
                avancePendiente = null;
                setTimeout(() => {
                    mostrarMenu(`Campana completada. Puntaje final: ${stats.puntos}`);
                }, 700);
                return;
            }

            estadoJuego = "APUNTANDO";
            camera.rotation.order = 'YXZ';
            yaw   = camera.rotation.y;
            pitch = camera.rotation.x;

            if (apuntandoFPS) {
                setOverlay(false);
                mostrarCrosshair(true);
                setUI("EN POSICION", "Espacio = Lanzar | Esc = Soltar raton | R = Reiniciar");
            } else {
                setOverlay(true);
                setUI("PULSA ESPACIO PARA APUNTAR", "R = Reiniciar ronda | V = Vista cenital");
            }
            mostrarBoton('btn-lanzar', true);
            mostrarBoton('btn-nuevo-mapa', true);
        })
        .start();
}

// ==========================================
// NUEVA RONDA
// ==========================================
function nuevaRonda() {
    if (!modoJuego) {
        mostrarMenu();
        return;
    }

    salirPointerLock();
    if (typeof limpiarTrail === "function") limpiarTrail();

    if (timer_det) { clearTimeout(timer_det); timer_det = null; }

    const basura = [];
    scene.traverse(obj => { if (obj.isMesh || obj.isGroup) basura.push(obj); });
    basura.forEach(obj => scene.remove(obj));

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
        salirPointerLock();
        enVistaCenital = true;
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

        new TWEEN.Tween(camera.position)
            .to({ x: p_tiro.x, y: p_tiro.y, z: p_tiro.z }, 900)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onComplete(() => {
                camera.rotation.order = 'YXZ';
                yaw   = camera.rotation.y;
                pitch = camera.rotation.x;
                setOverlay(true);
                setUI("PULSA ESPACIO PARA APUNTAR", "R = Reiniciar ronda | V = Vista cenital");
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

function salirPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    apuntandoFPS = false;
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
    document.getElementById('stat-mejor').innerText  = stats.mejorRebotes === Infinity ? '-' : stats.mejorRebotes;
    document.getElementById('stat-puntos').innerText = stats.puntos;
    document.getElementById('stat-max-nivel').innerText = stats.maxNivel || 0;
}

function registrarLanzamiento(rebotes) {
    stats.lanzamientos++;
    if (rebotes < stats.mejorRebotes) stats.mejorRebotes = rebotes;
    if (modoJuego === "DAILY") guardarProgresoDaily();
    actualizarHUD();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
