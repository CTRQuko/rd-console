// Root component. Hands off to the shell <Layout/> which owns route
// state, auth gate, theme, sidebar, topbar, command palette and
// renders the active page via <Router/>.
import { ToastProvider } from "./components/primitives";
import { Layout } from "./shell/Layout";

export function App() {
  return (
    <ToastProvider>
      <Layout />
    </ToastProvider>
  );
}
