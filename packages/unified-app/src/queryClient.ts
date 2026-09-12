import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient.
 *
 * It used to be constructed separately in each entry point
 * (`unified-app/src/main.tsx` for Electron, `web/src/main.tsx` for the web
 * build) with the same options written twice. It lives here now because session
 * teardown needs to reach it from OUTSIDE React: the 401 response interceptors
 * in each department's `api/client.ts` are plain axios modules, not components,
 * so they cannot call `useQueryClient()` -- and without access to the cache a
 * expired session would leave the previous user's data sitting in it.
 *
 * See `src/session.ts`.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
