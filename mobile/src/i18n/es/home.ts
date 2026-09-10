/**
 * Spanish for the launcher, welcome flow, tab bar, Search, Recent and the shared
 * status components (offline banner, error card). Keys are the exact English
 * strings used in code; words shared across screens live in common.ts.
 */
const es: Record<string, string> = {
  // Tab bar
  Main: 'Principal',

  // Home
  'Identify. Understand. Be sure.': 'Identifique. Entienda. Esté seguro.',
  'Search by imprint, name or NDC': 'Buscar por grabado, nombre o NDC',
  Features: 'Funciones',
  'Photo ID': 'Foto',
  'Imprint search': 'Buscar por grabado',
  'Drug name': 'Nombre del medicamento',
  'NDC lookup': 'Buscar NDC',
  'Side effects': 'Efectos secundarios',
  Dosage: 'Dosis',
  'Medication guide': 'Guía del medicamento',
  'Professional info': 'Información profesional',
  'Price guide': 'Guía de precios',
  Interactions: 'Interacciones',
  'My cabinet': 'Mi botiquín',
  About: 'Acerca de',
  '(opens pillseek.com)': '(abre pillseek.com)',
  'Recently viewed': 'Vistos recientemente',
  'See all': 'Ver todos',

  // Welcome
  'Welcome to PillSeek': 'Bienvenido a PillSeek',
  'Camera access': 'Acceso a la cámara',
  'Identify a pill from a photo': 'Identifique una pastilla con una foto',
  'Snap both sides and PillSeek reads the imprint for you.': 'Fotografíe ambas caras y PillSeek lee el grabado por usted.',
  'Every FDA-listed pill, with photos to compare.': 'Todas las pastillas registradas en la FDA, con fotos para comparar.',
  'Understand what you take': 'Entienda lo que toma',
  'Dosage, side effects, guides, interactions and prices.': 'Dosis, efectos secundarios, guías, interacciones y precios.',
  'Let PillSeek use the camera': 'Permita que PillSeek use la cámara',
  'The camera is only used to photograph a pill when you tap Identify. Photos are analysed and discarded unless you choose to keep them.':
    'La cámara solo se usa para fotografiar una pastilla cuando toca Identificar. Las fotos se analizan y se descartan, a menos que elija conservarlas.',
  'Nothing is recorded in the background.': 'No se graba nada en segundo plano.',
  'Allow camera access': 'Permitir acceso a la cámara',
  'Not now': 'Ahora no',

  // Status components
  'No internet connection': 'Sin conexión a internet',
  'Something went wrong': 'Algo salió mal',

  // Search
  'Search type': 'Tipo de búsqueda',
  Imprint: 'Grabado',
  'Imprint, e.g. S 10': 'Grabado, p. ej. S 10',
  'Drug name, e.g. Lisinopril': 'Nombre del medicamento, p. ej. Lisinopril',
  'NDC, e.g. 0093-1174-01': 'NDC, p. ej. 0093-1174-01',
  Suggestions: 'Sugerencias',
  Colour: 'Color',
  'Any colour': 'Cualquier color',
  Shape: 'Forma',
  'Any shape': 'Cualquier forma',
  'Find a pill': 'Encuentre una pastilla',
  'Type the letters or numbers printed on the pill, and narrow it down by colour and shape.':
    'Escriba las letras o números impresos en la pastilla y filtre por color y forma.',
  'Start typing a brand or generic name and pick it from the list.': 'Empiece a escribir el nombre comercial o genérico y elíjalo de la lista.',
  'Type the National Drug Code from the packaging; matches appear as you type.':
    'Escriba el Código Nacional de Medicamento (NDC) del envase; las coincidencias aparecen mientras escribe.',
  'No results': 'Sin resultados',
  'Check the spelling, try fewer characters, or remove the colour and shape filters.':
    'Revise la ortografía, pruebe con menos caracteres o quite los filtros de color y forma.',
  'Clear filters': 'Quitar filtros',
  'Search failed. Please try again.': 'La búsqueda falló. Intente de nuevo.',
  'Could not load pills.': 'No se pudieron cargar las pastillas.',
  '1 drug': '1 medicamento',
  '{n} drugs': '{n} medicamentos',
  '1 result': '1 resultado',
  '{n} results': '{n} resultados',
  'for “{q}”': 'para “{q}”',
  'No exact name match — showing results for {term} (generic equivalent).': 'No hay coincidencia exacta del nombre; se muestran resultados para {term} (equivalente genérico).',
  'Load more ({n} left)': 'Cargar más ({n} restantes)',
  '{n} pills': '{n} pastillas',
  '1 pill': '1 pastilla',
  'Choose a strength': 'Elija una concentración',
  'Other strengths': 'Otras concentraciones',
  'No pills listed for this strength.': 'No hay pastillas registradas para esta concentración.',
  'Imprint {imprint}': 'Grabado {imprint}',
  'Stop looking for {goal}': 'Dejar de buscar {goal}',

  // Goal banner prompts (lib/goals.ts)
  'Find a drug to see its side effects': 'Busque un medicamento para ver sus efectos secundarios',
  'Find a drug to see how it is taken': 'Busque un medicamento para ver cómo se toma',
  'Find a drug to read its medication guide': 'Busque un medicamento para leer su guía',
  'Find a drug to see its prescribing information': 'Busque un medicamento para ver su información de prescripción',
  'Find a drug to see what it costs': 'Busque un medicamento para ver cuánto cuesta',

  // Recent
  Recent: 'Recientes',
  'Your last 20 identifications and searches': 'Sus últimas 20 identificaciones y búsquedas',
  'Clear all': 'Borrar todo',
  'Nothing here yet': 'Aún no hay nada',
  'Pills you identify or search for will show up here, stored only on this device.':
    'Las pastillas que identifique o busque aparecerán aquí, guardadas solo en este dispositivo.',
  'Identify a pill': 'Identificar una pastilla',
  'Swipe left or press and hold an item to delete it.': 'Deslice a la izquierda o mantenga presionado un elemento para eliminarlo.',
  'Just now': 'Ahora mismo',
  '{n} min ago': 'hace {n} min',
  '{n} hr ago': 'hace {n} h',
  '1 day ago': 'hace 1 día',
  '{n} days ago': 'hace {n} días',
  'Read “{imprint}”': 'Se leyó “{imprint}”',
  'No match found': 'Sin coincidencias',
  'Filtered search': 'Búsqueda filtrada',
  '{pct}% match': '{pct}% de coincidencia',
  '1 candidate': '1 candidata',
  '{n} candidates': '{n} candidatas',
  'Photo identification': 'Identificación por foto',
  '{type} search': 'Búsqueda por {type}',
  'Delete {title}': 'Eliminar {title}',
  Delete: 'Eliminar',
  '{title}, {subtitle}. Open': '{title}, {subtitle}. Abrir',
  Removed: 'Eliminado',
  'History cleared': 'Historial borrado',
  Identification: 'Identificación',
  'Run search again': 'Repetir la búsqueda',
  'Open {name}': 'Abrir {name}',
  'pill page': 'página de la pastilla',
  'Identify again': 'Identificar de nuevo',
  'Clear history?': '¿Borrar el historial?',
  'This removes all recent identifications and searches from this device.': 'Esto elimina todas las identificaciones y búsquedas recientes de este dispositivo.',
}
export default es
