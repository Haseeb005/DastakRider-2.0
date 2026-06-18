import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import RiderApp from "@/pages/RiderApp";

// Keep every view in sync with the live MongoDB: poll on an interval and refetch
// whenever the tab regains focus or the network reconnects. Per-query intervals
// (e.g. faster polling for available/active orders) still override these defaults.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 5_000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RiderApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
