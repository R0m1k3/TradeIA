import { FastifyInstance } from 'fastify';
import { runPipeline } from '../agents/orchestrator';

export default async function orchestratorRoutes(fastify: FastifyInstance) {
  fastify.post('/run', async (request, reply) => {
    // Run in background to avoid timeout
    runPipeline().catch(err => console.error('[API] Manual run failed:', err));
    return { status: 'triggered', message: 'Orchestrator pipeline started in background' };
  });
}
