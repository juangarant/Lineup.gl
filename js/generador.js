// ==========================================
// js/generador.js - GENERADOR ABIERTO (v3)
// Escenarios sin recintos cerrados ni perimetros de paredes.
// ==========================================

var dificultad_calculada = 0;
var cajas_cache = [];
var zonas_navegables = [];
const DIST_MIN_DIANA_TIRO = 30;

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

    const perfilMapa = construirPerfilAbierto(rand, opts.modo === "DAILY");

    const raiz = new THREE.Group();
    scene.add(raiz);

    aplicarTema(perfilMapa.tema);

    diana_obj = crearDiana(raiz);

    const nodos = construirEscenarioAbierto(raiz, perfilMapa, rand);
    poblarObstaculosAbiertos(raiz, perfilMapa, rand, nodos);

    if (opts.modo === "DAILY") {
        const pDaily = obtenerPosicionDianaDaily(seedDaily);
        diana_obj.position.set(pDaily.x, 0.15, pDaily.z);
    } else {
        const pCamp = obtenerPosicionDianaCampana(seedBase);
        diana_obj.position.set(pCamp.x, 0.15, pCamp.z);
    }

    cajas_cache = colisionables.map(c => new THREE.Box3().setFromObject(c));

    const mejor = encontrarPosicionTiro();
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

function construirPerfilAbierto(rand, diario) {
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
    const ramas = 5 + Math.floor(rand() * 4);
    const radio = 56 + rand() * 34;
    const expansion = 1.05 + rand() * 1.3;
    const densidad = 0.9 + rand() * 1.1;

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
    if (colisionable !== false) colisionables.push(mesh);
    return mesh;
}

function crearCilindro(grupo, x, z, r, alto, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, alto, 12), mat);
    mesh.position.set(x, alto / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grupo.add(mesh);
    colisionables.push(mesh);
    return mesh;
}

function registrarZona(xMin, xMax, zMin, zMax, tag) {
    if ((xMax - xMin) < 8 || (zMax - zMin) < 8) return;
    zonas_navegables.push({ xMin, xMax, zMin, zMax, tag: tag || "zona" });
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
    const esfera = new THREE.Sphere(new THREE.Vector3(x, 1, z), radio);
    for (const obj of colisionables) {
        const box = new THREE.Box3().setFromObject(obj);
        if (box.intersectsSphere(esfera)) return false;
    }
    return true;
}

function encontrarPosicionTiro() {
    const ALT = 6.6;
    const target = diana_obj
        ? new THREE.Vector3(diana_obj.position.x, 1, diana_obj.position.z)
        : new THREE.Vector3(0, 1, 0);

    const candidatos = generarCandidatos(ALT, target);

    let mejor = null;
    let mejorPunt = -Infinity;

    for (const pos of candidatos) {
        if (posicionDentroMuro(pos)) continue;
        if (pos.distanceTo(target) < DIST_MIN_DIANA_TIRO) continue;

        const test = contarArcosViables(pos, target);
        if (test.viables === 0) continue;

        const ratio = test.viables / test.total;
        let punt;

        if (ratio < 0.05) punt = -100;
        else if (ratio <= 0.34) punt = 100 - Math.abs(ratio - 0.21) * 300;
        else if (ratio <= 0.70) punt = 58 - ratio * 50;
        else punt = 8 - ratio * 26;

        if (punt > mejorPunt) {
            mejorPunt = punt;
            mejor = {
                pos: pos.clone(),
                arcosViables: test.viables,
                arcosTotales: test.total,
                dificultad: Math.max(1, Math.min(10, Math.round((1 - Math.min(ratio, 1)) * 10))),
            };
        }
    }

    return mejor;
}

function generarCandidatos(y, target) {
    const out = [];

    for (const z of zonas_navegables) {
        const cx = (z.xMin + z.xMax) / 2;
        const cz = (z.zMin + z.zMax) / 2;
        const w = z.xMax - z.xMin;
        const d = z.zMax - z.zMin;
        if (w < 9 || d < 9) continue;

        out.push(new THREE.Vector3(cx, y, cz));
        out.push(new THREE.Vector3(cx + (w * 0.25), y, cz - (d * 0.2)));
        out.push(new THREE.Vector3(cx - (w * 0.25), y, cz + (d * 0.2)));
    }

    for (const r of [56, 76, 98, 124, 152]) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
            out.push(new THREE.Vector3(
                target.x + Math.sin(a) * r,
                y,
                target.z + Math.cos(a) * r
            ));
        }
    }

    return out;
}

function contarArcosViables(origen, target) {
    const dir = target.clone().sub(origen).normalize();
    const yawBase = Math.atan2(-dir.x, -dir.z);

    const VEL = (typeof VEL_LANZAM === "number") ? VEL_LANZAM : 1.45;
    const YALZ = (typeof IMPULSO_Y === "number") ? IMPULSO_Y : 0.0;

    let viables = 0;
    let total = 0;

    const yawOffsets = [-0.25, -0.15, -0.08, 0, 0.08, 0.15, 0.25];
    const pitchOffsets = [0.08, 0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78];

    for (const dYaw of yawOffsets) {
        for (const pitch of pitchOffsets) {
            const yaw = yawBase + dYaw;
            const vel = new THREE.Vector3(
                -Math.sin(yaw) * Math.cos(pitch) * VEL,
                Math.sin(pitch) * VEL + YALZ,
                -Math.cos(yaw) * Math.cos(pitch) * VEL
            );

            total++;
            if (simularArco(origen, vel, target)) viables++;
        }
    }

    return { viables, total };
}

function simularArco(origen, velInicial, target) {
    const pos = origen.clone();
    const vel = velInicial.clone();
    const esfera = new THREE.Sphere(pos, 0.5);

    for (let step = 0; step < 300; step++) {
        vel.y -= 0.016;
        vel.multiplyScalar(0.9975);
        pos.add(vel);
        esfera.center.copy(pos);

        if (pos.distanceTo(target) < 7) return true;

        if (pos.y < 0.5) {
            pos.y = 0.5;
            vel.y = Math.abs(vel.y) * 0.4;
            vel.x *= 0.72;
            vel.z *= 0.72;
        }

        for (const caja of cajas_cache) {
            if (caja.intersectsSphere(esfera)) return false;
        }

        if (pos.distanceTo(target) > 360 || vel.length() < 0.03) return false;
    }

    return false;
}

function posicionDentroMuro(pos) {
    const test = new THREE.Box3(pos.clone().subScalar(0.45), pos.clone().addScalar(0.45));
    return cajas_cache.some(c => c.intersectsBox(test));
}

function posicionDentroMuroConColisionables(x, z, radio) {
    const esfera = new THREE.Sphere(new THREE.Vector3(x, 1, z), radio);
    for (const obj of colisionables) {
        const box = new THREE.Box3().setFromObject(obj);
        if (box.intersectsSphere(esfera)) return true;
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
