import React from "react";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import SettingsPage from "../../components/SettingsPage";

export default function SchedulingSettings() {
  const socket = useSocket();
  return <SettingsPage api={api} socket={socket} />;
}
