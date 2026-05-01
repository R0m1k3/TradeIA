import { FastifyInstance } from 'fastify';
import { addCycleJob } from '../queue';
import { runPipeline } from '../agents/orchestrator';

export default async function orchestratorRoutes(fastify: FastifyInstance) {
  fastify.post('/run', async (request, reply) => {
    // Force run bypasses pause — this is a manual trigger
    runPipeline().catch(err => console.error('[API] Manual run failed:', err));
    return { status: 'triggered', message: 'Orchestrator pipeline started in background' };
  });
}