import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../../server/router";
import { createContext } from "../../../server/trpc/context";

const handle = ({ request }: { request: Request }) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createContext(),
  });

export const Route = createFileRoute("/api/trpc/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
