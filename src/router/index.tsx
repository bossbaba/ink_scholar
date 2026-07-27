// Lazy-load views
import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "@/components/Layout/AppLayout";

const Overview = lazy(() => import("@/views/Overview"));
const Editor = lazy(() => import("@/views/Editor"));
const Library = lazy(() => import("@/views/Library"));
const Characters = lazy(() => import("@/views/Characters"));
const CharacterCanvas = lazy(() => import("@/views/Characters/Canvas"));
const Skills = lazy(() => import("@/views/Skills"));
const Settings = lazy(() => import("@/views/Settings"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: "workbench", element: <Overview /> },
      { path: "library", element: <Library /> },
      { path: "characters", element: <Characters /> },
      { path: "skills", element: <Skills /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  {
    path: "/editor/:id",
    element: <Editor />,
  },
  {
    path: "/characters/:novelId",
    element: <CharacterCanvas />,
  },
]);
