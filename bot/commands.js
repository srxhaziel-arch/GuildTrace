export const commands = [
  { name: 'mapa', description: 'Consulta los gremios de un mapa de Zona Negra.', type: 1,
    options: [{ name: 'nombre', description: 'Nombre del mapa', type: 3, required: true, autocomplete: true, min_length: 1, max_length: 100 }] },
  { name: 'gremio', description: 'Consulta los mapas donde aparece un gremio.', type: 1,
    options: [{ name: 'nombre', description: 'Nombre del gremio', type: 3, required: true, autocomplete: true, min_length: 1, max_length: 100 }] },
];
