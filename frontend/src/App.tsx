import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import { TradesProvider } from "@/context/TradesProvider";

function App() {
  return (
    <TradesProvider>
      <RouterProvider router={router} />
    </TradesProvider>
  );
}

export default App;
