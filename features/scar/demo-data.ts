import { CircleDollarSign, PackageCheck, Search } from "lucide-react";

import type { DemoActivityRecord, DemoAgentRecord } from "./types";

export const activities: DemoActivityRecord[] = [
  { id: "ACT-218", agent: "Treasury Agent", role: "Treasury", action: "Send 1 USDC", target: "Supplier Alpha", time: "21:04", status: "READY", tone: "neutral", icon: CircleDollarSign },
  { id: "ACT-217", agent: "Procurement Agent", role: "Procurement", action: "Payment request", target: "Vendor Delta", time: "20:51", status: "REVIEW", tone: "review", icon: PackageCheck },
  { id: "ACT-216", agent: "Research Agent", role: "Research", action: "External tool request", target: "Index API", time: "20:42", status: "ALLOW", tone: "allow", icon: Search },
];

export const agents: DemoAgentRecord[] = [
  { name: "Treasury Agent", role: "Moves approved company funds", status: "Active", protected: 18, inherited: 2, icon: CircleDollarSign, shade: "yellow" },
  { name: "Procurement Agent", role: "Pays suppliers and services", status: "Active", protected: 12, inherited: 3, icon: PackageCheck, shade: "coral" },
  { name: "Research Agent", role: "Uses approved external tools", status: "Active", protected: 27, inherited: 1, icon: Search, shade: "olive" },
];
