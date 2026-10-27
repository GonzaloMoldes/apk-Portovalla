/* PortoValla Operadores · grupos de opciones compactos
   Cualquier grupo de botones (.chips) con más de 5 opciones muestra como mucho 5 elementos:
   las opciones elegidas, las primeras de la lista y «🔍 N más…». Ese botón abre un
   desplegable con buscador (5 opciones a la vista y el resto con scroll). Al elegir en el
   desplegable se pulsa el botón original, así que cada pantalla sigue funcionando igual.
   Se aplica solo, también a las listas que crecen con el uso (clientes, poblaciones…).
   Para excluir un grupo: atributo data-sin-desplegable. */

const DD_MAX = 5;
let ddGrupo = null;        // grupo .chips abierto en el desplegable

function ddChips(box) {
  return [...box.children].filter(el => el.classList.contains('chip') && !el.classList.contains('dd-mas'));
}

function ddNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Deja visibles como mucho 5 elementos del grupo (los elegidos siempre). Idempotente. */
function compactarChips(box) {
  if (!box || box.dataset.sinDesplegable !== undefined) return;
  const chips = ddChips(box);
  let mas = box.querySelector(':scope > .dd-mas');
  if (chips.length <= DD_MAX) {
    chips.forEach(c => { if (c.classList.contains('dd-oculto')) c.classList.remove('dd-oculto'); });
    if (mas) mas.remove();
    return;
  }
  const visibles = new Set(chips.filter(c => c.classList.contains('active')));
  for (const c of chips) { if (visibles.size >= DD_MAX - 1) break; visibles.add(c); }
  chips.forEach(c => { const ocultar = !visibles.has(c); if (c.classList.contains('dd-oculto') !== ocultar) c.classList.toggle('dd-oculto', ocultar); });
  const n = chips.length - visibles.size;
  if (!n) { if (mas) mas.remove(); return; }
  const texto = `🔍 ${n} más…`;
  if (!mas) {
    mas = document.createElement('button');
    mas.type = 'button';
    mas.className = 'chip dd-mas';
    box.appendChild(mas);
  } else if (mas !== box.lastElementChild) box.appendChild(mas);
  if (mas.textContent !== texto) mas.textContent = texto;
}

/* ------------------------------------------------------------- desplegable con buscador */

function abrirDesplegable(box) {
  ddGrupo = box;
  const titulo = box.getAttribute('aria-label') || box.dataset.titulo || ddTitulo(box);
  $('#dd-titulo').textContent = titulo;
  $('#dd-buscar').value = '';
  renderDesplegable();
  $('#dd-modal').hidden = false;
  setTimeout(() => $('#dd-buscar').focus(), 50);
}

/** Título: la etiqueta que hay justo antes del grupo (p. ej. «Situación»), si la hay. */
function ddTitulo(box) {
  let el = box.previousElementSibling;
  while (el && !/^(LABEL|H2|H3|P|SPAN)$/.test(el.tagName)) el = el.previousElementSibling;
  const t = el && el.textContent.trim().split('\n')[0];
  return t && t.length < 60 ? t.replace(/\s*\(.*\)\s*$/, '') : 'Elegir';
}

function renderDesplegable() {
  if (!ddGrupo) return;
  const q = ddNorm($('#dd-buscar').value.trim());
  const chips = ddChips(ddGrupo);
  const multi = ddGrupo.classList.contains('multi');
  const lista = chips.filter(c => !q || q.split(/\s+/).every(w => ddNorm(c.textContent).includes(w)));
  $('#dd-info').textContent = `${lista.length} de ${chips.length}${multi ? ' · puedes marcar varias' : ''}`;
  $('#dd-lista').innerHTML = lista.map(c => {
    const i = chips.indexOf(c);
    return `<button type="button" class="dd-item${c.classList.contains('active') ? ' active' : ''}" data-dd="${i}">
      <span class="dd-check">${c.classList.contains('active') ? '✓' : ''}</span><span>${esc(c.textContent.trim())}</span></button>`;
  }).join('') || '<p class="hint">Nada coincide con la búsqueda.</p>';
}

function elegirDesplegable(i) {
  const box = ddGrupo;
  const chip = ddChips(box)[i];
  if (!chip) return;
  chip.click();
  // El grupo puede haberse vuelto a pintar: se busca otra vez por su id
  if (box.id && !document.body.contains(box)) ddGrupo = document.getElementById(box.id);
  if (ddGrupo && ddGrupo.classList.contains('multi') && document.body.contains(ddGrupo)) renderDesplegable();
  else cerrarDesplegable();
}

function cerrarDesplegable() {
  $('#dd-modal').hidden = true;
  ddGrupo = null;
}

/* ------------------------------------------------------------- observar la pantalla */

let ddPendientes = new Set();
let ddProgramado = false;

function ddProgramar(box) {
  if (box) ddPendientes.add(box);
  if (ddProgramado) return;
  ddProgramado = true;
  queueMicrotask(() => {
    ddProgramado = false;
    const grupos = [...ddPendientes];
    ddPendientes = new Set();
    grupos.forEach(compactarChips);
    if (ddGrupo && !$('#dd-modal').hidden) renderDesplegable();
  });
}

new MutationObserver(muts => {
  for (const m of muts) {
    const t = m.target;
    if (!(t instanceof Element)) continue;
    if (t.classList.contains('chips')) ddProgramar(t);
    else if (t.classList.contains('chip') && t.parentElement && t.parentElement.classList.contains('chips')) {
      if (m.type === 'attributes' && (m.oldValue || '').includes('active') === t.classList.contains('active')) continue;
      ddProgramar(t.parentElement);
    } else if (m.type === 'childList') t.querySelectorAll('.chips').forEach(b => ddProgramar(b));
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

document.querySelectorAll('.chips').forEach(b => compactarChips(b));

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.classList.contains('dd-mas')) { e.stopPropagation(); abrirDesplegable(t.parentElement); return; }
  if (t.dataset.dd !== undefined) { e.stopPropagation(); elegirDesplegable(Number(t.dataset.dd)); return; }
  if (t.id === 'dd-cerrar') { cerrarDesplegable(); }
}, true);
$('#dd-buscar').addEventListener('input', renderDesplegable);
$('#dd-modal').addEventListener('click', e => { if (e.target.id === 'dd-modal') cerrarDesplegable(); });

const ddHandleBack = window.handleBack;
window.handleBack = function () {
  if (!$('#dd-modal').hidden) { cerrarDesplegable(); return true; }
  return ddHandleBack();
};
