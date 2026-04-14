// ==========================================
// js/generador.js - GENERADOR ABIERTO (v3)
// Escenarios sin recintos cerrados ni perimetros de paredes.
// ==========================================

var dificultad_calculada = 0;
var cajas_cache = [];
var zonas_navegables = [];
const DIST_MIN_DIANA_TIRO = 30;

const CONFIG_DIFICULTAD = {
    DAILY_RATIO_OBJETIVO: 0.24,
    CAMPANA_RATIO_OBJETIVO: [0.38, 0.31, 0.24, 0.18, 0.13],
};

const BUSQUEDA_TIRO_PRESETS = {
    quick: {
        yawOffsets: [-0.16, -0.08, 0, 0.08, 0.16],
        pitchOffsets: [0.18, 0.32, 0.48, 0.64],
        ringRadii: [72, 108, 146, 186],
        ringStep: Math.PI / 7,
        zoneOffsetX: 0.22,
        zoneOffsetZ: 0.18,
        maxCandidates: 60,
        maxSteps: 220,
        hitRadius: 7.5,
        rangeMax: 360,
        minVel: 0.03,
        ratioTolerance: 0.32,
        distIdeal: 114,
        distTolerance: 84,
        viableBonusCap: 8,
    },
    full: {
        yawOffsets: [-0.25, -0.15, -0.08, 0, 0.08, 0.15, 0.25],
        pitchOffsets: [0.08, 0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78],
        ringRadii: [70, 98, 128, 162, 198],
        ringStep: Math.PI / 9,
        zoneOffsetX: 0.25,
        zoneOffsetZ: 0.20,
        maxCandidates: 180,
        maxSteps: 300,
        hitRadius: 7,
        rangeMax: 360,
        minVel: 0.03,
        ratioTolerance: 0.24,
        distIdeal: 124,
        distTolerance: 92,
        viableBonusCap: 12,
    },
};

const MATERIALES = {
    roca: new THREE.MeshLambertMaterial({ color: 0x8a8478 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x6d7982 }),
    madera: new THREE.MeshLambertMaterial({ color: 0xb9874e }),
    hormigon: new THREE.MeshLambertMaterial({ color: 0x948f84 }),
    pista: new THREE.MeshLambertMaterial({ color: 0xaca58d }),
    diana: new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0x330000 }),
};

function generarMapaAleatorio(semilla, opciones) {
    const opts = opciones || {};
    const seedBase = Math.floor(Math.abs(Number(semilla) || 1));
    const seedDaily = Math.floor(Math.abs(Number(opts.dianaSeed || seedBase) || seedBase));
    const seedMapa = opts.modo === "DAILY" ? seedDaily : seedBase;
    const rand = crearRngDeterminista(seedMapa * 59 + 17);

    colisionables = [];
    cajas_cache = [];
    zonas_navegables = [];

    const contexto = construirContextoGeneracion(opts);
    const perfilMapa = construirPerfilAbierto(rand, opts.modo === "DAILY", contexto);

    const raiz = (opts.rootGroup && opts.rootGroup.isGroup) ? opts.rootGroup : new THREE.Group();
    if (!(opts.rootGroup && opts.rootGroup.isGroup)) scene.add(raiz);

    aplicarTema(perfilMapa.tema);

    diana_obj = crearDiana(raiz);

    const nodos = construirEscenarioAbierto(raiz, perfilMapa, rand);
    poblarObstaculosAbiertos(raiz, perfilMapa, rand, nodos);

    const seleccion = seleccionarPosicionDianaInteligente(seedMapa, contexto);

    if (seleccion && seleccion.posicion) {
        diana_obj.position.set(seleccion.posicion.x, 0.15, seleccion.posicion.z);
    } else if (opts.modo === "DAILY") {
        const pDaily = obtenerPosicionDianaDaily(seedDaily);
        diana_obj.position.set(pDaily.x, 0.15, pDaily.z);
    } else {
        const pCamp = obtenerPosicionDianaCampana(seedBase);
        diana_obj.position.set(pCamp.x, 0.15, pCamp.z);
    }

    const target = new THREE.Vector3(diana_obj.position.x, 1, diana_obj.position.z);
    const ratioObjetivo = contexto.ratioObjetivo;

    let mejor = encontrarPosicionTiro(target, {
        preset: "full",
        ratioObjetivo,
        minDist: contexto.minDistTiro,
        distIdealOverride: contexto.distIdealTiro,
        bloqueoObjetivo: contexto.bloqueoObjetivo,
    });

    // Fallback controlado si el mapa queda muy cerrado para los objetivos de distancia/cobertura.
    if (!mejor && contexto.minDistTiro > DIST_MIN_DIANA_TIRO) {
        mejor = encontrarPosicionTiro(target, {
            preset: "full",
            ratioObjetivo,
            minDist: Math.max(DIST_MIN_DIANA_TIRO, Math.round(contexto.minDistTiro * 0.78)),
            distIdealOverride: Math.max(90, Math.round(contexto.distIdealTiro * 0.88)),
            bloqueoObjetivo: Math.max(0.08, contexto.bloqueoObjetivo - 0.07),
        });
    }

    if (mejor) {
        p_tiro.copy(mejor.pos);
        dificultad_calculada = mejor.dificultad;
        mostrarDificultad(dificultad_calculada, mejor.arcosViables, mejor.arcosTotales, perfilMapa.nombre);
    } else {
        p_tiro.set(0, 6.6, 80);
        dificultad_calculada = 5;
        mostrarDificultad(5, 0, 0, perfilMapa.nombre);
    }

    camera.position.set(0, 150, 80);
    cameraControls.target.set(0, 0, 20);
    cameraControls.update();

}

function construirPerfilAbierto(rand, diario, contexto) {
    const temas = [
        {
            nombre: "Cantera seca",
            roca: 0x8d877c,
            metal: 0x67727a,
            madera: 0xb6844b,
            hormigon: 0x978f80,
            pista: 0xb5ac8f,
            diana: 0xff4c23,
            dianaEmissive: 0x341204,
        },
        {
            nombre: "Patio industrial",
            roca: 0x7a7f7a,
            metal: 0x58666f,
            madera: 0xa97d49,
            hormigon: 0x8d938e,
            pista: 0xa7ab9a,
            diana: 0xff3e2a,
            dianaEmissive: 0x2e0d08,
        },
        {
            nombre: "Desierto tecnico",
            roca: 0x9d8f77,
            metal: 0x72746e,
            madera: 0xc08a44,
            hormigon: 0xaa9a7a,
            pista: 0xbba785,
            diana: 0xff5d20,
            dianaEmissive: 0x3b1404,
        },
        {
            nombre: "Gris urbano",
            roca: 0x81827d,
            metal: 0x5d6268,
            madera: 0xa68258,
            hormigon: 0x96928a,
            pista: 0xa7a08f,
            diana: 0xff4628,
            dianaEmissive: 0x2f0f08,
        },
    ];

    const tema = temas[Math.floor(rand() * temas.length)];
    const firma = Math.floor(rand() * 8);
    const alcance = (contexto && contexto.alcanceLanzamiento) ? contexto.alcanceLanzamiento : obtenerEnvolventeLanzamiento();
    const escalaMapa = clamp((alcance.maxUtil - 65) / 70, 0, 1);
    const ramas = 4 + Math.floor(rand() * 3) + Math.round(escalaMapa * 2);
    const radioBase = lerp(46, 84, escalaMapa);
    const radio = radioBase + rand() * lerp(16, 30, escalaMapa);
    const expansion = lerp(0.95, 1.55, escalaMapa) + rand() * 0.35;
    const densidad = lerp(1.24, 0.84, escalaMapa) + rand() * 0.36;

    return {
        nombre: diario ? `${tema.nombre} abierto · firma ${firma + 1}` : `Abierto firma ${firma + 1}`,
        firma,
        ramas,
        radio,
        expansion,
        densidad,
        tema,
    };
}

function aplicarTema(tema) {
    const t = tema || {
        roca: 0x8a8478,
        metal: 0x6d7982,
        madera: 0xb9874e,
        hormigon: 0x948f84,
        pista: 0xaca58d,
        diana: 0xff3300,
        dianaEmissive: 0x330000,
    };

    MATERIALES.roca.color.setHex(t.roca);
    MATERIALES.metal.color.setHex(t.metal);
    MATERIALES.madera.color.setHex(t.madera);
    MATERIALES.hormigon.color.setHex(t.hormigon);
    MATERIALES.pista.color.setHex(t.pista);
    MATERIALES.diana.color.setHex(t.diana);
    MATERIALES.diana.emissive.setHex(t.dianaEmissive);
}

function construirEscenarioAbierto(grupo, perfil, rand) {
    const nodos = [];

    const hub = {
        x: 0,
        z: 0,
        rx: 30 + rand() * 16,
        rz: 28 + rand() * 16,
        tipo: "hub",
    };
    nodos.push(hub);

    for (let i = 0; i < perfil.ramas; i++) {
        const ang = (i / perfil.ramas) * Math.PI * 2 + (rand() - 0.5) * 0.45;
        const dist = perfil.radio * (0.75 + rand() * 0.9);
        const x = Math.sin(ang) * dist;
        const z = Math.cos(ang) * dist;

        const rx = 20 + rand() * 20 * perfil.expansion;
        const rz = 18 + rand() * 18 * perfil.expansion;

        nodos.push({ x, z, rx, rz, tipo: "isla" });

        if (rand() < 0.45) {
            const x2 = x + Math.sin(ang + (rand() - 0.5) * 0.7) * (26 + rand() * 46);
            const z2 = z + Math.cos(ang + (rand() - 0.5) * 0.7) * (26 + rand() * 46);
            nodos.push({ x: x2, z: z2, rx: 14 + rand() * 12, rz: 14 + rand() * 11, tipo: "satelite" });
        }
    }

    // Corrige solapes grandes de nodos para que el escenario siga siendo legible.
    separarNodos(nodos, 7);

    for (const n of nodos) {
        crearPlataformaZona(grupo, n, rand);
        registrarZona(n.x - n.rx * 0.82, n.x + n.rx * 0.82, n.z - n.rz * 0.82, n.z + n.rz * 0.82, n.tipo);
    }

    crearConexionesAbiertas(grupo, nodos, rand);
    crearLandmarksDecorativos(grupo, nodos, perfil, rand);

    return nodos;
}

function separarNodos(nodos, iteraciones) {
    for (let it = 0; it < iteraciones; it++) {
        for (let i = 0; i < nodos.length; i++) {
            for (let j = i + 1; j < nodos.length; j++) {
                const a = nodos[i];
                const b = nodos[j];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const dist = Math.hypot(dx, dz) || 0.001;
                const minDist = Math.max(a.rx, a.rz) + Math.max(b.rx, b.rz) - 8;

                if (dist < minDist) {
                    const push = (minDist - dist) * 0.5;
                    const nx = dx / dist;
                    const nz = dz / dist;
                    a.x -= nx * push;
                    a.z -= nz * push;
                    b.x += nx * push;
                    b.z += nz * push;
                }
            }
        }
    }
}

function crearPlataformaZona(grupo, nodo, rand) {
    // Plataformas abiertas no circulares para evitar "circulos" visibles en suelo.
    const baseA = new THREE.Mesh(
        new THREE.BoxGeometry(nodo.rx * 1.6, 0.35, nodo.rz * 1.6),
        MATERIALES.pista
    );
    baseA.position.set(nodo.x, 0.02, nodo.z);
    baseA.rotation.y = (rand() - 0.5) * 0.45;
    baseA.receiveShadow = true;
    grupo.add(baseA);

    const baseB = new THREE.Mesh(
        new THREE.BoxGeometry(nodo.rx * 1.1, 0.28, nodo.rz * 1.05),
        MATERIALES.hormigon
    );
    baseB.position.set(nodo.x + (rand() - 0.5) * 3, 0.08, nodo.z + (rand() - 0.5) * 3);
    baseB.rotation.y = baseA.rotation.y + (rand() - 0.5) * 0.3;
    baseB.receiveShadow = true;
    grupo.add(baseB);
}

function crearConexionesAbiertas(grupo, nodos, rand) {
    // Conecta cada nodo con su vecino mas cercano usando pasarelas bajas, no paredes.
    const conexionesCreadas = new Set();

    for (let i = 0; i < nodos.length; i++) {
        const a = nodos[i];
        let mejor = null;
        let mejorIdx = -1;
        let mejorDist = Infinity;

        for (let j = 0; j < nodos.length; j++) {
            if (i === j) continue;
            const b = nodos[j];
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            if (d < mejorDist) {
                mejorDist = d;
                mejor = b;
                mejorIdx = j;
            }
        }

        if (!mejor || mejorDist < 16 || mejorDist > 160) continue;

        const edgeA = Math.min(i, mejorIdx);
        const edgeB = Math.max(i, mejorIdx);
        const claveConexion = `${edgeA}-${edgeB}`;
        if (conexionesCreadas.has(claveConexion)) continue;
        conexionesCreadas.add(claveConexion);

        const cx = (a.x + mejor.x) / 2;
        const cz = (a.z + mejor.z) / 2;
        const largo = Math.max(6, mejorDist - Math.max(a.rx, a.rz) * 0.6 - Math.max(mejor.rx, mejor.rz) * 0.6);

        const puente = new THREE.Mesh(
            new THREE.BoxGeometry(5.2 + rand() * 1.8, 0.35, largo),
            MATERIALES.hormigon
        );
        puente.position.set(cx, 0.05, cz);
        puente.lookAt(new THREE.Vector3(mejor.x, 0.05, mejor.z));
        puente.receiveShadow = true;
        grupo.add(puente);

        registrarZona(cx - 2.6, cx + 2.6, cz - largo / 2, cz + largo / 2, "conector");
    }
}

function crearLandmarksDecorativos(grupo, nodos, perfil, rand) {
    const cantidad = 5 + Math.floor(perfil.expansion * 4);

    for (let i = 0; i < cantidad; i++) {
        const n = nodos[Math.floor(rand() * nodos.length)];
        const x = n.x + (rand() - 0.5) * (n.rx * 1.5);
        const z = n.z + (rand() - 0.5) * (n.rz * 1.5);

        if (rand() < 0.5) {
            const roca = new THREE.Mesh(
                new THREE.DodecahedronGeometry(1.4 + rand() * 2.3, 0),
                MATERIALES.roca
            );
            roca.position.set(x, 0.7 + rand() * 0.8, z);
            roca.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
            roca.castShadow = true;
            roca.receiveShadow = true;
            grupo.add(roca);
        } else {
            const poste = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.4, 4 + rand() * 4, 10),
                MATERIALES.metal
            );
            poste.position.set(x, (4 + rand() * 4) / 2, z);
            poste.castShadow = true;
            grupo.add(poste);
        }
    }
}

function poblarObstaculosAbiertos(grupo, perfil, rand, nodos) {
    const ocupados = [];

    function libre(x, z, r) {
        for (const o of ocupados) {
            if (Math.hypot(x - o.x, z - o.z) < (o.r + r + 2)) return false;
        }
        return !posicionDentroMuroConColisionables(x, z, r);
    }

    function registrar(x, z, r) {
        ocupados.push({ x, z, r });
    }

    for (const nodo of nodos) {
        const area = Math.max(1, nodo.rx * nodo.rz);
        const base = Math.max(2, Math.floor(area / 125));
        const cant = Math.max(2, Math.round(base * perfil.densidad * (0.75 + rand() * 0.65)));
        const radioCentroLibre = nodo.tipo === "hub"
            ? 14
            : Math.min(nodo.rx, nodo.rz) * 0.26;

        for (let i = 0; i < cant; i++) {
            let colocado = false;
            for (let t = 0; t < 14 && !colocado; t++) {
                const ang = rand() * Math.PI * 2;
                const rr = (0.32 + 0.68 * Math.sqrt(rand())) * Math.min(nodo.rx, nodo.rz) * 0.88;
                const x = nodo.x + Math.sin(ang) * rr;
                const z = nodo.z + Math.cos(ang) * rr;
                const radio = 2 + rand() * 2.8;

                if (Math.hypot(x - nodo.x, z - nodo.z) < radioCentroLibre) continue;

                if (!libre(x, z, radio)) continue;

                const tipo = Math.floor(rand() * 5);
                if (tipo === 0) {
                    const s = 2.7 + rand() * 3.1;
                    const h = 2.8 + rand() * 2.8;
                    crearCaja(grupo, x, 0, z, s, h, s, MATERIALES.madera, true);
                    if (rand() < 0.42) crearCaja(grupo, x, h, z, s * 0.7, h * 0.58, s * 0.7, MATERIALES.madera, true);
                } else if (tipo === 1) {
                    const l = 6 + rand() * 8;
                    const a = 3.5 + rand() * 3.2;
                    const g = 1.8 + rand() * 1.4;
                    if (rand() < 0.5) crearCaja(grupo, x, 0, z, l, a, g, MATERIALES.hormigon, true);
                    else crearCaja(grupo, x, 0, z, g, a, l, MATERIALES.hormigon, true);
                } else if (tipo === 2) {
                    crearCilindro(grupo, x, z, 1.0 + rand() * 0.6, 3.4 + rand() * 3.2, MATERIALES.metal);
                    if (rand() < 0.62) {
                        crearCilindro(grupo, x + 2.1 + rand() * 1.4, z - 1 + rand() * 2, 0.9 + rand() * 0.4, 3.2 + rand() * 2.5, MATERIALES.metal);
                    }
                } else if (tipo === 3) {
                    crearCaja(grupo, x, 0, z, 3 + rand() * 2.5, 2.4 + rand() * 2.1, 3 + rand() * 2.5, MATERIALES.metal, true);
                } else {
                    // Cobertura en L para jugadas de rebote sin cerrar espacios.
                    const l1 = 6 + rand() * 6;
                    const l2 = 5 + rand() * 5;
                    const h = 4 + rand() * 2.6;
                    crearCaja(grupo, x, 0, z, l1, h, 1.6, MATERIALES.hormigon, true);
                    crearCaja(grupo, x + (l1 / 2 - 0.8), 0, z + (l2 / 2 - 0.8), 1.6, h, l2, MATERIALES.hormigon, true);
                }

                registrar(x, z, radio);
                colocado = true;
            }
        }
    }
}

function crearDiana(grupo) {
    const dianaGroup = new THREE.Group();

    const disco = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.3, 32), MATERIALES.diana);
    disco.receiveShadow = true;
    dianaGroup.add(disco);

    const anillo = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.3, 8, 32), MATERIALES.diana);
    anillo.rotation.x = Math.PI / 2;
    anillo.position.y = 0.15;
    dianaGroup.add(anillo);

    dianaGroup.position.set(0, 0.15, 0);
    grupo.add(dianaGroup);

    return dianaGroup;
}

function crearCaja(grupo, x, y, z, ancho, alto, prof, mat, colisionable) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, prof), mat);
    mesh.position.set(x, y + alto / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grupo.add(mesh);
    if (colisionable !== false) {
        colisionables.push(mesh);
        cajas_cache.push(new THREE.Box3(
            new THREE.Vector3(x - ancho / 2, y, z - prof / 2),
            new THREE.Vector3(x + ancho / 2, y + alto, z + prof / 2)
        ));
    }
    return mesh;
}

function crearCilindro(grupo, x, z, r, alto, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, alto, 12), mat);
    mesh.position.set(x, alto / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grupo.add(mesh);
    colisionables.push(mesh);
    cajas_cache.push(new THREE.Box3(
        new THREE.Vector3(x - r, 0, z - r),
        new THREE.Vector3(x + r, alto, z + r)
    ));
    return mesh;
}

function registrarZona(xMin, xMax, zMin, zMax, tag) {
    if ((xMax - xMin) < 8 || (zMax - zMin) < 8) return;
    zonas_navegables.push({ xMin, xMax, zMin, zMax, tag: tag || "zona" });
}

function construirContextoGeneracion(opts) {
    const modo = opts && opts.modo === "DAILY" ? "DAILY" : "CAMPANA";
    const nivelRaw = Number(opts && opts.nivelCampana);
    const nivelCampana = Math.max(1, Math.min(5, Number.isFinite(nivelRaw) ? Math.floor(nivelRaw) : 1));
    const seedRaw = Number(opts && (opts.dianaSeed || opts.seed || 0));
    const seedDaily = Math.floor(Math.abs(seedRaw || 1));
    const randDaily = crearRngDeterminista(seedDaily * 43 + 19);

    const ratioObjetivo = modo === "DAILY"
        ? CONFIG_DIFICULTAD.DAILY_RATIO_OBJETIVO
        : CONFIG_DIFICULTAD.CAMPANA_RATIO_OBJETIVO[nivelCampana - 1];

    const alcanceLanzamiento = obtenerEnvolventeLanzamiento();
    const minDistCamp = [58, 68, 78, 88, 96];
    const distIdealCamp = [96, 110, 124, 138, 150];
    const bloqueoCamp = [0.12, 0.16, 0.20, 0.24, 0.28];

    const dailyDificultad = randDaily();
    const minDistDaily = lerp(58, 90, dailyDificultad);
    const idealDistDaily = lerp(98, 152, dailyDificultad);

    const minDistBase = modo === "DAILY" ? minDistDaily : minDistCamp[nivelCampana - 1];
    const distIdealBase = modo === "DAILY" ? idealDistDaily : distIdealCamp[nivelCampana - 1];
    const minDistCap = Math.max(DIST_MIN_DIANA_TIRO + 4, alcanceLanzamiento.maxUtil - 36);
    const idealCap = Math.max(minDistCap + 8, alcanceLanzamiento.maxUtil - 10);

    const minDistTiro = clamp(minDistBase, DIST_MIN_DIANA_TIRO + 4, minDistCap);
    const distIdealTiro = clamp(distIdealBase, minDistTiro + 8, idealCap);
    const bloqueoObjetivo = modo === "DAILY" ? 0.18 : bloqueoCamp[nivelCampana - 1];

    return {
        modo,
        nivelCampana,
        alcanceLanzamiento,
        ratioObjetivo,
        tagPreferido: obtenerTagPreferidoDiana(modo, nivelCampana),
        radioDiana: 5.6,
        minDistTiro,
        distIdealTiro,
        bloqueoObjetivo,
        dificultadDaily: modo === "DAILY" ? dailyDificultad : null,
    };
}

function obtenerTagPreferidoDiana(modo, nivelCampana) {
    if (modo === "DAILY") return "isla";
    if (nivelCampana <= 2) return "hub";
    if (nivelCampana >= 4) return "satelite";
    return "isla";
}

function seleccionarPosicionDianaInteligente(seedMapa, contexto) {
    const rand = crearRngDeterminista(seedMapa * 97 + 71);
    const candidatos = construirCandidatosDiana(rand, contexto);
    if (candidatos.length === 0) return null;

    for (const c of candidatos) {
        c.heurScore = puntuarCandidatoDiana(c, contexto);
    }

    candidatos.sort((a, b) => b.heurScore - a.heurScore);
    const top = candidatos.slice(0, Math.min(5, candidatos.length));

    let mejor = null;
    let mejorScore = -Infinity;

    for (const cand of top) {
        const target = new THREE.Vector3(cand.x, 1, cand.z);
        let tiroRapido = encontrarPosicionTiro(target, {
            preset: "quick",
            ratioObjetivo: contexto.ratioObjetivo,
            minDist: contexto.minDistTiro,
            distIdealOverride: Math.round(contexto.distIdealTiro * 0.9),
            bloqueoObjetivo: contexto.bloqueoObjetivo,
        });

        if (!tiroRapido && contexto.minDistTiro > DIST_MIN_DIANA_TIRO + 8) {
            tiroRapido = encontrarPosicionTiro(target, {
                preset: "quick",
                ratioObjetivo: contexto.ratioObjetivo,
                minDist: Math.max(DIST_MIN_DIANA_TIRO, Math.round(contexto.minDistTiro * 0.82)),
                distIdealOverride: Math.round(contexto.distIdealTiro * 0.84),
                bloqueoObjetivo: Math.max(0.08, contexto.bloqueoObjetivo - 0.06),
            });
        }

        if (!tiroRapido) continue;

        const ratio = tiroRapido.arcosTotales > 0 ? (tiroRapido.arcosViables / tiroRapido.arcosTotales) : 0;
        const scoreRatio = 1 - clamp(Math.abs(ratio - contexto.ratioObjetivo) / 0.26, 0, 1);
        const scoreBloqueo = 1 - clamp(Math.abs((tiroRapido.bloqueo || 0) - contexto.bloqueoObjetivo) / 0.28, 0, 1);
        const scoreTotal = cand.heurScore * 0.34 + scoreRatio * 0.46 + scoreBloqueo * 0.20;

        if (scoreTotal > mejorScore) {
            mejorScore = scoreTotal;
            mejor = {
                posicion: new THREE.Vector3(cand.x, 0.15, cand.z),
            };
        }
    }

    if (mejor) return mejor;

    const fallback = candidatos[0];
    return {
        posicion: new THREE.Vector3(fallback.x, 0.15, fallback.z),
    };
}

function construirCandidatosDiana(rand, contexto) {
    const total = contexto.modo === "DAILY" ? 56 : 48;
    const candidatos = [];
    const maxIntentos = total * 7;

    for (let i = 0; i < maxIntentos && candidatos.length < total; i++) {
        const preferirTag = i < Math.floor(total * 0.55) ? contexto.tagPreferido : null;
        const zona = elegirZonaPonderada(rand, preferirTag);
        if (!zona) break;

        const x = lerp(zona.xMin + 5, zona.xMax - 5, rand());
        const z = lerp(zona.zMin + 5, zona.zMax - 5, rand());

        if (!posicionDianaLibre(x, z, contexto.radioDiana)) continue;

        const distBorde = Math.min(x - zona.xMin, zona.xMax - x, z - zona.zMin, zona.zMax - z);
        if (distBorde < 3.8) continue;

        if (!agregarCandidatoSiLejano(candidatos, x, z, 8.5)) continue;
        candidatos[candidatos.length - 1].zonaTag = zona.tag;
        candidatos[candidatos.length - 1].distBorde = distBorde;
    }

    return candidatos;
}

function agregarCandidatoSiLejano(lista, x, z, minDist) {
    const minDistSq = minDist * minDist;
    for (const c of lista) {
        const dx = c.x - x;
        const dz = c.z - z;
        if ((dx * dx + dz * dz) < minDistSq) return false;
    }

    lista.push({ x, z, zonaTag: "zona", distBorde: 0, heurScore: 0 });
    return true;
}

function puntuarCandidatoDiana(candidato, contexto) {
    const t = (contexto.nivelCampana - 1) / 4;

    const objetivoNear = contexto.modo === "DAILY" ? 2.5 : lerp(1.5, 4.8, t);
    const objetivoMid = contexto.modo === "DAILY" ? 6 : lerp(4, 9, t);

    const obsNear = contarObstaculosAproximados(candidato.x, candidato.z, 11);
    const obsMid = contarObstaculosAproximados(candidato.x, candidato.z, 20);

    const tagScore = puntuarTagZona(candidato.zonaTag, contexto);
    const bordeScore = clamp((candidato.distBorde - 4) / 10, 0, 1);
    const nearScore = 1 - clamp(Math.abs(obsNear - objetivoNear) / (objetivoNear + 2), 0, 1);
    const midScore = 1 - clamp(Math.abs(obsMid - objetivoMid) / (objetivoMid + 3), 0, 1);
    const distanciaCentro = Math.hypot(candidato.x, candidato.z);
    const alcance = (contexto && contexto.alcanceLanzamiento) ? contexto.alcanceLanzamiento : obtenerEnvolventeLanzamiento();
    const objetivoCentro = clamp(contexto.distIdealTiro * 0.55, 24, alcance.maxUtil * 0.78);
    const spreadScore = 1 - clamp(Math.abs(distanciaCentro - objetivoCentro) / Math.max(16, objetivoCentro * 0.65), 0, 1);

    return tagScore * 0.24 + bordeScore * 0.24 + nearScore * 0.24 + midScore * 0.18 + spreadScore * 0.10;
}

function puntuarTagZona(tag, contexto) {
    if (contexto.modo === "DAILY") {
        if (tag === "isla") return 1;
        if (tag === "conector") return 0.9;
        if (tag === "satelite") return 0.85;
        return 0.75;
    }

    const n = contexto.nivelCampana;
    if (n <= 2) {
        if (tag === "hub") return 1;
        if (tag === "isla") return 0.9;
        if (tag === "conector") return 0.82;
        return 0.7;
    }
    if (n >= 4) {
        if (tag === "satelite") return 1;
        if (tag === "conector") return 0.95;
        if (tag === "isla") return 0.9;
        return 0.76;
    }

    if (tag === "isla") return 1;
    if (tag === "conector") return 0.95;
    if (tag === "satelite") return 0.86;
    return 0.8;
}

function contarObstaculosAproximados(x, z, radio) {
    const r2 = radio * radio;
    let n = 0;

    for (const box of cajas_cache) {
        const cx = (box.min.x + box.max.x) * 0.5;
        const cz = (box.min.z + box.max.z) * 0.5;
        const dx = cx - x;
        const dz = cz - z;
        if ((dx * dx + dz * dz) <= r2) n++;
    }

    return n;
}

function obtenerPosicionDianaDaily(seed) {
    const rand = crearRngDeterminista(seed * 79 + 23);

    for (let i = 0; i < 300; i++) {
        const zona = elegirZonaPonderada(rand, i < 110 ? "isla" : null);
        if (!zona) break;

        const x = lerp(zona.xMin + 5, zona.xMax - 5, rand());
        const z = lerp(zona.zMin + 5, zona.zMax - 5, rand());

        if (posicionDianaLibre(x, z, 5.6)) return new THREE.Vector3(x, 0.15, z);
    }

    return new THREE.Vector3(0, 0.15, 0);
}

function obtenerPosicionDianaCampana(seed) {
    const rand = crearRngDeterminista(seed * 67 + 13);

    for (let i = 0; i < 220; i++) {
        const zona = elegirZonaPonderada(rand, i < 80 ? "hub" : null);
        if (!zona) break;

        const x = lerp(zona.xMin + 5, zona.xMax - 5, rand());
        const z = lerp(zona.zMin + 5, zona.zMax - 5, rand());

        if (posicionDianaLibre(x, z, 5.6)) return new THREE.Vector3(x, 0.15, z);
    }

    return new THREE.Vector3(0, 0.15, 0);
}

function elegirZonaPonderada(rand, tagPreferido) {
    const lista = tagPreferido
        ? zonas_navegables.filter(z => z.tag === tagPreferido)
        : zonas_navegables.slice();

    if (lista.length === 0) return null;

    let total = 0;
    for (const z of lista) {
        total += Math.max(1, (z.xMax - z.xMin) * (z.zMax - z.zMin));
    }

    let r = rand() * total;
    for (const z of lista) {
        r -= Math.max(1, (z.xMax - z.xMin) * (z.zMax - z.zMin));
        if (r <= 0) return z;
    }

    return lista[lista.length - 1];
}

function posicionDianaLibre(x, z, radio) {
    const radio2 = radio * radio;
    for (const box of cajas_cache) {
        if (intersecaEsferaCaja(x, 1, z, radio2, box)) return false;
    }
    return true;
}

function encontrarPosicionTiro(target, opciones) {
    const ALT = 6.6;
    const opts = opciones || {};
    const cfg = obtenerConfigBusquedaTiro(opts.preset || "full");
    const ratioObjetivo = Number.isFinite(opts.ratioObjetivo)
        ? opts.ratioObjetivo
        : CONFIG_DIFICULTAD.DAILY_RATIO_OBJETIVO;
    const minDist = Math.max(0, Number(opts.minDist) || DIST_MIN_DIANA_TIRO);
    const distIdeal = Number.isFinite(opts.distIdealOverride) ? Number(opts.distIdealOverride) : cfg.distIdeal;
    const bloqueoObjetivo = Number.isFinite(opts.bloqueoObjetivo) ? Number(opts.bloqueoObjetivo) : 0.16;

    const candidatos = generarCandidatos(ALT, target, cfg);

    let mejor = null;
    let mejorPunt = -Infinity;

    for (const pos of candidatos) {
        if (posicionDentroMuro(pos)) continue;

        const distTarget = pos.distanceTo(target);
        if (distTarget < minDist) continue;

        const test = contarArcosViables(pos, target, cfg);
        if (test.viables === 0 || test.total === 0) continue;

        const ratio = test.viables / test.total;
        const bloqueo = medirBloqueoLinea(pos, target);
        const scoreRatio = 1 - clamp(Math.abs(ratio - ratioObjetivo) / cfg.ratioTolerance, 0, 1);
        const scoreDist = 1 - clamp(Math.abs(distTarget - distIdeal) / cfg.distTolerance, 0, 1);
        const scoreBloqueo = 1 - clamp(Math.abs(bloqueo - bloqueoObjetivo) / 0.30, 0, 1);
        const bonusViables = Math.min(cfg.viableBonusCap, test.viables) * 1.4;
        const punt = scoreRatio * 100 + scoreDist * 20 + scoreBloqueo * 34 + bonusViables;

        if (punt > mejorPunt) {
            mejorPunt = punt;
            mejor = {
                pos: pos.clone(),
                arcosViables: test.viables,
                arcosTotales: test.total,
                ratio,
                bloqueo,
                dificultad: Math.max(1, Math.min(10, Math.round((1 - Math.min(ratio, 1)) * 10))),
            };
        }
    }

    return mejor;
}

function obtenerConfigBusquedaTiro(preset) {
    if (preset === "quick") return BUSQUEDA_TIRO_PRESETS.quick;
    return BUSQUEDA_TIRO_PRESETS.full;
}

function generarCandidatos(y, target, cfg) {
    const out = [];

    for (const z of zonas_navegables) {
        const cx = (z.xMin + z.xMax) / 2;
        const cz = (z.zMin + z.zMax) / 2;
        const w = z.xMax - z.xMin;
        const d = z.zMax - z.zMin;
        if (w < 9 || d < 9) continue;

        out.push(new THREE.Vector3(cx, y, cz));
        out.push(new THREE.Vector3(cx + (w * cfg.zoneOffsetX), y, cz - (d * cfg.zoneOffsetZ)));
        out.push(new THREE.Vector3(cx - (w * cfg.zoneOffsetX), y, cz + (d * cfg.zoneOffsetZ)));
    }

    for (const r of cfg.ringRadii) {
        for (let a = 0; a < Math.PI * 2; a += cfg.ringStep) {
            out.push(new THREE.Vector3(
                target.x + Math.sin(a) * r,
                y,
                target.z + Math.cos(a) * r
            ));
        }
    }

    if (out.length <= cfg.maxCandidates) return out;

    // Muestreo determinista para mantener variedad sin explotar coste de simulacion.
    const sample = [];
    const step = out.length / cfg.maxCandidates;
    for (let i = 0; i < cfg.maxCandidates; i++) {
        sample.push(out[Math.floor(i * step)]);
    }
    return sample;
}

function contarArcosViables(origen, target, cfg) {
    const dir = target.clone().sub(origen).normalize();
    const yawBase = Math.atan2(-dir.x, -dir.z);

    const VEL = obtenerVelocidadReferenciaGenerador();
    const YALZ = (typeof IMPULSO_Y === "number") ? IMPULSO_Y : 0.0;

    let viables = 0;
    let total = 0;

    for (const dYaw of cfg.yawOffsets) {
        for (const pitch of cfg.pitchOffsets) {
            const yaw = yawBase + dYaw;
            const vx = -Math.sin(yaw) * Math.cos(pitch) * VEL;
            const vy = Math.sin(pitch) * VEL + YALZ;
            const vz = -Math.cos(yaw) * Math.cos(pitch) * VEL;

            total++;
            if (simularArco(origen, vx, vy, vz, target, cfg)) viables++;
        }
    }

    return { viables, total };
}

function simularArco(origen, vxInicial, vyInicial, vzInicial, target, cfg) {
    let px = origen.x;
    let py = origen.y;
    let pz = origen.z;

    let vx = vxInicial;
    let vy = vyInicial;
    let vz = vzInicial;

    const tx = target.x;
    const ty = target.y;
    const tz = target.z;

    const radio = 0.5;
    const radio2 = radio * radio;
    const hitR2 = cfg.hitRadius * cfg.hitRadius;
    const maxRange2 = cfg.rangeMax * cfg.rangeMax;
    const minVel2 = cfg.minVel * cfg.minVel;

    for (let step = 0; step < cfg.maxSteps; step++) {
        vy -= 0.016;
        vx *= 0.9975;
        vy *= 0.9975;
        vz *= 0.9975;

        px += vx;
        py += vy;
        pz += vz;

        const dx = px - tx;
        const dy = py - ty;
        const dz = pz - tz;
        if ((dx * dx + dy * dy + dz * dz) < hitR2) return true;

        if (py < 0.5) {
            py = 0.5;
            vy = Math.abs(vy) * 0.4;
            vx *= 0.72;
            vz *= 0.72;
        }

        for (const caja of cajas_cache) {
            if (intersecaEsferaCaja(px, py, pz, radio2, caja)) return false;
        }

        if ((dx * dx + dz * dz) > maxRange2 || ((vx * vx + vy * vy + vz * vz) < minVel2)) return false;
    }

    return false;
}

function intersecaEsferaCaja(x, y, z, radio2, box) {
    const qx = x < box.min.x ? box.min.x : (x > box.max.x ? box.max.x : x);
    const qy = y < box.min.y ? box.min.y : (y > box.max.y ? box.max.y : y);
    const qz = z < box.min.z ? box.min.z : (z > box.max.z ? box.max.z : z);

    const dx = x - qx;
    const dy = y - qy;
    const dz = z - qz;

    return (dx * dx + dy * dy + dz * dz) <= radio2;
}

function medirBloqueoLinea(origen, target) {
    const samples = 14;
    let hits = 0;

    for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const x = lerp(origen.x, target.x, t);
        const y = lerp(origen.y, target.y, t);
        const z = lerp(origen.z, target.z, t);

        for (const box of cajas_cache) {
            if (puntoEnCajaExpandida(x, y, z, box, 0.32)) {
                hits++;
                break;
            }
        }
    }

    return hits / (samples - 1);
}

function puntoEnCajaExpandida(x, y, z, box, margen) {
    if (x < (box.min.x - margen) || x > (box.max.x + margen)) return false;
    if (y < (box.min.y - margen) || y > (box.max.y + margen)) return false;
    if (z < (box.min.z - margen) || z > (box.max.z + margen)) return false;
    return true;
}

function posicionDentroMuro(pos) {
    const half = 0.45;
    const minX = pos.x - half;
    const maxX = pos.x + half;
    const minY = pos.y - half;
    const maxY = pos.y + half;
    const minZ = pos.z - half;
    const maxZ = pos.z + half;

    for (const c of cajas_cache) {
        if (minX > c.max.x || maxX < c.min.x) continue;
        if (minY > c.max.y || maxY < c.min.y) continue;
        if (minZ > c.max.z || maxZ < c.min.z) continue;
        return true;
    }
    return false;
}

function posicionDentroMuroConColisionables(x, z, radio) {
    const radio2 = radio * radio;
    for (const box of cajas_cache) {
        if (intersecaEsferaCaja(x, 1, z, radio2, box)) return true;
    }
    return false;
}

function mostrarDificultad(score, viables, total, nombrePerfil) {
    let etiqueta = "EXPERTO";
    let color = "#9C27B0";

    if (score <= 2) { etiqueta = "FACIL"; color = "#4CAF50"; }
    else if (score <= 5) { etiqueta = "MEDIA"; color = "#FF9800"; }
    else if (score <= 8) { etiqueta = "DIFICIL"; color = "#f44336"; }

    const info = total > 0 ? ` (${viables}/${total} arcos)` : "";
    const titulo = document.getElementById('titulo-estado');
    titulo.innerText = `${etiqueta}${info}`;
    titulo.style.color = color;

    const perfilTxt = nombrePerfil ? ` | ${nombrePerfil}` : "";
    document.getElementById('instrucciones').innerText = `Pulsa ESPACIO para apuntar desde la posicion encontrada${perfilTxt}`;
}

function obtenerVelocidadReferenciaGenerador() {
    const vMin = (typeof VEL_LANZAM_MIN === "number") ? VEL_LANZAM_MIN : 0.72;
    const vMax = (typeof VEL_LANZAM_MAX === "number") ? VEL_LANZAM_MAX : 1.58;
    const vBase = (typeof VEL_LANZAM === "number") ? VEL_LANZAM : ((vMin + vMax) * 0.5);
    const ref = Math.max(vBase, vMin + (vMax - vMin) * 0.72);
    return clamp(ref, vMin, vMax);
}

function obtenerEnvolventeLanzamiento() {
    const vMin = (typeof VEL_LANZAM_MIN === "number") ? VEL_LANZAM_MIN : 0.72;
    const vMax = (typeof VEL_LANZAM_MAX === "number") ? VEL_LANZAM_MAX : 1.58;
    const y0 = 6.6;
    const pitches = [0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64];

    const alcancePlano = (v0) => {
        let mejor = 0;

        for (const p of pitches) {
            let x = 0;
            let y = y0;
            let vx = Math.cos(p) * v0;
            let vy = Math.sin(p) * v0;

            for (let step = 0; step < 360; step++) {
                vy -= 0.016;
                vx *= 0.9975;
                vy *= 0.9975;

                x += Math.abs(vx);
                y += vy;

                if (y <= 0.5) break;
            }

            if (x > mejor) mejor = x;
        }

        return mejor;
    };

    const alcanceMin = alcancePlano(vMin);
    const alcanceMax = alcancePlano(vMax);

    return {
        minUtil: Math.max(DIST_MIN_DIANA_TIRO, alcanceMin * 0.76),
        maxUtil: Math.max(DIST_MIN_DIANA_TIRO + 24, alcanceMax * 0.84),
    };
}

function crearRngDeterminista(seed) {
    let s = Math.floor(Math.abs(Number(seed) || 1)) % 2147483647;
    if (s <= 0) s = 1234567;

    return function rand() {
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
    };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}
