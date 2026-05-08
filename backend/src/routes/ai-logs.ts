import type { FastifyInstance } from 'fastify';
import { listAILogs, getAILogPayload, getAllAILogsPayloads, deleteAILog, deleteAllAILogs } from '../utils/ai-logger';

export default async function aiLogsRoutes(app: FastifyInstance) {
  // GET /api/ai-logs — list metadata (no payload)
  app.get('/', async (_req, reply) => {
    const logs = await listAILogs();
    return reply.send(logs);
  });

  // GET /api/ai-logs/download — all logs as JSON download
  app.get('/download', async (_req, reply) => {
    const logs = await getAllAILogsPayloads();
    reply.header('Content-Disposition', `attachment; filename="ai-logs-${new Date().toISOString().slice(0, 10)}.json"`);
    reply.header('Content-Type', 'application/json');
    return reply.send(JSON.stringify(logs, null, 2));
  });

  // GET /api/ai-logs/:id/download — single log as JSON download
  app.get('/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const payload = await getAILogPayload(id);
    if (!payload) return reply.status(404).send({ error: 'Log not found' });
    reply.header('Content-Disposition', `attachment; filename="ai-log-${id}.json"`);
    reply.header('Content-Type', 'application/json');
    return reply.send(JSON.stringify(payload, null, 2));
  });

  // DELETE /api/ai-logs — delete all logs
  app.delete('/', async (_req, reply) => {
    const count = await deleteAllAILogs();
    return reply.send({ deleted: count });
  });

  // DELETE /api/ai-logs/:id — delete single log
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteAILog(id);
    if (!ok) return reply.status(404).send({ error: 'Log not found' });
    return reply.send({ deleted: id });
  });
}
