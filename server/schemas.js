// Schémas Fastify partagés : validation et coercition des paramètres de
// route et de requête. Un identifiant invalide renvoie un 400 explicite
// au lieu d'une erreur SQL.

export const ID_OPTS = {
  schema: {
    params: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1 } },
      required: ['id'],
    },
  },
};

export const RUN_LIST_OPTS = {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        warehouseId: { type: 'integer', minimum: 1 },
        scenarioId: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
};
