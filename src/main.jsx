import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary, { installClientErrorHandlers } from "./components/ErrorBoundary";
import { ShopProvider } from "./context/ShopContext";

installClientErrorHandlers();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary name="app">
        <ShopProvider>
          <App />
        </ShopProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>
);
