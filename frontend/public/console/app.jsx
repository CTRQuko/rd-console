// ============================================================
// Console Mockup — app.jsx
// Mounts the React tree.
// ============================================================

const App = () => (
  <ToastProvider>
    <Layout>
      <Router />
    </Layout>
  </ToastProvider>
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
