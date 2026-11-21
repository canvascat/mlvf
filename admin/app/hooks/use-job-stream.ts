import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useTRPC } from "@/lib/trpc";

/** 服务端只推「哪些任务变了」，这里据此让相关查询失效重取。 */
export function useJobStream(): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useSubscription(
    trpc.jobs.subscribe.subscriptionOptions(undefined, {
      onData: () => {
        for (const key of [
          trpc.jobs.pathKey(),
          trpc.overview.pathKey(),
          trpc.releases.pathKey(),
          trpc.library.pathKey(),
          trpc.history.pathKey(),
        ]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      },
    }),
  );
}
