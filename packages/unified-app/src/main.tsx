import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./i18n";
import "./styles/globals.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          // react-hot-toast renders outside the React tree, so it is themed by
          // the .ph-toast rule in globals.css rather than by Tailwind classes.
          className: "ph-toast",
          success: { iconTheme: { primary: "var(--ph-success-solid)", secondary: "var(--ph-surface-raised)" } },
          error:   { iconTheme: { primary: "var(--ph-danger-solid)",  secondary: "var(--ph-surface-raised)" } },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
);