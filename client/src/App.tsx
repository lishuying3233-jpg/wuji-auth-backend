import { Route, Switch, Redirect } from "wouter";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ path, component: Component }: { path: string; component: any }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Route path={path} component={Component} />;
}

function RootRedirect() {
  return <Redirect to="/login" />;
}

export default function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-rose-50">
      <Switch>
        <Route path="/" component={RootRedirect} />
        <Route path="/home" component={Home} />
        <Route path="/login" component={Login} />
        <ProtectedRoute path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}
