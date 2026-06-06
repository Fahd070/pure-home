import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import { getSocket } from "../hooks/useSocket";

export default function TechnicianLayout() {
  return (
    <div className="h-full flex bg-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <ConnectionBanner getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}