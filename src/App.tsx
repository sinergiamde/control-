import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import Results from "./pages/Results";
import Admin from "./pages/Admin";
import History from "./pages/History";
import Clients from "./pages/Clients";
import ClientDashboard from "./pages/ClientDashboard";
import GeneralDashboard from "./pages/GeneralDashboard";
import Passwords from "./pages/Passwords";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <LanguageProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              {/* Everything behind login shares TaxForYou's sidebar (general dashboard, clients,
                  admin tools). */}
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<GeneralDashboard />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/clients/:clientId" element={<ClientDashboard />} />
                <Route path="/results" element={<Results />} />
                <Route path="/history" element={<History />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/passwords" element={<Passwords />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
