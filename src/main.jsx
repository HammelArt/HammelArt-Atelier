import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CurationProvider } from "./utils/curation";
import { hydrateSharedSessionState } from "./utils/sessionSync";
import "./styles.css";

hydrateSharedSessionState().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <CurationProvider>
        <App />
      </CurationProvider>
    </React.StrictMode>
  );
});
