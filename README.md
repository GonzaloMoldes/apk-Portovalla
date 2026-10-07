# PortoValla Operadores (APK Android)

App sencilla para registrar las visitas comerciales desde la tablet, guardar todo en un
**Excel** y mandar el **seguimiento por email o WhatsApp** a cada lead.

## Qué hace

- **Registrar visitas** con las mismas columnas que la plantilla semanal
  (`PORTO VALLA – GONZALO – SEMANA`): tipo, PVS, fecha, fecha firma, razón social,
  persona de contacto, teléfono, población, provincia, correo, situación, PVP entrada,
  PVP total, volver (Sí/No), % y fecha de trabajo realizado.
- **Casi todo con botones**: tipo, fecha (Hoy / Ayer), población (las últimas usadas),
  provincia, volver y %. La **situación** se marca con botones acumulativos (se pueden
  marcar varios) y una nota libre opcional. Las opciones de situación se editan en Ajustes.
- **Escáner de tarjetas de visita (OCR)**: con *Escanear tarjeta* se hace una foto (o se
  elige de la galería) y la app lee el texto sin conexión (Google ML Kit) y rellena empresa,
  contacto, teléfono (prefiere el móvil), correo, población y provincia (por el código
  postal). El cargo, otro teléfono o la web se añaden a la nota. En la pantalla de revisión
  cada línea leída tiene botones (Empresa, Contacto, Teléfono, Correo, Población) para
  corregir lo que no se haya reconocido bien. La foto no se guarda.
- **Excel automático**: cada vez que guardas, la app reescribe
  `Descargas/PortoValla/Visitas_Leads.xlsx` con:
  - una hoja **TODAS** con todas las visitas,
  - una hoja por semana, con el mismo nombre que usas ahora (`1º JUNIO`, `2º JUNIO`…),
  - los mismos desplegables (Tipo, Provincia, Volver, %), fechas y euros con formato,
    filtros y cabecera fija,
  - una columna extra **SEGUIMIENTO ENVIADO** (p. ej. `Email · Gracias tras hablar · 05/10/2026`).
- **Seguimiento tras la visita**: al guardar una visita nueva se prepara el mensaje solo:
  - si la lead tiene **correo** → email (asunto y texto con plantilla),
  - si solo tiene **móvil** (6xx/7xx) → WhatsApp,
  - si solo hay fijo → no se envía nada (queda el botón *Llamar*).

  Hay **3 modelos de mensaje**, cada uno en versión email y WhatsApp:
  1. *Gracias tras hablar*: agradecer después de hablar con el propietario o responsable.
  2. *Dejé mis datos*: pasé por la empresa y dejé mis datos (haya hablado o no con el responsable).
  3. *Info en breve*: aviso de que en breve le envío información.

  La app propone uno (modelo 2 si no hay persona de contacto o la situación dice que no
  estaba o que se dejaron datos; modelo 3 si habla de presupuesto o propuesta; si no, el 1) y
  se puede cambiar antes de enviar. Se abre la app de correo o WhatsApp con el mensaje ya
  escrito y solo hay que pulsar *Enviar*. Las visitas tipo *Visita Patrimonio* no generan
  mensaje.
- **Presupuesto de vallas**: al marcar *PIDE PRESUPUESTO* aparece la tarjeta
  *Presupuesto*:
  - *Elegir vallas* abre el catálogo con foto, código `OOH-XXX`, dirección, municipio,
    medida y categoría (con buscador, filtro por zona y botón *Ver en mapa*);
  - ¿periodo de la campaña? Mensual, Trimestral, Semestral, Anual o *Elegir fechas*
    (con un periodo fijo, la fecha de fin se calcula sola desde la de inicio);
  - ¿tipo de material? Papel, Lona ligera, Lona pesada o Vinilo;
  - **precio por mes y valla** y precio del material por valla (sin IVA).
    Alquiler por valla = precio/mes × meses del periodo (1, 3, 6, 12; con fechas a medida,
    por días). Total = (alquiler + material) × nº de vallas; si *PVP total* está vacío se
    rellena con ese total. *📄 Generar PDF* crea el PDF y lo guarda en el historial.

  **Envío del presupuesto**: si la visita tiene vallas, al enviar se propone el modelo
  *Presupuesto* (4º modelo), cuyo texto incluye `{detalle}`: cada valla con código,
  dirección, medida, categoría y enlace a Google Maps, más periodo, material, precio por
  valla y total. Además se adjunta un **PDF** (*Propuesta de campaña publicitaria*) con
  los datos del cliente, el resumen y una ficha por valla con su **foto**, ubicación y
  precio. El PDF se guarda en `Descargas/PortoValla/Presupuestos`. En WhatsApp se abre
  directamente el chat del número con el PDF adjunto.

  En el Excel se añade la hoja **PRESUPUESTOS** con una fila por valla: visita, código,
  dirección, municipio, medida, categoría, latitud, longitud, enlace *Ver mapa*, periodo,
  fechas, material, precios y la **foto** de la valla. En los mensajes se pueden usar
  `{vallas}` (lista de vallas) y `{presupuesto}` (resumen).
- **Diseño**: barra inferior **fija** (no se mueve con el scroll; cada pantalla se desplaza
  por debajo) con todas las áreas: **Visitas · Clientes · Patrimonio · Trabajos · Vallas ·
  Ajustes**. La cabecera solo lleva **iconos** (mantén pulsado para ver qué hace cada uno) y
  los elementos nuevos se crean con el botón dorado **＋** de abajo a la derecha. Con el
  teclado abierto se ocultan la barra inferior y el botón para dejar sitio.
  En la cabecera de cada área, el icono **⇅** sirve para **exportar** su Excel
  (compartir o abrir) o **importarlo** (actualiza por ID/código/nº y añade los nuevos; no
  borra nada). Visitas admite también el Excel antiguo de seguimiento semanal.
- **Clientes**: datos (nombre, CIF, contacto, teléfono, correo, dirección…), **vallas
  contratadas** (contratos con desde/hasta, precio por mes, campaña), **historial de
  documentos** (cada PDF de presupuesto generado queda guardado con su cliente para
  abrirlo o reenviarlo) y sus visitas, trabajos y ventas. Desde una visita, *👤 Cliente*.
- **Disponibilidad de las vallas**: 🟢 Disponible, 🔴 Ocupada (con qué cliente y hasta
  cuándo) o 🟡 Consultar. Un contrato en vigor de un cliente la marca como ocupada; si no,
  se marca a mano en la ficha de la valla. Filtro por disponibilidad en el catálogo y
  marca en el selector de vallas del presupuesto.
- **Venta de artículos en la visita**: en el presupuesto de la visita, además del alquiler
  de vallas, se pueden añadir **vinilos, lonas, rotulado de vehículos, estructuras de valla**
  u otros artículos (descripción, medida, cantidad y precio). El total del presupuesto suma
  vallas + artículos, y los artículos salen en el mensaje, en el PDF (tabla de artículos) y
  en la hoja PRESUPUESTOS del Excel (una fila por artículo).
  **🛠 Pasar a trabajos** (en el presupuesto o en la tarjeta de la visita) crea el trabajo
  *Instalar lona* con las vallas y la **venta** con los artículos y el cliente. Si ya
  existían no se duplican (la venta se puede actualizar con los artículos del presupuesto).
- **Ventas** en Trabajos: además de trabajos en vallas, ventas de vinilos, lonas,
  rotulado de vehículos, estructuras de valla u otros artículos, con cliente, cantidad,
  precio e importe (también se pueden crear directamente desde Trabajos).
- **Copia de seguridad** (Ajustes): todos los datos en un fichero JSON para pasarlos a otra
  tablet o restaurarlos.
- **Email**: abre **Gmail** directamente (o Outlook / correo de Samsung) con el PDF adjunto.
- **Fotos en las visitas**: cualquier registro (lead, propietario, cliente…) puede llevar
  una o varias fotos (cámara o galería). La primera sale en la lista y en la columna FOTO
  del Excel.
- **Patrimonio (negociaciones con propietarios)**: para negociar la instalación de vallas
  en una finca. Propietario y contacto; ubicación (dirección, municipio, coordenadas por GPS
  o enlace, fotos); emplazamiento (soporte, nº de vallas, medida, caras, iluminación);
  visibilidad (vehículos y personas por minuto —con un **contador de 1 minuto** a base de
  botones—, segundos que se ve, distancia, sentido) con **impactos/día estimados**
  ((vehículos × 1,3 + personas) × 60 × 14 h) y coste por 1.000 impactos; precio pedido,
  ofrecido y acordado (€/año por valla), duración, forma de pago y total del contrato;
  estado (contacto inicial, en negociación, oferta enviada, ganada, perdida), próximo
  contacto y notas. Se crea a mano o con *🏠 Negociación* desde una visita a un
  propietario. **Ganada** → *Pasar a patrimonio y crear trabajo de montaje*: añade las
  vallas al catálogo (propone los siguientes códigos OOH libres) y abre el trabajo
  *Montaje de valla*. **📤 Excel** de negociaciones (una fila por negociación, con foto).
- **Vallas (catálogo editable)**: buscar y filtrar por zona y municipio, tocar una valla para
  **editarla** (dirección, zona, municipio, provincia, medida, categoría, coordenadas y
  foto) o **＋ Nueva valla** para añadir una. Para la foto: *Hacer foto* o *Desde
  galería*; para las coordenadas: *Usar mi ubicación* (GPS), escribirlas o pegar un enlace
  de Google Maps. Las vallas del catálogo original se pueden eliminar o *Volver al
  original*. Los cambios se guardan en la tablet y se usan en presupuestos y trabajos.
- **Trabajos en vallas**: desbrozar, instalar lona, desinstalar lona, retirar lona, cambio
  de lona, arreglo / reparación, revisión u otro (se pueden marcar varios), sobre una o
  varias vallas, con fecha prevista, prioridad (urgente), persona o equipo asignado,
  cliente/campaña, material, instrucciones, estado (pendiente, en curso, hecho), fecha
  realizado y observaciones. Lista filtrable por estado y persona, con botón *✓ Hecho*.
  **Desde un presupuesto**: *🛠 Pasar a trabajos* crea el trabajo *Instalar lona* con las
  vallas, el cliente, el material, la fecha de inicio de la campaña y las instrucciones ya
  puestos (y la venta, si hay artículos).
  **Icono de enviar (Excel para el equipo)**: elige qué trabajos (pendientes o todos) y para quién, y se crea
  `Descargas/PortoValla/Trabajos/Trabajos_<persona>_<fecha>.xlsx` con una fila por
  valla (dirección, enlace al mapa, foto, instrucciones, estado con desplegable…) para
  **compartirlo** por WhatsApp, email, etc. o abrirlo.
- **Iconos** de la cabecera de Visitas: *tabla* = abrir el Excel, *compartir* = enviarlo
  por correo, Drive, WhatsApp…
- **Ajustes**: tu nombre, empresa, teléfono y correo, textos de los 3 modelos
  (variables `{contacto}`, `{empresa}`, `{poblacion}`, `{fecha}`, `{comercial}`,
  `{miEmpresa}`, `{miTelefono}`, `{miEmail}`), nombre del Excel y respuestas rápidas
  de *Situación*.

Los datos se guardan dentro de la tablet (no se suben a ningún servidor).

## Instalarla en la tablet

1. En la tablet, abre la **última versión**:
   <https://github.com/GonzaloMoldes/apk-Portovalla/releases/latest>
   y descarga el fichero `PortoValla-Operadores-1.0.N.apk`.
2. Ábrelo. Android pedirá permitir *Instalar apps desconocidas* para el navegador
   (o el gestor de archivos): actívalo y pulsa **Instalar**.
3. Para actualizar, instala la APK nueva encima: se conservan las visitas.

> No desinstales la app para actualizar: al desinstalar se borran las visitas guardadas
> dentro de la app (el Excel de Descargas sí se queda).

Requisitos: Android 8.0 o superior.

## Compilar

La APK se compila sola con GitHub Actions
(`.github/workflows/build-apk.yml`) en cada push y se publica en *Releases*.

En local (con Android Studio o el SDK de Android instalado):

```bash
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

La APK se firma con `app/visitas.keystore` (incluida a propósito para que todas las
versiones tengan la misma firma y se puedan instalar encima).

## Catálogo de vallas

Las vallas salen de los PDF del catálogo (una valla por página). Para añadir o actualizar:

```bash
pip install pypdf pdfplumber   # y poppler-utils (pdftotext, pdftoppm)
python3 tools/extraer_vallas.py "A CORUÑA.pdf" "LUGO.pdf" "PUEBLOS A CORUÑA.pdf"
```

Genera `app/src/main/assets/vallas.js` y las fotos en `app/src/main/assets/vallas/`.
La zona se toma del nombre del PDF y las coordenadas del enlace *Ver Street View*.
Los errores del PDF (por ejemplo, una página con la cabecera de otra valla) se corrigen en
`tools/correcciones.json` (zona → nº de página → campos).

Catálogo actual: A Coruña (29), Lugo (60) y Pueblos A Coruña (132) = 221 vallas.
Sin foto en el PDF: OOH-2337, 2338, 2339, 877 y 879. Dirección pendiente de revisar:
OOH-190 y OOH-172 (el PDF repite la cabecera de OOH-189).

## Estructura

- `app/src/main/assets/` — interfaz (HTML/CSS/JS). Se puede probar abriendo
  `index.html` en un navegador (guarda en `localStorage`).
- `app/src/main/java/.../MainActivity.java` — WebView + puente con Android
  (guardar datos, escribir el Excel en Descargas, abrir correo/WhatsApp).
- `app/src/main/java/.../XlsxWriter.java` — generador de `.xlsx` sin dependencias.
