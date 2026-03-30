// ============================================================
// NUEVO CASO A AGREGAR EN LA FUNCIÓN doGet() del Apps Script
// Dentro del switch/if que maneja req:
//
//   } else if (req === "saldos") {
//     return saldosPorMedioCaja(params);
//   }
// ============================================================

function saldosPorMedioCaja(params) {
  var ano = parseInt(params.ano);
  var mes = parseInt(params.mes);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shFin = ss.getSheetByName("FINANZAS");
  var shMP  = ss.getSheetByName("MEDIOS_PAGO");
  var shCB  = ss.getSheetByName("CAJAS_BANCOS");

  // ── 1. Leer tabla maestra MEDIOS_PAGO ──────────────────────
  // Columnas: CODIGO(A), DESCRIPCION(B), TIPO(C), CLIPROV(D), GRUPO(E), ALIAS(F), CODBANCO(G), ORDEN(H), SALDOML(I), SALDOME(J), SALDOME_ACT(K)
  var mpData = shMP.getDataRange().getValues();
  var mpMap  = {}; // key = DESCRIPCION (tal como aparece en FINANZAS)
  for (var i = 1; i < mpData.length; i++) {
    var desc = mpData[i][1];
    if (!desc) continue;
    mpMap[desc] = {
      codigo : mpData[i][0],
      tipo   : mpData[i][2],
      grupo  : mpData[i][4],   // EF, CB_BCO, CH, DOC, DEV, CRED, RTAV, RTAF, BONO, CRIPV, CRIPE
      orden  : mpData[i][7]
    };
  }

  // ── 2. Leer tabla maestra CAJAS_BANCOS ─────────────────────
  // Columnas: CODIGO(A), DESCRIPCION(B), ALIAS(C), CLIPROV(D), GRUPO(E), ORDEN(F), TIPO(G), SALDOML(H), SALDOME(I)
  var cbData = shCB.getDataRange().getValues();
  var cbMap  = {}; // key = DESCRIPCION
  for (var j = 1; j < cbData.length; j++) {
    var cbDesc = cbData[j][1];
    if (!cbDesc) continue;
    cbMap[cbDesc] = {
      codigo : cbData[j][0],
      alias  : cbData[j][2],
      grupo  : cbData[j][4],   // AHORROS | INVERSIONES
      orden  : cbData[j][5],
      tipo   : cbData[j][6]    // BANCO | BROKER | EFECTIVO | BV | WC
    };
  }

  // ── 3. Leer FINANZAS ────────────────────────────────────────
  // Columnas: FECHA(A), TIPO(B), CONCEPTO(C), MEDIOPAGO(D), CAJA/BANCO(E), DESCRIPCION(F),
  //           IMPORTEML(G), IMPORTEME(H), AÑO(I), MES(J), DIA(K), ID(L), ...
  var finData = shFin.getDataRange().getValues();

  // Fecha de corte: primer día del mes seleccionado
  var fechaCorte = new Date(ano, mes - 1, 1); // mes-1 porque JS es 0-indexed

  // Mapa de acumulación: key = "MEDIOPAGO||CAJA/BANCO"
  var mapa = {};

  function getKey(mp, cb) { return mp + "||" + cb; }

  for (var r = 2; r < finData.length; r++) { // fila 2 = totales, saltear; fila 1 = headers
    var fila  = finData[r];
    var fecha = fila[0];
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) continue;

    var tipo     = fila[1];
    var mpNombre = fila[3]; // MEDIOPAGO
    var cbNombre = fila[4]; // CAJA/BANCO
    var iml      = parseFloat(fila[6]) || 0; // IMPORTEML
    var ime      = parseFloat(fila[7]) || 0; // IMPORTEME
    var fAno     = parseInt(fila[8]) || 0;
    var fMes     = parseInt(fila[9]) || 0;

    if (!mpNombre || !cbNombre) continue;

    var key = getKey(mpNombre, cbNombre);
    if (!mapa[key]) {
      mapa[key] = {
        mp         : mpNombre,
        cb         : cbNombre,
        mpGrupo    : (mpMap[mpNombre]  || {}).grupo  || "",
        mpTipo     : (mpMap[mpNombre]  || {}).tipo   || "",
        mpOrden    : (mpMap[mpNombre]  || {}).orden  || 999,
        cbGrupo    : (cbMap[cbNombre]  || {}).grupo  || "",
        cbTipo     : (cbMap[cbNombre]  || {}).tipo   || "",
        cbOrden    : (cbMap[cbNombre]  || {}).orden  || 999,
        inicialML  : 0,
        inicialME  : 0,
        periodoML  : 0,
        periodoME  : 0
      };
    }

    var esMismoMes = (fAno === ano && fMes === mes);
    var esAnterior = fecha < fechaCorte;

    if (esAnterior) {
      mapa[key].inicialML += iml;
      mapa[key].inicialME += ime;
    } else if (esMismoMes) {
      mapa[key].periodoML += iml;
      mapa[key].periodoME += ime;
    }
    // movimientos futuros (ano/mes > seleccionado) se ignoran
  }

  // ── 4. Construir resultado ──────────────────────────────────
  var resultado = [];
  for (var k in mapa) {
    var e = mapa[k];
    var finalML = e.inicialML + e.periodoML;
    var finalME = e.inicialME + e.periodoME;

    // Solo incluir filas con algún movimiento
    if (Math.abs(finalML) < 0.01 && Math.abs(finalME) < 0.01 &&
        Math.abs(e.inicialML) < 0.01 && Math.abs(e.inicialME) < 0.01) continue;

    // Clasificar como inversión si:
    // - El GRUPO de MEDIOS_PAGO es RTAV, RTAF, BONO, CRIPV, CRIPE
    // - O el GRUPO de CAJAS_BANCOS es INVERSIONES
    var mpGruposInv = ["RTAV","RTAF","BONO","CRIPV","CRIPE"];
    var esInversion = mpGruposInv.indexOf(e.mpGrupo) >= 0 || e.cbGrupo === "INVERSIONES";

    resultado.push({
      mp        : e.mp,
      cb        : e.cb,
      mpGrupo   : e.mpGrupo,
      mpTipo    : e.mpTipo,
      mpOrden   : e.mpOrden,
      cbGrupo   : e.cbGrupo,
      cbTipo    : e.cbTipo,
      cbOrden   : e.cbOrden,
      esInv     : esInversion,
      iniML     : Math.round(e.inicialML * 100) / 100,
      iniME     : Math.round(e.inicialME * 100000) / 100000,
      perML     : Math.round(e.periodoML * 100) / 100,
      perME     : Math.round(e.periodoME * 100000) / 100000,
      finML     : Math.round(finalML * 100) / 100,
      finME     : Math.round(finalME * 100000) / 100000
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: resultado }))
    .setMimeType(ContentService.MimeType.JSON);
}
