import React from 'react';
export default function TitleBar({ title }: { title: string }) {
  const el = (window as any).electron;
  return (
    <div className="titlebar-drag h-8 bg-orange-700 flex items-center justify-between px-3 select-none">
      <span className="text-white text-xs font-medium titlebar-no-drag">{title}</span>
      <div className="titlebar-no-drag flex gap-1">
        <button onClick={() => el?.minimize()} className="w-5 h-5 rounded hover:bg-orange-500 text-white text-xs flex items-center justify-center">─</button>
        <button onClick={() => el?.maximize()} className="w-5 h-5 rounded hover:bg-orange-500 text-white text-xs flex items-center justify-center">□</button>
        <button onClick={() => el?.close()} className="w-5 h-5 rounded hover:bg-red-500 text-white text-xs flex items-center justify-center">✕</button>
      </div>
    </div>
  );
}
