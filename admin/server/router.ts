import { createCallerFactory, router } from "./trpc/init";
import { historyRouter } from "./trpc/routers/history";
import { jobsRouter } from "./trpc/routers/jobs";
import { libraryRouter } from "./trpc/routers/library";
import { overviewRouter } from "./trpc/routers/overview";
import { releasesRouter } from "./trpc/routers/releases";
import { seasonsRouter } from "./trpc/routers/seasons";
import { settingsRouter } from "./trpc/routers/settings";
import { systemRouter } from "./trpc/routers/system";

export const appRouter = router({
  overview: overviewRouter,
  library: libraryRouter,
  jobs: jobsRouter,
  releases: releasesRouter,
  seasons: seasonsRouter,
  history: historyRouter,
  settings: settingsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
