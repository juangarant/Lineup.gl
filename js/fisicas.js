// ==========================================
// js/fisicas.js - FÍSICA ESTILO CS2
// ==========================================

// ---- OBJETO Y ESTADO ----
var granada_obj      = null;
var vel              = new THREE.Vector3(); // vector velocidad
var vel_angular      = new THREE.Vector3(); // rotación visual
var esfera_col       = new THREE.Sphere();
var num_rebotes      = 0;
var timer_det        = null;      // timeout de seguridad
var t_lanzamiento_ms = 0;
var t_ultimo_rebote_ms = 0;
var trail_puntos     = [];        // puntos de trayectoria
var trail_meshes     = [];        // marcadores visuales de trayectoria
var granada_modelo_base  = null;
var granada_modelo_carga = null;

// ---- CONSTANTES FÍSICAS (calibradas a CS2) ----
const RADIO          = 0.5;
const GRAVEDAD       = 0.016;    // Source 2 gravity feel por frame
const DRAG_AIRE      = 0.9975;   // resistencia del aire (casi imperceptible)
const VEL_LANZAM    = 1.15;     // modulo base usado como referencia en simuladores externos
const VEL_LANZAM_MIN = 0.72;    // lanzamiento flojo
const VEL_LANZAM_MAX = 1.58;    // lanzamiento fuerte
const IMPULSO_Y      = 0.0;      // sin impulso vertical extra para respetar mejor el apuntado

// Coeficiente de Restitución (COR) — cuánta energía conserva el componente normal
const COR_SUELO      = 0.55;    // mas energia tras rebote en suelo
const COR_MURO       = 0.68;    // mas energia tras rebote en muros

// Fricción tangencial — cuánta velocidad de deslizamiento se conserva
const FRIC_SUELO     = 0.90;    // menor perdida tangencial en suelo
const FRIC_MURO      = 0.95;    // menor perdida tangencial en muros

// Umbral de detención (por componente)
const VEL_STOP       = 0.04;
const MIN_INTERVALO_REBOTE_MS = 90;
const MIN_VEL_IMPACTO_REBOTE  = 0.18;

// ---- MATERIAL TRAIL ----
const MAT_TRAIL = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
const GEO_TRAIL = new THREE.SphereGeometry(0.08, 4, 4);

// Temporales para evitar asignaciones por frame
const TMP_BOX_COL = new THREE.Box3();
const TMP_P_CERCANO = new THREE.Vector3();
const TMP_NORMAL = new THREE.Vector3();
const TMP_VN = new THREE.Vector3();
const TMP_VT = new THREE.Vector3();


function crearGranadaFallback() {
    const geo = new THREE.SphereGeometry(RADIO, 16, 16);
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a5a2a });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
}

function normalizarEscalaModelo(modeloRaiz) {
    const box = new THREE.Box3().setFromObject(modeloRaiz);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0.0001) {
        // Escala visual mas generosa para que sea claramente visible en juego.
        const objetivo = RADIO * 3.6;
        const factor = objetivo / maxDim;
        modeloRaiz.scale.setScalar(factor);
    }
}

function encapsularModeloEnPivot(modeloRaiz) {
    const pivot = new THREE.Group();
    pivot.name = "granada_pivot";

    // El modelo real cuelga del pivot; solo moveremos el pivot en fisicas.
    pivot.add(modeloRaiz);

    const box = new THREE.Box3().setFromObject(modeloRaiz);
    const center = box.getCenter(new THREE.Vector3());
    modeloRaiz.position.sub(center);

    return pivot;
}

function hornearMallasGLTF(raizOriginal) {
    const grupo = new THREE.Group();
    raizOriginal.updateWorldMatrix(true, true);

    raizOriginal.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;

        const g = obj.geometry.clone();
        g.applyMatrix4(obj.matrixWorld);

        const m = Array.isArray(obj.material)
            ? obj.material.map((mat) => mat.clone())
            : (obj.material ? obj.material.clone() : new THREE.MeshLambertMaterial({ color: 0x6b7d58 }));

        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        grupo.add(mesh);
    });

    return grupo;
}

function cargarModeloGranada() {
    if (granada_modelo_carga) return granada_modelo_carga;

    granada_modelo_carga = new Promise((resolve) => {
        if (typeof THREE.GLTFLoader !== "function") {
            console.warn("GLTFLoader no disponible, usando fallback");
            granada_modelo_base = crearGranadaFallback();
            if (typeof setUI === "function") setUI("MODO FALLBACK", "GLTFLoader no disponible");
            resolve(granada_modelo_base);
            return;
        }

        const loader = new THREE.GLTFLoader();
        const rutas = [
            "models/objetos/smokegrenade.glb",
            "models/objetos/smokegranade.glb",
        ];

        const intentar = (idx) => {
            if (idx >= rutas.length) {
                console.warn("No se pudo cargar modelo GLB, usando fallback");
                granada_modelo_base = crearGranadaFallback();
                if (typeof setUI === "function") setUI("MODO FALLBACK", "No se pudo cargar smokegrenade.glb");
                resolve(granada_modelo_base);
                return;
            }

            loader.load(
                rutas[idx],
                (gltf) => {
                    const raiz = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                    if (!raiz) {
                        intentar(idx + 1);
                        return;
                    }

                    const modeloHorneado = hornearMallasGLTF(raiz);
                    if (modeloHorneado.children.length === 0) {
                        console.warn("GLB sin mallas renderizables, usando fallback");
                        granada_modelo_base = crearGranadaFallback();
                        resolve(granada_modelo_base);
                        return;
                    }

                    modeloHorneado.traverse((obj) => {
                        if (!obj.isMesh || !obj.material) return;
                        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                        mats.forEach((m) => {
                            m.transparent = false;
                            m.opacity = 1;
                            m.side = THREE.DoubleSide;
                            m.depthWrite = true;
                            m.needsUpdate = true;
                        });
                    });

                    normalizarEscalaModelo(modeloHorneado);
                    granada_modelo_base = encapsularModeloEnPivot(modeloHorneado);
                    if (typeof setUI === "function") setUI("GLB ACTIVO", "Modelo de granada cargado");
                    resolve(granada_modelo_base);
                },
                undefined,
                () => intentar(idx + 1)
            );
        };

        intentar(0);
    });

    return granada_modelo_carga;
}

function crearInstanciaGranada() {
    if (!granada_modelo_base) return crearGranadaFallback();
    return granada_modelo_base.clone(true);
}

// Precarga del modelo para que el primer lanzamiento sea inmediato en la mayoria de casos.
cargarModeloGranada();


// ==========================================
// LANZAR GRANADA
// ==========================================
function lanzarGranada(potenciaNorm) {
    if (estadoJuego !== "APUNTANDO") return;

    if (!granada_modelo_base) {
        cargarModeloGranada();
        if (typeof setUI === "function") {
            setUI("CARGANDO MODELO", "Pulsa ESPACIO de nuevo en cuanto termine");
        }
        return;
    }

    // Limpiar tiempos anteriores
    if (timer_det) clearTimeout(timer_det);
    limpiarTrail();
    num_rebotes = 0;
    t_lanzamiento_ms = Date.now();
    t_ultimo_rebote_ms = 0;

    // Recrear siempre la instancia para evitar offsets o estados residuales.
    if (granada_obj) scene.remove(granada_obj);
    granada_obj = crearInstanciaGranada();
    scene.add(granada_obj);

    granada_obj.position.copy(camera.position);
    granada_obj.visible = true;

    // Dirección de la cámara → velocidad inicial
    let dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.normalize();

    // Evita arrancar dentro del plano cercano de la cámara.
    granada_obj.position.addScaledVector(dir, 1.6);
    granada_obj.position.y += 0.2;

    const potencia = Math.max(0, Math.min(1, Number(potenciaNorm) || 0.5));
    const velLanzamiento = VEL_LANZAM_MIN + (VEL_LANZAM_MAX - VEL_LANZAM_MIN) * potencia;
    vel.copy(dir).multiplyScalar(velLanzamiento);
    if (IMPULSO_Y !== 0) vel.y += IMPULSO_Y;

    // Velocidad angular inicial (gira en el sentido del lanzamiento)
    vel_angular.set(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.1,
        vel.length() * 0.25
    );

    estadoJuego = "VOLANDO";
    document.getElementById('titulo-estado').innerText = "PROYECTIL EN VUELO";
    document.getElementById('instrucciones').innerText = "";
    document.getElementById('btn-lanzar').style.display = "none";

    // Detonación de seguridad a los 8 s (igual que CS2)
    timer_det = setTimeout(() => {
        if (estadoJuego === "VOLANDO") detonar();
    }, 8000);
}


// ==========================================
// ACTUALIZAR FÍSICAS (llamado cada frame)
// ==========================================
function actualizarFisicasGranada(deltaSec) {
    if (!granada_obj || !granada_obj.visible) return;

    const dt = Math.max(0.0001, Number(deltaSec) || (1 / 60));
    const dtNorm = dt * 60;

    // 1. DRAG AÉREO
    vel.multiplyScalar(Math.pow(DRAG_AIRE, dtNorm));

    // 2. GRAVEDAD
    vel.y -= GRAVEDAD * dtNorm;

    // 3. SUB-STEPPING — evita que la granada atraviese muros (tunneling)
    //    Divide el movimiento si la velocidad supera el radio de colisión
    const speed = vel.length();
    const SUB_STEPS = Math.max(1, Math.ceil((speed * dtNorm) / RADIO));
    const usarCajasCache = (typeof cajas_cache !== "undefined")
        && Array.isArray(cajas_cache)
        && cajas_cache.length > 0
        && cajas_cache.length === colisionables.length;

    for (let sub = 0; sub < SUB_STEPS; sub++) {
        let colisionoMuro = false;

        granada_obj.position.addScaledVector(vel, dtNorm / SUB_STEPS);
        esfera_col.set(granada_obj.position, RADIO);

        // Colisión suelo
        if (granada_obj.position.y <= RADIO) {
            granada_obj.position.y = RADIO;
            rebotarContraNormal(new THREE.Vector3(0, 1, 0), COR_SUELO, FRIC_SUELO);
        }

        // Colisiones con muros
        for (let i = 0; i < colisionables.length; i++) {
            const caja = usarCajasCache ? cajas_cache[i] : TMP_BOX_COL.setFromObject(colisionables[i]);
            if (!caja.intersectsSphere(esfera_col)) continue;

            caja.clampPoint(esfera_col.center, TMP_P_CERCANO);

            TMP_NORMAL.copy(esfera_col.center).sub(TMP_P_CERCANO);
            const dist = TMP_NORMAL.length();

            if (dist < 0.0001) continue;
            TMP_NORMAL.divideScalar(dist);

            const penetracion = RADIO - dist;
            if (penetracion > 0) {
                granada_obj.position.addScaledVector(TMP_NORMAL, penetracion);
                esfera_col.set(granada_obj.position, RADIO);
            }

            rebotarContraNormal(TMP_NORMAL, COR_MURO, FRIC_MURO);
            colisionoMuro = true;
            break;
        }

        if (colisionoMuro) continue;
    }

    // 4. ROTACIÓN VISUAL
    granada_obj.rotation.x += vel_angular.x;
    granada_obj.rotation.y += vel_angular.y;
    granada_obj.rotation.z += vel_angular.z;
    vel_angular.multiplyScalar(0.97);

    // 5. TRAIL
    registrarTrail(granada_obj.position);

    // 6. DETENCIÓN
    const quieta  = vel.length() < VEL_STOP;
    const enSuelo = granada_obj.position.y <= RADIO + 0.12;
    if (quieta && enSuelo) {
        vel.set(0, 0, 0);
        detonar();
    }
}


// ==========================================
// REBOTE — SEPARACIÓN NORMAL / TANGENCIAL
// ==========================================
//
//  v_n = componente perpendicular a la superficie → se invierte y escala por COR
//  v_t = componente paralela (deslizamiento)     → se escala por fricción tangencial
//
//  Resultado: vel = -COR·v_n  +  FRIC·v_t
//
function rebotarContraNormal(normal, cor, fric) {
    const vDotN = vel.dot(normal);

    // Solo procesar si nos acercamos a la superficie
    if (vDotN >= 0) return;

    // Descomponer velocidad
    TMP_VN.copy(normal).multiplyScalar(vDotN);  // componente normal
    TMP_VT.copy(vel).sub(TMP_VN);               // componente tangencial

    // Aplicar COR y fricción tangencial
    TMP_VN.multiplyScalar(-cor);
    TMP_VT.multiplyScalar(fric);

    // Recomponer
    vel.copy(TMP_VN).add(TMP_VT);

    // Actualizar giro al rebotar (cambia eje de rotación)
    vel_angular.set(
        vel.z * 0.3,
        (Math.random() - 0.5) * 0.15,
        -vel.x * 0.3
    );

    const impacto = -vDotN;
    const ahora = Date.now();
    if (impacto >= MIN_VEL_IMPACTO_REBOTE && (ahora - t_ultimo_rebote_ms) > MIN_INTERVALO_REBOTE_MS) {
        num_rebotes++;
        t_ultimo_rebote_ms = ahora;
    }
}


// ==========================================
// TRAIL DE TRAYECTORIA
// ==========================================
function registrarTrail(pos) {
    // Un punto cada 3 frames para no saturar
    if (trail_puntos.length > 0) {
        const ultimo = trail_puntos[trail_puntos.length - 1];
        if (pos.distanceTo(ultimo) < 0.6) return;
    }

    trail_puntos.push(pos.clone());

    const dot = new THREE.Mesh(GEO_TRAIL, MAT_TRAIL);
    dot.position.copy(pos);
    scene.add(dot);
    trail_meshes.push(dot);
}

function limpiarTrail() {
    for (const m of trail_meshes) scene.remove(m);
    trail_meshes = [];
    trail_puntos = [];
}


// ==========================================
// DETONACIÓN
// ==========================================
function detonar() {
    if (estadoJuego !== "VOLANDO") return;
    if (timer_det) { clearTimeout(timer_det); timer_det = null; }

    const posDetonacion = granada_obj.position.clone();
    const vueloMs = Math.max(0, Date.now() - t_lanzamiento_ms);

    estadoJuego = "DETONANDO";
    granada_obj.visible = false;

    if (typeof procesarResultadoLanzamiento === "function") {
        procesarResultadoLanzamiento({
            posicion: posDetonacion,
            rebotes: num_rebotes,
            vueloMs,
        });
    } else if (typeof registrarLanzamiento === "function") {
        registrarLanzamiento(num_rebotes);
    }

    const txt = `${num_rebotes} rebote${num_rebotes !== 1 ? 's' : ''}`;
    if (typeof setUI === "function") {
        setUI("¡DETONACIÓN!", txt);
    } else {
        document.getElementById('titulo-estado').innerText = "¡DETONACIÓN!";
        document.getElementById('instrucciones').innerText = txt;
    }

    instanciarHumo(posDetonacion);
}


// ==========================================
// HUMO
// ==========================================
var humo_obj        = null;
var humo_activo     = false;
const ESCALA_MAX_HUMO = 12;

function instanciarHumo(posicion) {
    if (!humo_obj) {
        const geo = new THREE.SphereGeometry(1, 32, 32);
        const mat = new THREE.MeshLambertMaterial({
            color: 0xdddddd,
            transparent: true,
            opacity: 0.88,
            depthWrite: false
        });
        humo_obj = new THREE.Mesh(geo, mat);
        scene.add(humo_obj);
    }

    humo_obj.position.copy(posicion);
    humo_obj.scale.set(1, 1, 1);
    humo_obj.material.opacity = 0.88;
    humo_obj.visible = true;
    humo_activo = true;
}

function expandirHumo(deltaSec) {
    if (!humo_activo || !humo_obj) return;

    const dt = Math.max(0.0001, Number(deltaSec) || (1 / 60));
    const dtNorm = dt * 60;

    if (humo_obj.scale.x < ESCALA_MAX_HUMO) {
        humo_obj.scale.addScalar(0.18 * dtNorm);
    } else {
        humo_obj.material.opacity -= 0.004 * dtNorm;

        if (humo_obj.material.opacity <= 0) {
            humo_activo = false;
            humo_obj.visible = false;
            limpiarTrail();

            // Vuelta suave a la posición de tiro (gestionado en main.js)
            if (typeof volverAPosicionTiro === "function") {
                estadoJuego = "VOLVIENDO";
                volverAPosicionTiro();
            } else {
                estadoJuego = "APUNTANDO";
            }
        }
    }
}