"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertCircle, FileText, Film, Image, Archive, Trash2, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const deptData = [
  { name: "HR & Admin", value: 120, color: "var(--brand-accent)", pct: 26.7 },
  { name: "Projects", value: 200, color: "var(--brand-primary)", pct: 44.4 },
  { name: "Company Assets", value: 80, color: "#3b82f6", pct: 17.8 },
  { name: "WordPress", value: 30, color: "#22c55e", pct: 6.7 },
  { name: "Legal", value: 20, color: "#f59e0b", pct: 4.4 },
];

const initialCleanup = [
  { id: 1, name: "Training_2024_Q1.zip", age: "2 years", size: "45 MB", sizeBytes: 47185920, dept: "HR & Admin" },
  { id: 2, name: "Archive_2023_Reports.zip", age: "1.5 years", size: "32 MB", sizeBytes: 33554432, dept: "WordPress" },
  { id: 3, name: "Old_Brand_Assets_v1.zip", age: "1 year", size: "28 MB", sizeBytes: 29360128, dept: "Company Assets" },
];

const largestFiles = [
  { name: "Assets_Pack_v2.zip", size: "220 MB", type: "zip", dept: "Company Assets" },
  { name: "Product_Demo_Recording.mp4", size: "145 MB", type: "video", dept: "Projects" },
  { name: "Training_Videos_Batch.zip", size: "98 MB", type: "zip", dept: "HR & Admin" },
  { name: "Brand_Guidelines_v3.pdf", size: "8.7 MB", type: "pdf", dept: "Company Assets" },
  { name: "Project_Alpha_Deck.pptx", size: "6.5 MB", type: "slide", dept: "Projects" },
  { name: "Q4_Sales_Report_Final.xlsx", size: "4.2 MB", type: "sheet", dept: "WordPress" },
  { name: "Team_Photo_2026.jpg", size: "3.2 MB", type: "image", dept: "Company Assets" },
  { name: "Company_Policy_2026.pdf", size: "2.4 MB", type: "pdf", dept: "HR & Admin" },
  { name: "Logo_Package_Final.png", size: "1.8 MB", type: "image", dept: "Company Assets" },
  { name: "Legal_Contract_2026.pdf", size: "1.1 MB", type: "pdf", dept: "Legal" },
];

const monthlyData = [
  { month: "Dec", gb: 18 },
  { month: "Jan", gb: 24 },
  { month: "Feb", gb: 19 },
  { month: "Mar", gb: 32 },
  { month: "Apr", gb: 28 },
  { month: "May", gb: 35 },
];

const typeIconMap: Record<string, { icon: React.ElementType; color: string }> = {
  zip: { icon: Archive, color: "#6b7280" },
  video: { icon: Film, color: "#8b5cf6" },
  pdf: { icon: FileText, color: "#ef4444" },
  image: { icon: Image, color: "#22c55e" },
  slide: { icon: FileText, color: "#f59e0b" },
  sheet: { icon: FileText, color: "#10b981" },
};

function StorageRing({ used, total }: { used: number; total: number }) {
  const pct = (used / total) * 100;
  const r = 80;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  return (
    <svg width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r={r} fill="none" stroke="#f4f5f7" strokeWidth="16" />
      <circle cx="100" cy="100" r={r} fill="none" stroke="url(#ringGrad)" strokeWidth="16"
        strokeDasharray={`${fill} ${circ - fill}`} strokeDashoffset={circ * 0.25}
        strokeLinecap="round" transform="rotate(-90 100 100)" />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand-accent)" />
          <stop offset="100%" stopColor="#e8c96a" />
        </linearGradient>
      </defs>
      <text x="100" y="92" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--brand-primary)" fontFamily="Poppins, sans-serif">
        {Math.round(pct)}%
      </text>
      <text x="100" y="114" textAnchor="middle" fontSize="11" fill="#9ca3af" fontFamily="Poppins, sans-serif">
        {used}GB of {total / 1024}TB
      </text>
    </svg>
  );
}

export function StorageOverview() {
  const [cleanupItems, setCleanupItems] = useState(initialCleanup);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const handleDeleteCleanupItem = (id: number, name: string, size: string) => {
    setDeletedIds(prev => new Set([...prev, id]));
    setTimeout(() => {
      setCleanupItems(prev => prev.filter(i => i.id !== id));
      setDeletedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      toast.success(`"${name}" (${size}) deleted from Vault`);
    }, 600);
  };

  const handleCleanAll = () => {
    if (cleanupItems.length === 0) { toast.info("No files to clean up"); return; }
    const total = cleanupItems.reduce((sum, i) => sum + i.sizeBytes, 0);
    const totalMb = (total / 1048576).toFixed(0);
    cleanupItems.forEach(item => setDeletedIds(prev => new Set([...prev, item.id])));
    setTimeout(() => {
      setCleanupItems([]);
      setDeletedIds(new Set());
      toast.success(`Cleaned up ${totalMb} MB of old files`);
    }, 800);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    toast.loading("Refreshing storage data...");
    setTimeout(() => {
      setRefreshing(false);
      toast.success("Storage data refreshed");
    }, 1800);
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>Storage Overview</h2>
          <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>Google Workspace 2TB · Usage analytics and cleanup</p>
        </div>
        <button onClick={handleRefresh}
          style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", background: "white", border: "1.5px solid #eef0f4", borderRadius: "10px", fontSize: "13px", color: "#374151", cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>
          <RefreshCw size={14} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>

      {/* Top row */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "18px", marginBottom: "18px" }}>
        {/* Ring */}
        <div style={{ background: "white", borderRadius: "16px", padding: "24px", border: "1px solid #eef0f4", display: "flex", alignItems: "center", gap: "24px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <StorageRing used={450} total={2048} />
          <div>
            <div style={{ fontSize: "13px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", marginBottom: "4px" }}>Total Used</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", lineHeight: 1.1, marginBottom: "2px" }}>450 GB</div>
            <div style={{ fontSize: "13px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", marginBottom: "16px" }}>of 2 TB available</div>
            <div style={{ padding: "10px 14px", background: "#fffbeb", borderRadius: "10px", border: "1px solid #fef08a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertCircle size={14} color="#f59e0b" />
                <span style={{ fontSize: "12px", color: "#92400e", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>22.5% used — healthy</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dept chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <h3 style={{ margin: "0 0 16px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Usage by Department</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <PieChart width={120} height={120}>
              <Pie data={deptData} cx={55} cy={55} innerRadius={35} outerRadius={55} dataKey="value" strokeWidth={0}>
                {deptData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
            <div style={{ flex: 1 }}>
              {deptData.map((d) => (
                <div key={d.name} style={{ marginBottom: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: d.color }} />
                      <span style={{ fontSize: "11px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{d.value}GB</span>
                  </div>
                  <div style={{ height: "5px", background: "#f4f5f7", borderRadius: "100px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${d.pct}%`, background: d.color, borderRadius: "100px" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Monthly chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <h3 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Monthly Growth</h3>
          <p style={{ margin: "0 0 14px", color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>GB added per month</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyData} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f5f7" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: "'Poppins', sans-serif", fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fontFamily: "'Poppins', sans-serif", fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--brand-primary)", border: "none", borderRadius: "10px", color: "white", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }} cursor={{ fill: "#f4f5f7" }} formatter={(v) => [`${v} GB`, "Uploaded"]} />
              <Bar dataKey="gb" fill="var(--brand-accent)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "18px" }}>
        {/* Top files */}
        <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f4f5f7" }}>
            <h3 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Top 10 Largest Files</h3>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8f9fc" }}>
                {["#", "File Name", "Department", "Size"].map(h => (
                  <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: "10px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {largestFiles.map((f, i) => {
                const tm = typeIconMap[f.type] ?? typeIconMap.pdf;
                return (
                  <tr key={i} style={{ borderBottom: i < largestFiles.length - 1 ? "1px solid #f9fafb" : "none", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fafbfd")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    onClick={() => toast.info(`${f.name} — ${f.size} in ${f.dept}`)}>
                    <td style={{ padding: "10px 18px", fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</td>
                    <td style={{ padding: "10px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <tm.icon size={14} color={tm.color} />
                        <span style={{ fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{f.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 18px", fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>{f.dept}</td>
                    <td style={{ padding: "10px 18px", fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{f.size}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Cleanup */}
        <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", height: "fit-content" }}>
          <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f4f5f7" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <AlertCircle size={15} color="#f59e0b" />
              <h3 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Cleanup Suggestions</h3>
            </div>
            <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
              {cleanupItems.length > 0 ? `${cleanupItems.length} old files · ${(cleanupItems.reduce((s, i) => s + i.sizeBytes, 0) / 1048576).toFixed(0)} MB freeable` : "All clean! No old files found."}
            </p>
          </div>
          <div style={{ padding: "12px 16px" }}>
            {cleanupItems.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                  <Check size={22} color="#22c55e" />
                </div>
                <p style={{ margin: 0, fontSize: "13px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>Storage is clean!</p>
              </div>
            ) : (
              <>
                {cleanupItems.map((f) => (
                  <div key={f.id} style={{ padding: "12px", borderRadius: "10px", background: deletedIds.has(f.id) ? "#f0fdf4" : "#fffbeb", border: `1px solid ${deletedIds.has(f.id) ? "#bbf7d0" : "#fef08a"}`, marginBottom: "8px", transition: "all 0.3s", opacity: deletedIds.has(f.id) ? 0.5 : 1 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif", marginBottom: "2px" }}>{f.name}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{f.dept} · {f.age} old · <strong style={{ color: "#f59e0b" }}>{f.size}</strong></div>
                      </div>
                      <button onClick={() => handleDeleteCleanupItem(f.id, f.name, f.size)} disabled={deletedIds.has(f.id)}
                        style={{ background: "none", border: "none", cursor: deletedIds.has(f.id) ? "default" : "pointer", color: deletedIds.has(f.id) ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", padding: "2px" }}>
                        {deletedIds.has(f.id) ? <Check size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
                <button onClick={handleCleanAll}
                  style={{ width: "100%", marginTop: "4px", padding: "10px", background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: "10px", fontSize: "12px", fontWeight: 600, color: "#dc2626", cursor: "pointer", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                  <Trash2 size={13} /> Delete All Suggested Files
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
