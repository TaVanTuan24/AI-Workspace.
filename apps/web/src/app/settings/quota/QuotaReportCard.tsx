import { useState, useEffect } from "react";
import { getWorkspaceQuotaReport, getWorkspaceQuotaReportDownloadUrl, type WorkspaceQuotaReport } from "../../../lib/api";

export function QuotaReportCard() {
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("7d");
  const [report, setReport] = useState<WorkspaceQuotaReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getWorkspaceQuotaReport(range).then(res => {
      setReport(res);
    }).finally(() => {
      setLoading(false);
    });
  }, [range]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-8">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-slate-200">Quota Report & Export</h2>
          <p className="mt-1 text-sm text-slate-400">Quota events are retained safely. Select a range to view aggregates.</p>
        </div>
        <div className="flex gap-4 items-center">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as any)}
            className="bg-slate-950 border border-slate-700 rounded-md text-sm text-slate-300 px-3 py-2"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
          <a
            href={getWorkspaceQuotaReportDownloadUrl(range)}
            download
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 rounded-md transition-colors"
          >
            Download JSON
          </a>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-slate-500 py-4 text-center">Loading report data...</div>
        ) : report ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Events By Resource</h3>
              {report.eventsByResource.length === 0 ? (
                <div className="text-slate-500 text-sm">No events in this period.</div>
              ) : (
                <div className="space-y-2">
                  {report.eventsByResource.map(r => (
                    <div key={r.resource} className="flex justify-between items-center bg-slate-950/50 p-2 rounded">
                      <span className="text-slate-300 text-sm font-medium">{r.resource}</span>
                      <span className="text-slate-400 text-sm">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Events By Source</h3>
              {report.eventsBySource.length === 0 ? (
                <div className="text-slate-500 text-sm">No events in this period.</div>
              ) : (
                <div className="space-y-2">
                  {report.eventsBySource.map(s => (
                    <div key={s.source} className="flex justify-between items-center bg-slate-950/50 p-2 rounded">
                      <span className="text-slate-300 text-sm font-medium">{s.source}</span>
                      <span className="text-slate-400 text-sm">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-red-400 py-4 text-center">Failed to load report.</div>
        )}
      </div>
    </div>
  );
}
