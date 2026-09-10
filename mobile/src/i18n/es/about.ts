/**
 * Spanish for About (app info, settings, links), Contact, the Editorial team
 * screens and the chrome around the legal documents. Keys are the exact English
 * strings used in code; words shared across screens live in common.ts.
 *
 * The legal documents themselves (content/legal.ts) stay in English — only their
 * titles and the surrounding labels are translated.
 */
const es: Record<string, string> = {
  // About — app summary
  'PillSeek identifies pills from photos and by imprint, colour and shape, using FDA labelling data and a catalogue of 14,000 pill images. Free, ad-light and built for the moment you need an answer.':
    'PillSeek identifica pastillas con fotos y por grabado, color y forma, usando datos de las etiquetas de la FDA y un catálogo de 14,000 imágenes de pastillas. Gratis, con poca publicidad y hecho para el momento en que necesita una respuesta.',

  // About — how it works
  'How it works': 'Cómo funciona',
  'Photograph both sides': 'Fotografíe ambas caras',
  'Fit the pill in the circle guide, in good light.': 'Coloque la pastilla dentro del círculo, con buena luz.',
  'We read the imprint': 'Leemos el grabado',
  'Our own reader decodes the letters and numbers, plus colour and shape.':
    'Nuestro propio lector descifra las letras y los números, además del color y la forma.',
  'Matched against 14,000 pills': 'Comparación con 14,000 pastillas',
  'Ranked candidates from FDA labelling data, with photos to compare.':
    'Candidatas ordenadas según los datos de las etiquetas de la FDA, con fotos para comparar.',

  // About — settings
  'Keep my photos to improve the reader': 'Conservar mis fotos para mejorar el lector',
  "Photos are stored without any personal details and used only to train PillSeek's imprint reader. Turn off to keep them private.":
    'Las fotos se guardan sin ningún dato personal y se usan solo para entrenar el lector de grabados de PillSeek. Desactive esta opción para mantenerlas privadas.',
  'Reader status': 'Estado del lector',
  'Reader status: {status}. Refresh': 'Estado del lector: {status}. Actualizar',
  'Checking…': 'Comprobando…',
  Unreachable: 'No disponible',
  'Online · {mode} mode': 'En línea · modo {mode}',
  Paused: 'En pausa',

  // About — more
  More: 'Más',
  'Editorial team': 'Equipo editorial',
  'Who reviews PillSeek content': 'Quién revisa el contenido de PillSeek',
  'Contact us': 'Contáctenos',
  'Questions, data corrections, feedback': 'Preguntas, correcciones de datos, comentarios',
  'Privacy policy': 'Política de privacidad',
  'Terms of use': 'Términos de uso',
  'Medical disclaimer': 'Aviso médico',
  'web preview': 'vista previa web',
  'Made in the USA with FDA data.': 'Hecho en EE. UU. con datos de la FDA.',

  // Contact
  Contact: 'Contacto',
  'Found a data error, have a question, or want to report a problem? We usually reply within 2–3 business days.':
    '¿Encontró un error en los datos, tiene una pregunta o quiere reportar un problema? Normalmente respondemos en 2–3 días hábiles.',
  Subject: 'Asunto',
  Question: 'Pregunta',
  'Data error': 'Error en los datos',
  Feedback: 'Comentarios',
  Other: 'Otro',
  'Your name': 'Su nombre',
  'Your email': 'Su correo electrónico',
  Message: 'Mensaje',
  'Which pill, and what is wrong? Include the imprint if you can.': '¿Cuál es la pastilla y qué está mal? Incluya el grabado si puede.',
  'How can we help?': '¿Cómo podemos ayudarle?',
  'Send message': 'Enviar mensaje',
  'Message sent': 'Mensaje enviado',
  'Unable to send your message right now. Please try again later.': 'No se pudo enviar su mensaje en este momento. Intente de nuevo más tarde.',
  'Or email us directly': 'O escríbanos directamente por correo',

  // Editorial team
  'Licensed professionals who review PillSeek content for accuracy against FDA, DailyMed and RxNorm sources.':
    'Profesionales con licencia que revisan el contenido de PillSeek y verifican su exactitud con las fuentes de la FDA, DailyMed y RxNorm.',
  'Could not load the editorial team.': 'No se pudo cargar el equipo editorial.',
  Reviewer: 'Revisor',
  'Medical reviewer': 'Revisor médico',
  Author: 'Autor',
  Editor: 'Editor',
  Education: 'Formación académica',
  Registration: 'Registro',
  Registrations: 'Registros',
  'LinkedIn profile': 'Perfil de LinkedIn',
  "That reviewer profile isn't available. Here is the current team.": 'Ese perfil de revisor no está disponible. Este es el equipo actual.',
  'No team members listed yet.': 'Aún no hay miembros del equipo.',
  'Pill identification data on PillSeek is pulled verbatim from government sources. Our team does not author drug content; it verifies that what you see matches the FDA label.':
    'Los datos de identificación de pastillas en PillSeek se toman textualmente de fuentes gubernamentales. Nuestro equipo no redacta el contenido de los medicamentos; verifica que lo que usted ve coincida con la etiqueta de la FDA.',

  // Legal — titles and surrounding labels only; the documents stay in English
  'Privacy Policy': 'Política de privacidad',
  'Terms of Use': 'Términos de uso',
  'Medical Disclaimer': 'Aviso médico',
  'Last updated: {date}': 'Última actualización: {date}',
  'This policy is available in English only.': 'Esta política está disponible solo en inglés.',
}
export default es
