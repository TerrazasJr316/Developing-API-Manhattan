/*
// --- CONFIGURACIÓN INICIAL ---
const map = L.map('map').setView([19.4326, -99.1332], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);


// --- REFERENCIAS AL DOM ---
const info = document.getElementById('info');
const resultadosDetallados = document.getElementById('resultados-detallados');
const inicioSearchInput = document.getElementById('inicio-search-input'), destinoSearchInput = document.getElementById('destino-search-input'), buscarBtn = document.getElementById('buscar-btn');
const latInicioInput = document.getElementById('latInicio'), lngInicioInput = document.getElementById('lngInicio'), latDestinoInput = document.getElementById('latDestino'), lngDestinoInput = document.getElementById('lngDestino');
const coordsBtn = document.getElementById('calcularBtn'); 
const resetBtn = document.getElementById('reset-btn'), transporteBtns = document.querySelectorAll('.btn-transporte');

// --- ESTADO DE LA APLICACIÓN ---
let marcadorInicio, marcadorDestino, rutaLayer, rutaManhattanInicio, rutaManhattanFin, marcadorSimulacion, intervaloSimulacion;
let modoTransporte = 'driving';
let seleccionPaso = 0;

// --- CONSTANTES Y RANGOS DINÁMICOS ---
const VALORES_SIMULACION = {
  gasolina_rango_precio: [20.00, 25.00],
  consumo_km_por_litro: 14,
  co2_g_por_litro: 2392,
  tp_tarifas: { corta: { max_km: 10, costo: 13.00 }, media: { max_km: 40, costo: 35.00 }, larga: { costo: 50.00 } },
  costo_vuelo_por_km: 3.0,
  velocidad_promedio_tp: 40,
  velocidad_promedio_vuelo: 800,
  casetas: { costo_min: 20.00, costo_max: 120.00, dist_max_para_costo_max: 300 }
};
const DISTANCIAS = { CORTO: 50000, MEDIO: 1500000 };

// --- ORQUESTADORES DE ENTRADA ---
async function iniciarDesdeBusqueda() {
    const origenStr = inicioSearchInput.value.trim();
    const destinoStr = destinoSearchInput.value.trim();
    if (!origenStr || !destinoStr) { info.textContent = "Error: Ingresa un inicio y destino en la búsqueda."; return; }
    info.textContent = "Buscando...";
    try {
        const [origenCoords, destinoCoords] = await Promise.all([geocode(origenStr), geocode(destinoStr)]);
        if (!origenCoords) throw new Error("No se encontró la ubicación de inicio.");
        if (!destinoCoords) throw new Error("No se encontró la ubicación de destino.");
        actualizarInputsCoords(origenCoords, 'inicio');
        actualizarInputsCoords(destinoCoords, 'destino');
        await procesarRuta(origenCoords, destinoCoords);
    } catch (error) { info.textContent = `Error: ${error.message}`; }
}

function iniciarDesdeCoordenadas() {
    const [latIni, lngIni, latDes, lngDes] = [parseFloat(latInicioInput.value), parseFloat(lngInicioInput.value), parseFloat(latDestinoInput.value), parseFloat(lngDestinoInput.value)];
    if ([latIni, lngIni, latDes, lngDes].some(isNaN)) { info.textContent = "Error: Las coordenadas deben ser números válidos."; return; }
    procesarRuta(L.latLng(latIni, lngIni), L.latLng(latDes, lngDes));
}

function onMapClick(e) {
  if (seleccionPaso === 0) {
    limpiarTodo();
    marcadorInicio = L.marker(e.latlng).addTo(map).bindPopup("Inicio").openPopup();
    actualizarInputsCoords(e.latlng, 'inicio');
    info.textContent = "Excelente. Ahora selecciona el destino.";
    seleccionPaso = 1;
  } else if (seleccionPaso === 1) {
    marcadorDestino = L.marker(e.latlng).addTo(map).bindPopup("Destino").openPopup();
    actualizarInputsCoords(e.latlng, 'destino');
    seleccionPaso = 2;
    procesarRuta(marcadorInicio.getLatLng(), marcadorDestino.getLatLng());
  }
}

// --- LÓGICA CENTRAL ---
async function procesarRuta(puntoInicioOriginal, puntoDestinoOriginal) {
    limpiarRutaYSimulacion();
    colocarMarcadores(puntoInicioOriginal, puntoDestinoOriginal);
    info.textContent = "Calculando ruta inteligente...";
    map.fitBounds(L.latLngBounds(puntoInicioOriginal, puntoDestinoOriginal), { padding: [50, 50] });

    try {
        const [puntoInicioCarretera, puntoDestinoCarretera] = await Promise.all([
            encontrarPuntoMasCercano(puntoInicioOriginal),
            encontrarPuntoMasCercano(puntoDestinoOriginal)
        ]);
        dibujarManhattanDeConexion(puntoInicioOriginal, puntoInicioCarretera, 'inicio');
        dibujarManhattanDeConexion(puntoDestinoOriginal, puntoDestinoCarretera, 'fin');
        
        const esRutaCarretera = ['driving', 'walking', 'transit'].includes(modoTransporte);
        
        // Si no es ruta en carretera (vuelo), traza una línea recta.
        const datosRuta = esRutaCarretera 
            ? await obtenerGeometriaOSRM(puntoInicioCarretera, puntoDestinoCarretera)
            : { 
                route: { coordinates: [ [puntoInicioCarretera.lng, puntoInicioCarretera.lat], [puntoDestinoCarretera.lng, puntoDestinoCarretera.lat] ] },
                distance: puntoInicioCarretera.distanceTo(puntoDestinoCarretera), 
                duration: 0, 
                annotations: null 
              };
              
        rutaLayer = esRutaCarretera
            ? L.geoJSON(datosRuta.route, { style: { color: 'blue', weight: 5 } }).addTo(map)
            : L.polyline([puntoInicioCarretera, puntoDestinoCarretera], { color: 'purple', weight: 5, dashArray: '10, 10' }).addTo(map);
            
        const distanciaTotal = puntoInicioOriginal.distanceTo(puntoInicioCarretera) + datosRuta.distance + puntoDestinoCarretera.distanceTo(puntoDestinoOriginal);
        const costosAdicionales = calcularCostosAdicionales(datosRuta.annotations);
        
        actualizarDisponibilidadTransporte(distanciaTotal, costosAdicionales.contieneAutopista);
        mostrarResultados(distanciaTotal, datosRuta.duration, costosAdicionales.costoCasetas);
        
        if (datosRuta.route && datosRuta.route.coordinates && datosRuta.route.coordinates.length > 1) {
            iniciarSimulacion(datosRuta.route.coordinates);
        }
    } catch (error) {
        info.textContent = `Error al procesar: ${error.message}`;
        console.error(error);
    }
}

async function encontrarPuntoMasCercano(latlng) {
    // --- CORRECCIÓN CLAVE 1 ---
    // Se usa un perfil de OSRM ('walking' o 'driving') que coincide con el modo de transporte
    // seleccionado. Esto asegura que se busque la vía más lógica (ej. un sendero para peatones
    // si se va caminando, en lugar de forzar a una carretera para autos).
    const profile = (modoTransporte === 'walking') ? 'walking' : 'driving';
    const url = `https://router.project-osrm.org/nearest/v1/${profile}/${latlng.lng},${latlng.lat}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok' || !data.waypoints || data.waypoints.length === 0) {
        throw new Error(`No se encontró una vía (${profile}) cercana.`);
    }
    
    const location = data.waypoints[0].location;
    return L.latLng(location[1], location[0]);
}

function dibujarManhattanDeConexion(puntoOriginal, puntoCarretera, tipo) {
    // --- CORRECCIÓN CLAVE 2 ---
    // Se reduce el umbral de distancia de 10 a 1 metro. Esto asegura que CUALQUIER desvío
    // significativo entre el clic del usuario y la red de calles se visualice con una línea
    // de conexión Manhattan. Resuelve el problema en distancias cortas y hace el comportamiento más consistente.
    if (puntoOriginal.distanceTo(puntoCarretera) > 1) {
        const puntosManhattan = [
            puntoOriginal,
            L.latLng(puntoOriginal.lat, puntoCarretera.lng),
            puntoCarretera
        ];
        const capa = L.polyline(puntosManhattan, { color: 'red', weight: 5, dashArray: '5, 5' }).addTo(map);
        
        if (tipo === 'inicio') {
            rutaManhattanInicio = capa;
        } else {
            rutaManhattanFin = capa;
        }
    }
}


function actualizarDisponibilidadTransporte(distanciaMetros, contieneAutopista) {
    const [walkingBtn, drivingBtn, transitBtn, flightBtn] = [document.getElementById('mode-walking'), document.getElementById('mode-driving'), document.getElementById('mode-transit'), document.getElementById('mode-flight')];
    if (!walkingBtn) return; // Salida segura si los botones no existen
    
    [walkingBtn, drivingBtn, transitBtn, flightBtn].forEach(btn => btn.disabled = false);

    if (contieneAutopista) {
        walkingBtn.disabled = true;
        if (modoTransporte === 'walking') modoTransporte = 'driving';
    } else if (distanciaMetros > DISTANCIAS.CORTO) {
        walkingBtn.disabled = true;
        if (modoTransporte === 'walking') modoTransporte = 'driving';
    }

    if (distanciaMetros > DISTANCIAS.MEDIO) {
        drivingBtn.disabled = true;
        transitBtn.disabled = true;
        if (['driving', 'transit'].includes(modoTransporte)) modoTransporte = 'flight';
    }

    if (distanciaMetros < DISTANCIAS.MEDIO / 2) {
        flightBtn.disabled = true;
        if (modoTransporte === 'flight') modoTransporte = 'driving';
    }

    transporteBtns.forEach(btn => btn.classList.toggle('activo', btn.id.includes(modoTransporte)));
}

async function obtenerGeometriaOSRM(inicio, destino) {
    const profile = (modoTransporte === 'transit') ? 'driving' : modoTransporte;
    const url = `https://router.project-osrm.org/route/v1/${profile}/${inicio.lng},${inicio.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&annotations=true`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No se pudo generar una ruta en carretera/calle.');
    }
    
    return {
        route: data.routes[0].geometry,
        distance: data.routes[0].distance,
        duration: data.routes[0].duration,
        annotations: data.routes[0].legs[0].annotation
    };
}

function calcularCostosAdicionales(annotation) {
    let distanciaEnAutopistaKm = 0;
    let contieneAutopista = false;
    
    if (annotation && annotation.distance && annotation.speed) {
        for (let i = 0; i < annotation.distance.length; i++) {
            const velocidadKmh = annotation.speed[i] * 3.6;
            if (velocidadKmh > 80) { // Umbral para considerar autopista
                distanciaEnAutopistaKm += annotation.distance[i] / 1000;
                contieneAutopista = true;
            }
        }
    }

    let costoCasetas = 0;
    if (distanciaEnAutopistaKm > 0) {
        const { costo_min, costo_max, dist_max_para_costo_max } = VALORES_SIMULACION.casetas;
        const proporcion = Math.min(distanciaEnAutopistaKm / dist_max_para_costo_max, 1);
        costoCasetas = costo_min + (costo_max - costo_min) * proporcion;
    }

    return { costoCasetas, contieneAutopista };
}

function mostrarResultados(distanciaM, duracionS, costoCasetas = 0) {
    const distKm = distanciaM / 1000;
    let costoBase = 0, gasolina = 0, co2 = 0, tiempoEstimadoS = duracionS, infoExtra = '';
    
    const obtenerValorDinamico = (min, max) => Math.random() * (max - min) + min;

    switch (modoTransporte) {
        case 'driving':
            const precioGasolinaActual = obtenerValorDinamico(...VALORES_SIMULACION.gasolina_rango_precio);
            gasolina = distKm / VALORES_SIMULACION.consumo_km_por_litro;
            costoBase = gasolina * precioGasolinaActual;
            co2 = gasolina * VALORES_SIMULACION.co2_g_por_litro / 1000;
            if(resultadosDetallados) infoExtra = `<span><b>Precio Gasolina:</b> $${precioGasolinaActual.toFixed(2)}/L</span>`;
            if (costoCasetas > 0) infoExtra += `<span><b>Casetas:</b> $${costoCasetas.toFixed(2)}</span>`;
            break;
        case 'transit':
            if (distKm <= VALORES_SIMULACION.tp_tarifas.corta.max_km) costoBase = VALORES_SIMULACION.tp_tarifas.corta.costo;
            else if (distKm <= VALORES_SIMULACION.tp_tarifas.media.max_km) costoBase = VALORES_SIMULACION.tp_tarifas.media.costo;
            else costoBase = VALORES_SIMULACION.tp_tarifas.larga.costo;
            tiempoEstimadoS = (distKm / VALORES_SIMULACION.velocidad_promedio_tp) * 3600;
            if(resultadosDetallados) infoExtra = `<span><b>Tarifa TP:</b> Por tramo</span>`;
            break;
        case 'flight':
            tiempoEstimadoS = (distKm / VALORES_SIMULACION.velocidad_promedio_vuelo) * 3600;
            costoBase = distKm * VALORES_SIMULACION.costo_vuelo_por_km;
            break;
        case 'walking':
            // No hay costos directos para caminar
            costoBase = 0;
            break;
    }
    
    const costoTotal = costoBase + costoCasetas;
    const t = new Date((tiempoEstimadoS || 0) * 1000).toISOString().substr(11, 8);
    
    info.textContent = `Resumen de la ruta en ${modoTransporte}:`;
    if(resultadosDetallados) resultadosDetallados.innerHTML = `
        <span><b>Distancia:</b> ${distKm.toFixed(2)} km</span>
        <span><b>Tiempo:</b> ${t}</span>
        <span><b>Costo Total:</b> $${costoTotal.toFixed(2)} MXN</span>
        ${gasolina > 0 ? `<span><b>Gasolina:</b> ${gasolina.toFixed(2)} L</span>` : ''}
        ${co2 > 0 ? `<span><b>CO₂:</b> ${co2.toFixed(2)} kg</span>` : ''}
        ${infoExtra}
    `;
}

function iniciarSimulacion(coordenadas) {
    if (intervaloSimulacion) clearInterval(intervaloSimulacion);
    let indice = 0;
    marcadorSimulacion = L.marker(L.latLng(coordenadas[0][1], coordenadas[0][0]), {
        icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png', // URL de un ícono genérico de auto
            iconSize: [35, 35],
            iconAnchor: [17, 35]
        })
    }).addTo(map);

    intervaloSimulacion = setInterval(() => {
        if (indice >= coordenadas.length) {
            clearInterval(intervaloSimulacion);
            return;
        }
        marcadorSimulacion.setLatLng(L.latLng(coordenadas[indice][1], coordenadas[indice][0]));
        indice++;
    }, 100);
}

function limpiarRutaYSimulacion() {
    if (intervaloSimulacion) clearInterval(intervaloSimulacion);
    [rutaLayer, rutaManhattanInicio, rutaManhattanFin, marcadorSimulacion].forEach(capa => { if (capa) map.removeLayer(capa); });
    rutaLayer = rutaManhattanInicio = rutaManhattanFin = marcadorSimulacion = null;
    if(resultadosDetallados) resultadosDetallados.innerHTML = '';
}

function limpiarTodo() {
  limpiarRutaYSimulacion();
  if (marcadorInicio) map.removeLayer(marcadorInicio);
  if (marcadorDestino) map.removeLayer(marcadorDestino);
  marcadorInicio = marcadorDestino = null;
  seleccionPaso = 0;
  
  const inputsToClear = [inicioSearchInput, destinoSearchInput, latInicioInput, lngInicioInput, latDestinoInput, lngDestinoInput];
  inputsToClear.forEach(input => { if(input) input.value = ''; });

  if(transporteBtns) {
    transporteBtns.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('activo');
    });
    // Establecer 'driving' como activo por defecto
    const drivingBtn = document.getElementById('mode-driving');
    if (drivingBtn) drivingBtn.classList.add('activo');
    modoTransporte = 'driving';
  }

  info.textContent = "Selecciona inicio/destino: haz clic en el mapa, busca por nombre o introduce coordenadas.";
  map.setView([19.4326, -99.1332], 12);
}

function cambiarModoTransporte(e) {
    if (e.target.disabled) return;
    modoTransporte = e.target.id.split('-')[1];
    transporteBtns.forEach(btn => btn.classList.remove('activo'));
    e.target.classList.add('activo');

    if (marcadorInicio && marcadorDestino) {
        procesarRuta(marcadorInicio.getLatLng(), marcadorDestino.getLatLng());
    }
}

async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Servicio de geocodificación no disponible.');
    const data = await response.json();
    return (data && data.length > 0) ? L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon)) : null;
}

function actualizarInputsCoords(latlng, tipo) {
    const latInput = tipo === 'inicio' ? latInicioInput : latDestinoInput;
    const lngInput = tipo === 'inicio' ? lngInicioInput : lngDestinoInput;
    if (latInput && lngInput) {
      latInput.value = latlng.lat.toFixed(5);
      lngInput.value = latlng.lng.toFixed(5);
    }
}

function colocarMarcadores(inicio, destino) {
    if (marcadorInicio) map.removeLayer(marcadorInicio);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    marcadorInicio = L.marker(inicio).addTo(map).bindPopup("📍 Punto de Inicio").openPopup();
    marcadorDestino = L.marker(destino).addTo(map).bindPopup("🏁 Punto de Destino").openPopup();
}

// --- EVENT LISTENERS ---
if (buscarBtn) buscarBtn.addEventListener('click', iniciarDesdeBusqueda);
if (coordsBtn) coordsBtn.addEventListener('click', iniciarDesdeCoordenadas);
if (resetBtn) resetBtn.addEventListener('click', limpiarTodo);
if (transporteBtns) transporteBtns.forEach(btn => btn.addEventListener('click', cambiarModoTransporte));

map.on('click', onMapClick);

// --- INICIALIZACIÓN ---
limpiarTodo();
*/

// --- CONFIGURACIÓN INICIAL ---
const map = L.map('map').setView([19.4326, -99.1332], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

// --- REFERENCIAS AL DOM (AJUSTADAS AL NUEVO HTML) ---
const info = document.getElementById('info');
const resultadosDetallados = document.getElementById('resultados-detallados');
const inicioSearchInput = document.getElementById('inicio-search-input');
const destinoSearchInput = document.getElementById('destino-search-input');
const buscarBtn = document.getElementById('buscar-btn');
const latInicioInput = document.getElementById('latInicio');
const lngInicioInput = document.getElementById('lngInicio');
const latDestinoInput = document.getElementById('latDestino');
const lngDestinoInput = document.getElementById('lngDestino');
const coordsBtn = document.getElementById('coords-btn'); // ID actualizado
const resetBtn = document.getElementById('reset-btn');
const transporteBtns = document.querySelectorAll('.transport-btn'); // Clase actualizada

// --- ESTADO DE LA APLICACIÓN ---
let marcadorInicio, marcadorDestino, rutaLayer, rutaManhattanInicio, rutaManhattanFin, marcadorSimulacion, intervaloSimulacion;
let modoTransporte = 'driving';
let seleccionPaso = 0;

// --- CONSTANTES Y RANGOS DINÁMICOS ---
const VALORES_SIMULACION = {
  gasolina_rango_precio: [20.00, 25.00],
  consumo_km_por_litro: 14,
  co2_g_por_litro: 2392,
  tp_tarifas: { corta: { max_km: 10, costo: 13.00 }, media: { max_km: 40, costo: 35.00 }, larga: { costo: 50.00 } },
  costo_vuelo_por_km: 3.0,
  velocidad_promedio_tp: 40,
  velocidad_promedio_vuelo: 800,
  casetas: { costo_min: 20.00, costo_max: 120.00, dist_max_para_costo_max: 300 }
};
const DISTANCIAS = { CORTO: 50000, MEDIO: 1500000 };

// --- ORQUESTADORES DE ENTRADA ---
async function iniciarDesdeBusqueda() {
    const origenStr = inicioSearchInput.value.trim();
    const destinoStr = destinoSearchInput.value.trim();
    if (!origenStr || !destinoStr) { info.textContent = "Error: Ingresa un inicio y destino en la búsqueda."; return; }
    info.textContent = "Buscando...";
    try {
        const [origenCoords, destinoCoords] = await Promise.all([geocode(origenStr), geocode(destinoStr)]);
        if (!origenCoords) throw new Error("No se encontró la ubicación de inicio.");
        if (!destinoCoords) throw new Error("No se encontró la ubicación de destino.");
        actualizarInputsCoords(origenCoords, 'inicio');
        actualizarInputsCoords(destinoCoords, 'destino');
        await procesarRuta(origenCoords, destinoCoords);
    } catch (error) { info.textContent = `Error: ${error.message}`; }
}

function iniciarDesdeCoordenadas() {
    const [latIni, lngIni, latDes, lngDes] = [parseFloat(latInicioInput.value), parseFloat(lngInicioInput.value), parseFloat(latDestinoInput.value), parseFloat(lngDestinoInput.value)];
    if ([latIni, lngIni, latDes, lngDes].some(isNaN)) { info.textContent = "Error: Las coordenadas deben ser números válidos."; return; }
    procesarRuta(L.latLng(latIni, lngIni), L.latLng(latDes, lngDes));
}

function onMapClick(e) {
  if (seleccionPaso === 0) {
    limpiarTodo();
    marcadorInicio = L.marker(e.latlng).addTo(map).bindPopup("Inicio").openPopup();
    actualizarInputsCoords(e.latlng, 'inicio');
    info.textContent = "Excelente. Ahora selecciona el destino.";
    seleccionPaso = 1;
  } else if (seleccionPaso === 1) {
    marcadorDestino = L.marker(e.latlng).addTo(map).bindPopup("Destino").openPopup();
    actualizarInputsCoords(e.latlng, 'destino');
    seleccionPaso = 2;
    procesarRuta(marcadorInicio.getLatLng(), marcadorDestino.getLatLng());
  }
}

// --- LÓGICA CENTRAL ---
async function procesarRuta(puntoInicioOriginal, puntoDestinoOriginal) {
    limpiarRutaYSimulacion();
    colocarMarcadores(puntoInicioOriginal, puntoDestinoOriginal);
    info.textContent = "Calculando ruta inteligente...";
    map.fitBounds(L.latLngBounds(puntoInicioOriginal, puntoDestinoOriginal), { padding: [50, 50] });

    try {
        const [puntoInicioCarretera, puntoDestinoCarretera] = await Promise.all([
            encontrarPuntoMasCercano(puntoInicioOriginal),
            encontrarPuntoMasCercano(puntoDestinoOriginal)
        ]);
        dibujarManhattanDeConexion(puntoInicioOriginal, puntoInicioCarretera, 'inicio');
        dibujarManhattanDeConexion(puntoDestinoOriginal, puntoDestinoCarretera, 'fin');

        const esRutaCarretera = ['driving', 'walking', 'transit'].includes(modoTransporte);

        const datosRuta = esRutaCarretera
            ? await obtenerGeometriaOSRM(puntoInicioCarretera, puntoDestinoCarretera)
            : {
                route: { coordinates: [ [puntoInicioCarretera.lng, puntoInicioCarretera.lat], [puntoDestinoCarretera.lng, puntoDestinoCarretera.lat] ] },
                distance: puntoInicioCarretera.distanceTo(puntoDestinoCarretera),
                duration: 0,
                annotations: null
              };

        rutaLayer = esRutaCarretera
            ? L.geoJSON(datosRuta.route, { style: { color: 'blue', weight: 5 } }).addTo(map)
            : L.polyline([puntoInicioCarretera, puntoDestinoCarretera], { color: 'purple', weight: 5, dashArray: '10, 10' }).addTo(map);

        const distanciaTotal = puntoInicioOriginal.distanceTo(puntoInicioCarretera) + datosRuta.distance + puntoDestinoCarretera.distanceTo(puntoDestinoOriginal);
        const costosAdicionales = calcularCostosAdicionales(datosRuta.annotations);

        actualizarDisponibilidadTransporte(distanciaTotal, costosAdicionales.contieneAutopista);
        mostrarResultados(distanciaTotal, datosRuta.duration, costosAdicionales.costoCasetas);

        if (datosRuta.route && datosRuta.route.coordinates && datosRuta.route.coordinates.length > 1) {
            iniciarSimulacion(datosRuta.route.coordinates);
        }
    } catch (error) {
        info.textContent = `Error al procesar: ${error.message}`;
        console.error(error);
    }
}

async function encontrarPuntoMasCercano(latlng) {
    const profile = (modoTransporte === 'walking') ? 'walking' : 'driving';
    const url = `https://router.project-osrm.org/nearest/v1/${profile}/${latlng.lng},${latlng.lat}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.waypoints || data.waypoints.length === 0) {
        throw new Error(`No se encontró una vía (${profile}) cercana.`);
    }
    const location = data.waypoints[0].location;
    return L.latLng(location[1], location[0]);
}

function dibujarManhattanDeConexion(puntoOriginal, puntoCarretera, tipo) {
    if (puntoOriginal.distanceTo(puntoCarretera) > 1) {
        const puntosManhattan = [
            puntoOriginal,
            L.latLng(puntoOriginal.lat, puntoCarretera.lng),
            puntoCarretera
        ];
        const capa = L.polyline(puntosManhattan, { color: 'red', weight: 5, dashArray: '5, 5' }).addTo(map);
        if (tipo === 'inicio') rutaManhattanInicio = capa;
        else rutaManhattanFin = capa;
    }
}

function actualizarDisponibilidadTransporte(distanciaMetros, contieneAutopista) {
    const [walkingBtn, drivingBtn, transitBtn, flightBtn] = [document.getElementById('mode-walking'), document.getElementById('mode-driving'), document.getElementById('mode-transit'), document.getElementById('mode-flight')];
    if (!walkingBtn) return;

    [walkingBtn, drivingBtn, transitBtn, flightBtn].forEach(btn => btn.disabled = false);

    if (contieneAutopista) {
        walkingBtn.disabled = true;
        if (modoTransporte === 'walking') modoTransporte = 'driving';
    } else if (distanciaMetros > DISTANCIAS.CORTO) {
        walkingBtn.disabled = true;
        if (modoTransporte === 'walking') modoTransporte = 'driving';
    }

    if (distanciaMetros > DISTANCIAS.MEDIO) {
        drivingBtn.disabled = true;
        transitBtn.disabled = true;
        if (['driving', 'transit'].includes(modoTransporte)) modoTransporte = 'flight';
    }

    if (distanciaMetros < DISTANCIAS.MEDIO / 2) {
        flightBtn.disabled = true;
        if (modoTransporte === 'flight') modoTransporte = 'driving';
    }

    transporteBtns.forEach(btn => btn.classList.toggle('active', btn.id.includes(modoTransporte)));
}

async function obtenerGeometriaOSRM(inicio, destino) {
    const profile = (modoTransporte === 'transit') ? 'driving' : modoTransporte;
    const url = `https://router.project-osrm.org/route/v1/${profile}/${inicio.lng},${inicio.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&annotations=true`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No se pudo generar una ruta en carretera/calle.');
    }
    return {
        route: data.routes[0].geometry,
        distance: data.routes[0].distance,
        duration: data.routes[0].duration,
        annotations: data.routes[0].legs[0].annotation
    };
}

function calcularCostosAdicionales(annotation) {
    let distanciaEnAutopistaKm = 0;
    let contieneAutopista = false;
    if (annotation && annotation.distance && annotation.speed) {
        for (let i = 0; i < annotation.distance.length; i++) {
            const velocidadKmh = annotation.speed[i] * 3.6;
            if (velocidadKmh > 80) {
                distanciaEnAutopistaKm += annotation.distance[i] / 1000;
                contieneAutopista = true;
            }
        }
    }
    let costoCasetas = 0;
    if (distanciaEnAutopistaKm > 0) {
        const { costo_min, costo_max, dist_max_para_costo_max } = VALORES_SIMULACION.casetas;
        const proporcion = Math.min(distanciaEnAutopistaKm / dist_max_para_costo_max, 1);
        costoCasetas = costo_min + (costo_max - costo_min) * proporcion;
    }
    return { costoCasetas, contieneAutopista };
}

// --- FUNCIÓN DE RESULTADOS ACTUALIZADA PARA EL NUEVO DISEÑO ---
function mostrarResultados(distanciaM, duracionS, costoCasetas = 0) {
    const distKm = distanciaM / 1000;
    let costoBase = 0, gasolina = 0, co2 = 0, tiempoEstimadoS = duracionS, infoExtraHTML = '';

    const obtenerValorDinamico = (min, max) => Math.random() * (max - min) + min;

    switch (modoTransporte) {
        case 'driving':
            const precioGasolinaActual = obtenerValorDinamico(...VALORES_SIMULACION.gasolina_rango_precio);
            gasolina = distKm / VALORES_SIMULACION.consumo_km_por_litro;
            costoBase = gasolina * precioGasolinaActual;
            co2 = gasolina * VALORES_SIMULACION.co2_g_por_litro / 1000;
            infoExtraHTML += `<div class="result-row"><span class="result-label">Precio Gasolina</span><span class="result-value">$${precioGasolinaActual.toFixed(2)}/L</span></div>`;
            if (costoCasetas > 0) infoExtraHTML += `<div class="result-row"><span class="result-label">Casetas</span><span class="result-value">$${costoCasetas.toFixed(2)}</span></div>`;
            break;
        case 'transit':
            if (distKm <= VALORES_SIMULACION.tp_tarifas.corta.max_km) costoBase = VALORES_SIMULACION.tp_tarifas.corta.costo;
            else if (distKm <= VALORES_SIMULACION.tp_tarifas.media.max_km) costoBase = VALORES_SIMULACION.tp_tarifas.media.costo;
            else costoBase = VALORES_SIMULACION.tp_tarifas.larga.costo;
            tiempoEstimadoS = (distKm / VALORES_SIMULACION.velocidad_promedio_tp) * 3600;
            infoExtraHTML = `<div class="result-row"><span class="result-label">Tarifa TP</span><span class="result-value">Por tramo</span></div>`;
            break;
        case 'flight':
            tiempoEstimadoS = (distKm / VALORES_SIMULACION.velocidad_promedio_vuelo) * 3600;
            costoBase = distKm * VALORES_SIMULACION.costo_vuelo_por_km;
            break;
        case 'walking':
            costoBase = 0;
            break;
    }

    const costoTotal = costoBase + costoCasetas;
    const t = new Date((tiempoEstimadoS || 0) * 1000).toISOString().substr(11, 8);
    let html = '';

    const capitalizar = str => str.charAt(0).toUpperCase() + str.slice(1);
    
    info.textContent = `Resumen de la ruta en ${modoTransporte}:`;
    
    // Construir el HTML de resultados con el nuevo diseño
    html += `<div class="result-header"><span class="result-label">Ruta en ${capitalizar(modoTransporte)}</span><span class="result-value">${distKm.toFixed(2)} km</span></div>`;
    html += `<div class="result-row"><span class="result-label">Tiempo Estimado</span><span class="result-value highlight">${t}</span></div>`;
    html += `<div class="result-row"><span class="result-label">Costo Total</span><span class="result-value highlight">$${costoTotal.toFixed(2)} MXN</span></div>`;
    if (gasolina > 0) html += `<div class="result-row"><span class="result-label">Gasolina</span><span class="result-value">${gasolina.toFixed(2)} L</span></div>`;
    if (co2 > 0) html += `<div class="result-row"><span class="result-label">CO₂ Emitido</span><span class="result-value">${co2.toFixed(2)} kg</span></div>`;
    html += infoExtraHTML;
    
    if (resultadosDetallados) {
        resultadosDetallados.innerHTML = html;
    }
}


function iniciarSimulacion(coordenadas) {
    if (intervaloSimulacion) clearInterval(intervaloSimulacion);
    let indice = 0;
    marcadorSimulacion = L.marker(L.latLng(coordenadas[0][1], coordenadas[0][0]), {
        icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
            iconSize: [35, 35],
            iconAnchor: [17, 35]
        })
    }).addTo(map);

    intervaloSimulacion = setInterval(() => {
        if (indice >= coordenadas.length) {
            clearInterval(intervaloSimulacion);
            return;
        }
        marcadorSimulacion.setLatLng(L.latLng(coordenadas[indice][1], coordenadas[indice][0]));
        indice++;
    }, 100);
}

function limpiarRutaYSimulacion() {
    if (intervaloSimulacion) clearInterval(intervaloSimulacion);
    [rutaLayer, rutaManhattanInicio, rutaManhattanFin, marcadorSimulacion].forEach(capa => { if (capa) map.removeLayer(capa); });
    rutaLayer = rutaManhattanInicio = rutaManhattanFin = marcadorSimulacion = null;
    if(resultadosDetallados) resultadosDetallados.innerHTML = '<div class="result-row"><span class="result-label">Esperando cálculo...</span></div>';
}

function limpiarTodo() {
  limpiarRutaYSimulacion();
  if (marcadorInicio) map.removeLayer(marcadorInicio);
  if (marcadorDestino) map.removeLayer(marcadorDestino);
  marcadorInicio = marcadorDestino = null;
  seleccionPaso = 0;

  const inputsToClear = [inicioSearchInput, destinoSearchInput, latInicioInput, lngInicioInput, latDestinoInput, lngDestinoInput];
  inputsToClear.forEach(input => { if(input) input.value = ''; });

  if(transporteBtns) {
    transporteBtns.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('active');
    });
    const drivingBtn = document.getElementById('mode-driving');
    if (drivingBtn) drivingBtn.classList.add('active');
    modoTransporte = 'driving';
  }

  info.textContent = "Selecciona inicio/destino: haz clic en el mapa, busca por nombre o introduce coordenadas.";
  map.setView([19.4326, -99.1332], 12);
}

function cambiarModoTransporte(e) {
    const targetBtn = e.currentTarget;
    if (targetBtn.disabled) return;
    
    modoTransporte = targetBtn.id.split('-')[1];
    transporteBtns.forEach(btn => btn.classList.remove('active'));
    targetBtn.classList.add('active');

    if (marcadorInicio && marcadorDestino) {
        procesarRuta(marcadorInicio.getLatLng(), marcadorDestino.getLatLng());
    }
}

async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Servicio de geocodificación no disponible.');
    const data = await response.json();
    return (data && data.length > 0) ? L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon)) : null;
}

function actualizarInputsCoords(latlng, tipo) {
    const latInput = tipo === 'inicio' ? latInicioInput : latDestinoInput;
    const lngInput = tipo === 'inicio' ? lngInicioInput : lngDestinoInput;
    if (latInput && lngInput) {
      latInput.value = latlng.lat.toFixed(5);
      lngInput.value = latlng.lng.toFixed(5);
    }
}

function colocarMarcadores(inicio, destino) {
    if (marcadorInicio) map.removeLayer(marcadorInicio);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    marcadorInicio = L.marker(inicio).addTo(map).bindPopup("📍 Punto de Inicio").openPopup();
    marcadorDestino = L.marker(destino).addTo(map).bindPopup("🏁 Punto de Destino").openPopup();
}

// --- EVENT LISTENERS ---
if (buscarBtn) buscarBtn.addEventListener('click', iniciarDesdeBusqueda);
if (coordsBtn) coordsBtn.addEventListener('click', iniciarDesdeCoordenadas);
if (resetBtn) resetBtn.addEventListener('click', limpiarTodo);
if (transporteBtns) transporteBtns.forEach(btn => btn.addEventListener('click', cambiarModoTransporte));

map.on('click', onMapClick);

// --- INICIALIZACIÓN ---
limpiarTodo();