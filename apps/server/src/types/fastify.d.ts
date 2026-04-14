import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Injected by the `authenticate` preHandler when a valid JWT is present.
     * Undefined on unauthenticated routes.
     */
    userId: string | undefined;
  }
}
