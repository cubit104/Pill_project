/**
 * Spanish for the API error titles and messages defined in src/lib/api.ts.
 * Those are plain English constants on the error object; ErrorCard passes them
 * through t() at render, so the keys here must match them exactly.
 */
const es: Record<string, string> = {
  // ---- Titles (DEFAULT_TITLES in api.ts) ----
  "You're offline": 'Está sin conexión',
  'That took too long': 'Tardó demasiado',
  Cancelled: 'Cancelado',
  'Photo is too large': 'La foto es demasiado grande',
  "Couldn't read that photo": 'No se pudo leer esa foto',
  'Something was missing': 'Faltó algo',
  'Slow down a moment': 'Espere un momento',
  'Warming up': 'Preparando',
  'Not found': 'No encontrado',

  // ---- Messages ----
  'No internet connection. Reconnect and try again.': 'Sin conexión a internet. Vuelva a conectarse e inténtelo de nuevo.',
  'No internet connection': 'Sin conexión a internet',
  'The server did not answer in time. Check your connection and try again.':
    'El servidor no respondió a tiempo. Revise su conexión e inténtelo de nuevo.',
  'Request cancelled.': 'Solicitud cancelada.',
  'The PillSeek server had a problem. Please try again.': 'El servidor de PillSeek tuvo un problema. Inténtelo de nuevo.',
  'The pill reader is warming up. Give it a minute and try again.': 'El lector se está preparando. Espere un minuto e inténtelo de nuevo.',
  'You have reached the limit of 30 photo identifications per hour. Please try again a little later.':
    'Alcanzó el límite de 30 identificaciones por foto por hora. Inténtelo un poco más tarde.',
  'That photo is over 20 MB. Try taking it again with the in-app camera.':
    'Esa foto pesa más de 20 MB. Vuelva a tomarla con la cámara de la aplicación.',
  "We couldn't make out a pill in that photo. Fill the circle with the pill in good light and try again.":
    'No pudimos distinguir una pastilla en esa foto. Llene el círculo con la pastilla, con buena luz, e inténtelo de nuevo.',
  'Photo identification is switched off right now. You can still search by imprint, name or NDC.':
    'La identificación por foto está desactivada por ahora. Aún puede buscar por grabado, nombre o NDC.',
  'Please add an imprint, or pick a colour or shape.': 'Agregue un grabado, o elija un color o una forma.',
  "We couldn't find that.": 'No encontramos eso.',
  "We couldn't reach PillSeek to check the photo reader. You can still search by imprint.":
    'No pudimos conectar con PillSeek para revisar el lector de fotos. Aún puede buscar por grabado.',
  'No FDA label is linked to this pill.': 'Esta pastilla no tiene un etiquetado de la FDA vinculado.',
  'No FDA label found for this drug.': 'No se encontró etiquetado de la FDA para este medicamento.',
}
export default es
