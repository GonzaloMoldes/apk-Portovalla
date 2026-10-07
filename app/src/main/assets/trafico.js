/* PortoValla Operadores · tráfico e impactos de las vallas
   Cada valla guarda sus conteos de tráfico (vehículos y personas por minuto) con la fecha,
   para recalcular cada cierto tiempo los impactos al día y ver cuánto vale cada valla.
   Usa el mismo contador de 1 minuto y la misma fórmula que Patrimonio (impactosDia). */

/** código → [{ fecha, vehiculosMin, personasMin, impactos }] ordenados por fecha */
let vallasTrafico = store.load('vallas_trafico') || {};
let vtHist = [];          // conteos de la valla que se está editando

function saveTrafico() { store.save('vallas_trafico', vallasTrafico); }

function recontarMeses() {
  return Number(settings.recontarMeses) || 6;
}

function ultimoConteo(code) {
  const h = vallasTrafico[code];
  return h && h.length ? h[h.length - 1] : null;
}

function impactosValla(code) {
  const c = ultimoConteo(code);
  return c ? Number(c.impactos) || 0 : 0;
}

function mesesDesde(iso) {
  const d = parseISO(iso);
  return d ? (Date.now() - d) / (86400000 * 30.44) : Infinity;
}

/** Hay conteo pero es más antiguo que el plazo de Ajustes → toca recontar. */
function conteoVencido(code) {
  const c = ultimoConteo(code);
  return !!c && mesesDesde(c.fecha) > recontarMeses();
}

function haceText(iso) {
  const m = mesesDesde(iso);
  if (!isFinite(m)) return '';
  const dias = Math.floor(m * 30.44);
  if (dias < 1) return 'hoy';
  if (dias < 45) return `hace ${dias} día${dias === 1 ? '' : 's'}`;
  const mm = Math.round(m);
  return `hace ${mm} meses`;
}

/** Coste por 1.000 impactos de una valla a su precio por mes. */
function cpmValla(precioMes, impDia) {
  const p = parseMoney(precioMes);
  return p && impDia ? p / (impDia * 30) * 1000 : 0;
}

function fmtCpm(n) {
  return n.toFixed(2).replace('.', ',') + ' €';
}

/** Insignias para las tarjetas del catálogo y del selector. */
function impactosBadge(code) {
  const c = ultimoConteo(code);
  if (!c) return '';
  const imp = Number(c.impactos) || 0;
  return (imp ? `<span class="badge imp" title="Conteo del ${esc(fmtDate(c.fecha))}">👁 ${fmtInt(imp)} impactos/día</span>` : '')
    + (conteoVencido(code) ? '<span class="badge volver">⏱ Recontar</span>' : '');
}

/* ------------------------------------------------------------- ficha de valla */

function traficoLoad(code) {
  vtHist = (vallasTrafico[code] || []).map(c => Object.assign({}, c));
  const form = $('#valla-form');
  const last = vtHist[vtHist.length - 1];
  form.elements.t_veh.value = last ? last.vehiculosMin : '';
  form.elements.t_per.value = last ? last.personasMin : '';
  form.elements.t_fecha.value = last ? last.fecha : '';
  renderTrafico();
}

function traficoForm() {
  const form = $('#valla-form');
  return { vehiculosMin: form.elements.t_veh.value.trim(), personasMin: form.elements.t_per.value.trim(),
    fecha: form.elements.t_fecha.value || todayISO() };
}

function renderTrafico() {
  const form = $('#valla-form');
  const t = traficoForm();
  const imp = impactosDia(t);
  const cat = form.elements.categoria.value;
  const precio = precioCategoria(cat);
  const cpm = cpmValla(precio, imp);
  $('#vf-impactos').innerHTML = imp
    ? `≈ ${fmtInt(imp)} impactos al día · ${fmtInt(imp * 30)} al mes`
      + (cpm ? `<br><span class="hint-inline">Precio categoría ${esc(cat)}: ${fmtMoney(parseMoney(precio))}/mes → ${fmtCpm(cpm)} por 1.000 impactos</span>` : '')
    : '';
  const last = vtHist[vtHist.length - 1];
  const estado = $('#vf-trafico-estado');
  if (!last) {
    estado.className = 'hint';
    estado.textContent = 'Todavía no hay conteos de tráfico de esta valla.';
  } else {
    const vencido = mesesDesde(last.fecha) > recontarMeses();
    estado.className = vencido ? 'aviso' : 'envio-info';
    estado.textContent = vencido
      ? `⏱ Toca recontar: el último conteo es del ${fmtDate(last.fecha)} (${haceText(last.fecha)}; se recuenta cada ${recontarMeses()} meses).`
      : `Último conteo: ${fmtDate(last.fecha)} (${haceText(last.fecha)}).`;
  }
  $('#vf-trafico-hist').innerHTML = vtHist.length ? `<label class="lbl">Historial de conteos</label>` + vtHist.slice().reverse().map((c, k) => {
    const i = vtHist.length - 1 - k;
    const prev = vtHist[i - 1];
    const dif = prev && Number(prev.impactos) ? Math.round((Number(c.impactos) - Number(prev.impactos)) / Number(prev.impactos) * 100) : null;
    return `<div class="row-item">
      <div class="ri-main"><b>${esc(fmtDate(c.fecha))} · ${fmtInt(Number(c.impactos) || 0)} impactos/día
        ${dif !== null ? `<span class="trend ${dif >= 0 ? 'up' : 'down'}">${dif >= 0 ? '▲' : '▼'} ${Math.abs(dif)}%</span>` : ''}</b>
        <span>🚗 ${esc(c.vehiculosMin || '0')}/min · 🚶 ${esc(c.personasMin || '0')}/min</span></div>
      <button type="button" class="vsel-x" data-vt-del="${i}" aria-label="Borrar conteo" title="Borrar conteo">${icon('close')}</button>
    </div>`;
  }).join('') : '';
}

/** Al guardar la valla: añade el conteo nuevo (o corrige el del mismo día). */
function traficoSave(codigo, anterior) {
  if (anterior && anterior !== codigo) delete vallasTrafico[anterior];
  const t = traficoForm();
  const hist = vtHist.slice();
  if (t.vehiculosMin || t.personasMin) {
    const rec = Object.assign(t, { impactos: String(impactosDia(t)) });
    const last = hist[hist.length - 1];
    const igual = last && last.vehiculosMin === rec.vehiculosMin && last.personasMin === rec.personasMin && last.fecha === rec.fecha;
    if (!igual) {
      const i = hist.findIndex(c => c.fecha === rec.fecha);
      if (i >= 0) hist[i] = rec; else hist.push(rec);
      hist.sort((a, b) => a.fecha.localeCompare(b.fecha));
    }
  }
  if (hist.length) vallasTrafico[codigo] = hist; else delete vallasTrafico[codigo];
  saveTrafico();
}

function traficoCount() {
  startCount((veh, per) => {
    const form = $('#valla-form');
    form.elements.t_veh.value = String(veh);
    form.elements.t_per.value = String(per);
    form.elements.t_fecha.value = todayISO();
    renderTrafico();
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.vt === 'count') { traficoCount(); return; }
  if (t.dataset.vtDel !== undefined) {
    const c = vtHist[Number(t.dataset.vtDel)];
    if (!c || !confirm(`¿Borrar el conteo del ${fmtDate(c.fecha)}?`)) return;
    vtHist.splice(Number(t.dataset.vtDel), 1);
    const form = $('#valla-form');
    const last = vtHist[vtHist.length - 1];
    if (form.elements.t_fecha.value === c.fecha) {
      form.elements.t_veh.value = last ? last.vehiculosMin : '';
      form.elements.t_per.value = last ? last.personasMin : '';
      form.elements.t_fecha.value = last ? last.fecha : '';
    }
    renderTrafico();
    toast('Se borrará al guardar la valla');
  }
});

$('#valla-form').addEventListener('input', e => {
  if (['t_veh', 't_per', 't_fecha'].includes(e.target.name)) renderTrafico();
});
