import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AdminApp } from "./admin";
import { isConfigured } from "./config";
import { Student } from "./student";

let useHash = () => {
  let [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    let onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
};

let App = () => {
  let hash = useHash();
  if (!isConfigured())
    return (
      <div className="loading">
        Supabase is not configured. Set VITE_SUPABASE_URL and
        VITE_SUPABASE_ANON_KEY.
      </div>
    );
  return hash === "#admin" ? <AdminApp /> : <Student />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
