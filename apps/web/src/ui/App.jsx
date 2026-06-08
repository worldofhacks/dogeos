// App.jsx — root of the DogeSwap React UI. The Shell owns the device frame,
// header, nav, theming, and overlay slots. The SettingsProvider holds the
// persisted trade defaults + appearance (theme) that the Shell, SwapView and
// SwapFlow consume.
import React from "react";

import Shell from "./Shell.jsx";
import { SettingsProvider } from "./useSettings.js";

export default function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}
