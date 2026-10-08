import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { UserRole } from "../db/schema.js";

// What goes inside the token. The organization comes from here — signed by the
// server — so a user can never act on another organization by changing a request.
export type AuthUser = { sub: string; org: string; role: UserRole };

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerAuth(app: FastifyInstance, secret: string) {
  if (secret.length < 32) throw new Error("JWT secret must have at least 32 characters");
  await app.register(fastifyJwt, { secret, sign: { expiresIn: "8h" } });

  // Used as a preHandler on protected routes: no valid token, no access.
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
