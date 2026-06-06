import React from 'react';
import { Outlet } from 'react-router-dom';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <TitleBar title="WFM Technician — الفني" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}
